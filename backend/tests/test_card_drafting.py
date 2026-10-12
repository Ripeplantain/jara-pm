"""Paste text, get card drafts, create the ones you keep.

Drafting writes nothing; creation is one ordinary, all-or-nothing service call.
"""

import pytest
import sqlalchemy as sa

from app.ai.llm import get_llm_client
from app.ai.tools import tool_definitions
from app.main import app
from app.models import Activity, AiUsage, Card, Label, Notification, User
from app.services import boards as svc
from app.services.abuse import bucket_for
from app.services.errors import Forbidden, InvalidRequest, NotFound
from tests.conftest import session_for
from tests.test_ai import call, say, setup, tool_results  # noqa: F401  (fixtures)
from tests.test_boards import (  # noqa: F401
    assert_contiguous,
    auth,
    db,
    make_board,
    other,
    titles,
    user,
)
from tests.test_permissions import headers, shared  # noqa: F401


def draft(client, h, board_id, text="Ship the onboarding flow"):
    return client.post(f"/api/boards/{board_id}/ai/draft-cards", json={"text": text}, headers=h)


def card_count():
    with session_for() as session:
        return session.scalar(sa.select(sa.func.count()).select_from(Card))


# --- service: create_cards ------------------------------------------------------------------


def test_create_cards_appends_in_order_with_checklist_labels_and_history(db, user):  # noqa: F811
    board = make_board(db, user)
    todo = board.columns[0]
    svc.create_card(db, user, todo.id, "Existing")
    label = Label(workspace_id=board.workspace_id, name="bug")
    db.add(label)
    db.commit()

    fresh = svc.create_cards(
        db,
        user,
        todo.id,
        [
            svc.NewCard(title="One", priority="high", estimate=3, checklist=["a", "b"], label_ids=[label.id, label.id]),
            svc.NewCard(title="Two", description="d", assignee_id=user.id),
        ],
    )
    cards = fresh.columns[0].cards
    assert titles(cards) == ["Existing", "One", "Two"]
    assert_contiguous(db, board.id)
    one, two = cards[1], cards[2]
    assert one.priority == "high" and one.estimate == 3
    assert [i.text for i in one.checklist] == ["a", "b"]
    assert [label.name for label in one.labels] == ["bug"]  # a repeated label id is attached once
    assert two.assignee_id == user.id and two.created_by_id == user.id
    created = db.scalars(sa.select(Activity).where(Activity.action == "card.created")).all()
    assert {a.card_id for a in created} >= {one.id, two.id}
    # Nobody is notified about assigning a card to themselves.
    assert db.scalar(sa.select(sa.func.count()).select_from(Notification)) == 0


def test_create_cards_is_all_or_nothing(db, user, other):  # noqa: F811
    board = make_board(db, user)
    todo = board.columns[0]
    before = db.scalar(sa.select(sa.func.count()).select_from(Activity))
    with pytest.raises(InvalidRequest):  # `other` is not in this workspace
        svc.create_cards(db, user, todo.id, [svc.NewCard(title="Fine"), svc.NewCard(title="Bad", assignee_id=other.id)])
    with pytest.raises(NotFound):
        svc.create_cards(db, user, todo.id, [svc.NewCard(title="Fine"), svc.NewCard(title="Bad", label_ids=[999])])
    db.rollback()
    assert svc.get_board(db, user, board.id).columns[0].cards == []
    assert db.scalar(sa.select(sa.func.count()).select_from(Activity)) == before


def test_create_cards_in_a_done_column_are_completed(db, user):  # noqa: F811
    board = make_board(db, user)
    done = board.columns[2]
    svc.update_column(db, user, done.id, is_done=True)
    fresh = svc.create_cards(db, user, done.id, [svc.NewCard(title="Already shipped")])
    assert fresh.columns[2].cards[0].completed_at is not None


def test_create_cards_respects_membership_and_role(shared, client, register_and_login):  # noqa: F811
    board, tokens = shared
    column_id = board["columns"][0]["id"]
    path = f"/api/columns/{column_id}/cards/batch"
    body = {"cards": [{"title": "A"}, {"title": "B"}]}
    assert client.post(path, json=body).status_code == 401
    assert client.post(path, json=body, headers=headers(tokens["outsider"])).status_code == 404
    assert client.post(path, json=body, headers=headers(tokens["viewer"])).status_code == 403
    with session_for() as session:
        viewer = session.scalar(sa.select(User).where(User.email == "viewer@example.com"))
        with pytest.raises(Forbidden):
            svc.create_cards(session, viewer, column_id, [svc.NewCard(title="Nope")])
    assert card_count() == 0

    res = client.post(path, json=body, headers=headers(tokens["member"]))
    assert res.status_code == 201
    assert [c["title"] for c in res.json()["columns"][0]["cards"]] == ["A", "B"]


def test_batch_endpoint_validates_its_body(client, setup):  # noqa: F811
    h, _board, todo, *_ = setup
    path = f"/api/columns/{todo['id']}/cards/batch"
    assert client.post(path, json={"cards": []}, headers=h).status_code == 422
    assert client.post(path, json={"cards": [{"title": "x"}] * 26}, headers=h).status_code == 422
    assert client.post(path, json={"cards": [{"title": "  "}]}, headers=h).status_code == 422
    assert card_count() == 1  # only the fixture's card


# --- drafting -------------------------------------------------------------------------------


def test_draft_returns_cards_and_writes_nothing(client, setup, use_llm):  # noqa: F811
    h, board, *_ = setup
    fake = use_llm(
        call(
            "draft_cards",
            cards=[
                {"title": "Build sign-up form", "priority": "high", "checklist": ["Validate email"]},
                {"title": "Write welcome email", "description": "Sent after sign-up", "estimate": 2},
            ],
        )
    )
    res = draft(client, h, board["id"], "We need sign-up and a welcome email.")
    assert res.status_code == 200
    body = res.json()
    assert [d["title"] for d in body["drafts"]] == ["Build sign-up form", "Write welcome email"]
    assert body["drafts"][0]["priority"] == "high" and body["drafts"][0]["checklist"] == ["Validate email"]
    assert body["drafts"][1]["estimate"] == 2 and body["note"] == ""
    assert card_count() == 1  # nothing was created
    assert len(fake.calls) == 1  # a successful draft needs no second model turn

    system, pasted = fake.calls[0]
    assert pasted == {"role": "user", "content": "We need sign-up and a welcome email."}
    assert "Write docs" in system["content"]  # existing cards, so the model can skip duplicates
    assert "a@example.com" not in system["content"] and "password" not in system["content"].lower()

    # The drafts are exactly what the batch endpoint accepts.
    todo = board["columns"][0]
    made = client.post(f"/api/columns/{todo['id']}/cards/batch", json={"cards": body["drafts"]}, headers=h)
    assert made.status_code == 201
    cards = made.json()["columns"][0]["cards"]
    assert [c["title"] for c in cards] == ["Write docs", "Build sign-up form", "Write welcome email"]
    assert cards[1]["checklist_total"] == 1


def test_draft_offers_only_the_draft_tool_and_runs_no_other(client, setup, use_llm):  # noqa: F811
    h, board, todo, _done, card = setup
    seen: list[list[dict]] = []

    turns = [
        call("create_card", column_id=todo["id"], title="Sneaky"),
        call("delete_card", card_id=card["id"]),
        say("Nothing to draft."),
    ]

    class Recording:
        def complete(self, messages, tools):
            seen.append(tools)
            return turns.pop(0)

    app.dependency_overrides[get_llm_client] = lambda: Recording()
    try:
        res = draft(client, h, board["id"])
    finally:
        app.dependency_overrides.pop(get_llm_client)
    assert res.status_code == 200 and res.json() == {"drafts": [], "note": "Nothing to draft."}
    assert [[t["function"]["name"] for t in tools] for tools in seen] == [["draft_cards"]] * 3
    assert card_count() == 1


def test_draft_tool_is_not_offered_in_the_board_chat():
    assert "draft_cards" not in [t["function"]["name"] for t in tool_definitions()]


def test_draft_sends_invalid_ids_back_to_the_model(client, setup, use_llm):  # noqa: F811
    h, board, *_ = setup
    fake = use_llm(
        call("draft_cards", cards=[{"title": "A", "assignee_id": 9999}]),
        call("draft_cards", cards=[{"title": "A", "label_ids": [777]}]),
        call("draft_cards", cards=[{"title": "A"}]),
    )
    res = draft(client, h, board["id"]).json()
    assert [d["title"] for d in res["drafts"]] == ["A"]
    errors = [r["error"] for r in tool_results(fake)]
    assert "not a member" in errors[0] and "777" in errors[1]


def test_draft_gives_up_after_the_iteration_cap(client, setup, use_llm):  # noqa: F811
    h, board, *_ = setup
    fake = use_llm(*[call("draft_cards", cards=[])] * 5)
    res = draft(client, h, board["id"]).json()
    assert res["drafts"] == [] and "couldn't" in res["note"]
    assert len(fake.calls) == 3


def test_draft_refuses_viewers_and_outsiders_before_spending_budget(shared, client, use_llm):  # noqa: F811
    board, tokens = shared
    fake = use_llm(call("draft_cards", cards=[{"title": "A"}]))
    assert client.post(f"/api/boards/{board['id']}/ai/draft-cards", json={"text": "x"}).status_code == 401
    assert draft(client, headers(tokens["outsider"]), board["id"]).status_code == 404
    assert draft(client, headers(tokens["viewer"]), board["id"]).status_code == 403
    assert fake.calls == []
    with session_for() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AiUsage)) == 0
    assert draft(client, headers(tokens["member"]), board["id"]).status_code == 200


def test_draft_counts_against_the_monthly_budget_and_is_rate_limited(client, setup, use_llm, monkeypatch):  # noqa: F811
    monkeypatch.setenv("AI_MONTHLY_ACTION_LIMIT", "1")
    h, board, *_ = setup
    use_llm(call("draft_cards", cards=[{"title": "A"}]))
    assert draft(client, h, board["id"]).status_code == 200
    with session_for() as session:
        usage = session.query(AiUsage).one()
        assert usage.actions == 1 and usage.provider_calls == 1
    limited = draft(client, h, board["id"])
    assert limited.status_code == 422 and "monthly AI action limit" in limited.json()["detail"]
    assert bucket_for("POST", f"/api/boards/{board['id']}/ai/draft-cards") == "ai"


def test_draft_validates_the_pasted_text(client, setup, use_llm):  # noqa: F811
    h, board, *_ = setup
    use_llm()
    assert draft(client, h, board["id"], "   ").status_code == 422
    assert draft(client, h, board["id"], "x" * 12_001).status_code == 422
