"""The tools added in phase 13: what they do, and what they refuse.

Authorisation is not tested through the prompt - it is tested by calling the tools as a viewer
and checking the service layer refuses, which is the only thing that actually stops them.
"""

import pytest
import sqlalchemy as sa

from app.models import User, WorkspaceMember
from tests.conftest import session_for
from tests.test_ai import ask, call, say, tool_results


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def tool_call(tool: str, args: dict):
    """Like `call`, but for tools with an argument literally named "name"."""
    return call(tool, **args) if "name" not in args else _named(tool, args)


def _named(tool: str, args: dict):
    import json

    from app.ai.llm import AssistantTurn, ToolCall

    return AssistantTurn(tool_calls=[ToolCall(id=f"c-{tool}", name=tool, arguments=json.dumps(args))])


@pytest.fixture
def scene(client, register_and_login):
    """A board with a card, a label, a member and a viewer."""
    owner = auth(register_and_login("owner@example.com"))
    register_and_login("mate@example.com")
    viewer_token = register_and_login("viewer@example.com")

    board = client.post(
        "/api/boards", json={"title": "B", "columns": ["Todo", "Done"]}, headers=owner
    ).json()
    wid = board["workspace_id"]
    with session_for() as db:
        for email, role in (("mate@example.com", "member"), ("viewer@example.com", "viewer")):
            user = db.scalar(sa.select(User).where(User.email == email))
            db.add(WorkspaceMember(workspace_id=wid, user_id=user.id, role=role))
        db.commit()
    label = client.post(
        f"/api/workspaces/{wid}/labels", json={"name": "bug", "color": "rose"}, headers=owner
    ).json()
    todo, done = board["columns"]
    card = client.post(f"/api/columns/{todo['id']}/cards", json={"title": "Fix it"}, headers=owner).json()
    mate_id = client.get("/api/me", headers=auth(register_and_login("mate@example.com"))).json()["id"]
    return {
        "owner": owner,
        "viewer": auth(viewer_token),
        "board": board,
        "todo": todo,
        "done": done,
        "card": card,
        "label": label,
        "mate_id": mate_id,
    }


def card_now(client, headers, board_id, card_id):
    board = client.get(f"/api/boards/{board_id}", headers=headers).json()
    for column in board["columns"]:
        for card in column["cards"]:
            if card["id"] == card_id:
                return card
    return None


def test_set_card_fields_changes_only_what_it_is_given(client, scene, use_llm):
    use_llm(
        call(
            "set_card_fields",
            card_id=scene["card"]["id"],
            assignee_id=scene["mate_id"],
            priority="urgent",
            due_date="2027-01-15T00:00:00Z",
            estimate=5,
        ),
        say("Done."),
    )
    res = ask(client, scene["owner"], scene["board"]["id"], "make it urgent")
    assert res.status_code == 200
    card = card_now(client, scene["owner"], scene["board"]["id"], scene["card"]["id"])
    assert card["assignee_id"] == scene["mate_id"]
    assert card["priority"] == "urgent"
    assert card["estimate"] == 5
    assert card["due_date"].startswith("2027-01-15")
    assert card["title"] == "Fix it"


def test_card_authoring_is_previewed_then_applied_once(client, scene, use_llm):
    card_id = scene["card"]["id"]
    fake = use_llm(
        tool_call(
            "suggest_card_authoring",
            {
                "card_id": card_id,
                "title": "Fix checkout validation",
                "acceptance_criteria": ["Invalid input shows a useful message"],
                "estimate": 5,
            },
        ),
        say("I prepared a card improvement for your review."),
    )
    res = ask(client, scene["owner"], scene["board"]["id"], "Improve this card")
    assert res.status_code == 200
    pending = res.json()["pending"][0]
    assert pending["proposal_token"] and pending["operations"]
    before = card_now(client, scene["owner"], scene["board"]["id"], card_id)
    assert before["title"] == "Fix it" and before["checklist_total"] == 0
    assert tool_results(fake)[0]["status"] == "pending_user_confirmation"

    confirmed = client.post(
        f"/api/boards/{scene['board']['id']}/ai/confirm",
        json={"proposal_token": pending["proposal_token"]},
        headers=scene["owner"],
    )
    assert confirmed.status_code == 200
    after = card_now(client, scene["owner"], scene["board"]["id"], card_id)
    assert after["title"] == "Fix checkout validation"
    assert after["estimate"] == 5 and after["checklist_total"] == 1
    assert client.post(
        f"/api/boards/{scene['board']['id']}/ai/confirm",
        json={"proposal_token": pending["proposal_token"]},
        headers=scene["owner"],
    ).status_code == 422


def test_batch_card_authoring_previews_every_operation_and_applies_each_card(client, scene, use_llm):
    second = client.post(
        f"/api/columns/{scene['todo']['id']}/cards",
        json={"title": "Document it"},
        headers=scene["owner"],
    ).json()
    fake = use_llm(
        tool_call(
            "batch_card_authoring",
            {
                "rationale": "Make both cards ready for engineering.",
                "changes": [
                    {"card_id": scene["card"]["id"], "title": "Fix checkout validation"},
                    {"card_id": second["id"], "estimate": 3, "subtasks": ["Add tests"]},
                ],
            },
        ),
        say("I prepared both cards for your review."),
    )
    res = ask(client, scene["owner"], scene["board"]["id"], "Prepare these cards")
    pending = res.json()["pending"][0]
    assert len(pending["operations"]) == 3
    assert card_now(client, scene["owner"], scene["board"]["id"], scene["card"]["id"])["title"] == "Fix it"
    assert tool_results(fake)[0]["status"] == "pending_user_confirmation"

    confirmed = client.post(
        f"/api/boards/{scene['board']['id']}/ai/confirm",
        json={"proposal_token": pending["proposal_token"]},
        headers=scene["owner"],
    )
    assert confirmed.status_code == 200
    assert len(confirmed.json()["changes"]) == 2
    assert card_now(client, scene["owner"], scene["board"]["id"], scene["card"]["id"])["title"] == "Fix checkout validation"
    updated_second = card_now(client, scene["owner"], scene["board"]["id"], second["id"])
    assert updated_second["estimate"] == 3 and updated_second["checklist_total"] == 1


def test_viewer_cannot_create_a_card_authoring_proposal(client, scene, use_llm):
    fake = use_llm(
        tool_call("suggest_card_authoring", {"card_id": scene["card"]["id"], "title": "Hijack"}),
        say("You need a member role."),
    )
    res = ask(client, scene["viewer"], scene["board"]["id"], "Improve it")
    assert res.status_code == 200
    assert res.json()["pending"] == []
    assert "assistant cannot do this" in tool_results(fake)[0]["error"]


def test_clearing_a_field_is_different_from_omitting_it(client, scene, use_llm):
    client.patch(
        f"/api/cards/{scene['card']['id']}",
        json={"estimate": 8, "priority": "high"},
        headers=scene["owner"],
    )
    use_llm(call("set_card_fields", card_id=scene["card"]["id"], estimate=None), say("Cleared."))
    ask(client, scene["owner"], scene["board"]["id"])
    card = card_now(client, scene["owner"], scene["board"]["id"], scene["card"]["id"])
    assert card["estimate"] is None
    assert card["priority"] == "high"  # untouched


def test_assigning_a_non_member_is_refused_and_explained(client, scene, use_llm, register_and_login):
    outsider = register_and_login("outsider@example.com")
    outsider_id = client.get("/api/me", headers=auth(outsider)).json()["id"]
    fake = use_llm(
        call("set_card_fields", card_id=scene["card"]["id"], assignee_id=outsider_id),
        say("That person is not in this workspace."),
    )
    ask(client, scene["owner"], scene["board"]["id"])
    assert "not a member" in tool_results(fake)[0]["error"]


def test_labels_checklists_and_comments(client, scene, use_llm):
    card_id = scene["card"]["id"]
    use_llm(
        call("add_label", card_id=card_id, label_id=scene["label"]["id"]),
        call("add_checklist_items", card_id=card_id, items=["Reproduce", "Fix", "Test"]),
        call("comment_on_card", card_id=card_id, body="Picking this up"),
        say("Done."),
    )
    res = ask(client, scene["owner"], scene["board"]["id"])
    assert res.status_code == 200
    card = card_now(client, scene["owner"], scene["board"]["id"], card_id)
    assert [lbl["name"] for lbl in card["labels"]] == ["bug"]
    assert (card["checklist_done"], card["checklist_total"]) == (0, 3)
    assert card["comment_count"] == 1
    kinds = [c["kind"] for c in res.json()["changes"]]
    assert kinds == ["add_label", "add_checklist_items", "comment"]


def test_a_comment_written_by_the_assistant_is_attributed_to_the_user(client, scene, use_llm):
    use_llm(call("comment_on_card", card_id=scene["card"]["id"], body="On it"), say("Done."))
    ask(client, scene["owner"], scene["board"]["id"])
    comments = client.get(f"/api/cards/{scene['card']['id']}/comments", headers=scene["owner"]).json()
    assert comments[0]["author"]["email"] == "owner@example.com"


def test_archiving_happens_immediately_and_deleting_does_not(client, scene, use_llm):
    card_id = scene["card"]["id"]
    use_llm(call("archive_card", card_id=card_id), say("Archived."))
    res = ask(client, scene["owner"], scene["board"]["id"])
    assert res.json()["pending"] == []
    assert card_now(client, scene["owner"], scene["board"]["id"], card_id) is None
    assert [c["title"] for c in client.get(
        f"/api/boards/{scene['board']['id']}/archived-cards", headers=scene["owner"]
    ).json()] == ["Fix it"]


def test_sprint_tools_plan_start_and_complete(client, scene, use_llm):
    board_id = scene["board"]["id"]
    card_id = scene["card"]["id"]
    fake = use_llm(
        tool_call("create_sprint", {"name": "Sprint 1", "goal": "Ship the fix", "card_ids": [card_id]}),
        say("Planned."),
    )
    res = ask(client, scene["owner"], board_id)
    sprint_id = tool_results(fake)[0]["sprint_id"]
    assert res.json()["changes"][0]["summary"] == "Planned the sprint “Sprint 1” with 1 cards"
    assert card_now(client, scene["owner"], board_id, card_id)["sprint_id"] == sprint_id

    use_llm(call("start_sprint", sprint_id=sprint_id), say("Started."))
    ask(client, scene["owner"], board_id)
    assert client.get(f"/api/boards/{board_id}/sprints", headers=scene["owner"]).json()[0]["state"] == "active"

    use_llm(call("complete_sprint", sprint_id=sprint_id), say("Done."))
    ask(client, scene["owner"], board_id)
    assert client.get(f"/api/boards/{board_id}/sprints", headers=scene["owner"]).json()[0]["state"] == "completed"
    assert card_now(client, scene["owner"], board_id, card_id)["sprint_id"] is None


def test_board_stats_answers_questions_without_writing(client, scene, use_llm):
    fake = use_llm(call("board_stats"), say("One card open, nothing overdue."))
    res = ask(client, scene["owner"], scene["board"]["id"], "what is blocked?")
    stats = tool_results(fake)[0]
    assert stats["open_cards"] == 1 and stats["overdue"] == 0
    assert [c["title"] for c in stats["columns"]] == ["Todo", "Done"]
    assert res.json()["changes"] == []  # a read changes nothing


def test_create_board_from_template_lands_in_the_same_workspace(client, scene, use_llm):
    use_llm(
        tool_call("create_board_from_template", {"template": "scrum", "title": "Next quarter"}),
        say("Made it."),
    )
    res = ask(client, scene["owner"], scene["board"]["id"])
    assert res.status_code == 200
    boards = client.get("/api/boards", headers=scene["owner"]).json()
    made = next(b for b in boards if b["title"] == "Next quarter")
    assert made["workspace_id"] == scene["board"]["workspace_id"]


def test_an_unknown_template_is_an_error_the_model_can_read(client, scene, use_llm):
    fake = use_llm(call("create_board_from_template", template="nonsense"), say("No such template."))
    ask(client, scene["owner"], scene["board"]["id"])
    assert "not found" in tool_results(fake)[0]["error"]


# --- what a viewer's assistant may do ---------------------------------------------------------


def test_a_viewer_can_read_through_the_assistant(client, scene, use_llm):
    fake = use_llm(call("board_stats"), say("One open card."))
    res = ask(client, scene["viewer"], scene["board"]["id"])
    assert res.status_code == 200
    assert tool_results(fake)[0]["open_cards"] == 1


@pytest.mark.parametrize(
    "tool,args",
    [
        ("create_card", {"column_id": None, "title": "Nope"}),
        ("update_card", {"card_id": None, "title": "Nope"}),
        ("set_card_fields", {"card_id": None, "priority": "urgent"}),
        ("add_label", {"card_id": None, "label_id": None}),
        ("add_checklist_items", {"card_id": None, "items": ["Nope"]}),
        ("comment_on_card", {"card_id": None, "body": "Nope"}),
        ("archive_card", {"card_id": None}),
        ("add_column", {"title": "Nope"}),
        ("rename_board", {"title": "Nope"}),
        ("create_sprint", {"name": "Nope"}),
    ],
)
def test_a_viewer_cannot_write_through_the_assistant(client, scene, use_llm, tool, args):
    filled = {
        key: (
            scene["card"]["id"]
            if key == "card_id"
            else scene["todo"]["id"]
            if key == "column_id"
            else scene["label"]["id"]
            if key == "label_id"
            else value
        )
        for key, value in args.items()
    }
    fake = use_llm(tool_call(tool, filled), say("You have read-only access."))
    res = ask(client, scene["viewer"], scene["board"]["id"], "change it")
    assert res.status_code == 200
    error = tool_results(fake)[0]["error"]
    assert "needs" in error and "assistant cannot do this" in error
    assert res.json()["changes"] == []


def test_the_board_did_not_change_after_a_viewer_tried(client, scene, use_llm):
    before = client.get(f"/api/boards/{scene['board']['id']}", headers=scene["owner"]).json()
    use_llm(call("rename_board", title="Hijacked"), say("Cannot."))
    ask(client, scene["viewer"], scene["board"]["id"])
    after = client.get(f"/api/boards/{scene['board']['id']}", headers=scene["owner"]).json()
    assert after["title"] == before["title"] == "B"


def test_a_viewer_still_cannot_delete_even_with_confirmation(client, scene, use_llm):
    """Delete tools only propose; confirming runs the normal endpoint, which refuses a viewer."""
    use_llm(call("delete_card", card_id=scene["card"]["id"]), say("Waiting for confirmation."))
    res = ask(client, scene["viewer"], scene["board"]["id"])
    assert [p["tool"] for p in res.json()["pending"]] == ["delete_card"]
    assert client.delete(f"/api/cards/{scene['card']['id']}", headers=scene["viewer"]).status_code == 403
    assert card_now(client, scene["owner"], scene["board"]["id"], scene["card"]["id"]) is not None


# --- what the model is told (13.3) -------------------------------------------------------------


def system_prompt(fake):
    return next(m["content"] for m in fake.calls[-1] if m["role"] == "system")


def test_the_context_carries_members_labels_and_sprints(client, scene, use_llm):
    client.post(
        f"/api/boards/{scene['board']['id']}/sprints", json={"name": "S1"}, headers=scene["owner"]
    )
    fake = use_llm(say("Hello."))
    ask(client, scene["owner"], scene["board"]["id"])
    prompt = system_prompt(fake)
    assert '"role": "owner"' in prompt
    assert '"name": "Mate"' in prompt
    assert '"name": "bug"' in prompt
    assert '"name": "S1"' in prompt
    assert "scrum" in prompt


def test_the_context_never_carries_email_addresses_or_hashes(client, scene, use_llm):
    fake = use_llm(say("Hello."))
    ask(client, scene["owner"], scene["board"]["id"])
    prompt = system_prompt(fake)
    assert "@example.com" not in prompt
    assert "password" not in prompt.lower()
    assert "argon2" not in prompt


def test_a_viewer_is_told_their_role_is_read_only(client, scene, use_llm):
    fake = use_llm(say("I can only read this board."))
    ask(client, scene["viewer"], scene["board"]["id"])
    prompt = system_prompt(fake)
    assert "VIEWER" in prompt
    assert "read-only" in prompt


def test_a_member_is_not_given_the_viewer_note(client, scene, use_llm):
    fake = use_llm(say("Sure."))
    ask(client, scene["owner"], scene["board"]["id"])
    assert "read-only" not in system_prompt(fake)


def test_card_details_reach_the_model(client, scene, use_llm):
    card_id = scene["card"]["id"]
    client.patch(
        f"/api/cards/{card_id}",
        json={"priority": "high", "estimate": 3, "assignee_id": scene["mate_id"]},
        headers=scene["owner"],
    )
    client.post(f"/api/cards/{card_id}/labels/{scene['label']['id']}", headers=scene["owner"])
    client.post(f"/api/cards/{card_id}/checklist", json={"text": "Step one"}, headers=scene["owner"])

    fake = use_llm(say("Noted."))
    ask(client, scene["owner"], scene["board"]["id"])
    prompt = system_prompt(fake)
    assert '"priority": "high"' in prompt
    assert '"estimate": 3' in prompt
    assert '"checklist": "0/1"' in prompt
    assert f'"label_ids": [{scene["label"]["id"]}]' in prompt


# --- pages (phase 21) -------------------------------------------------------------------------


def test_the_assistant_writes_a_page_with_blocks(client, scene, use_llm):
    fake = use_llm(
        call(
            "create_page",
            title="Retro",
            blocks=[
                {"type": "heading2", "text": "What went well"},
                {"type": "todo", "text": "Automate the release"},
                {"type": "card_embed", "ref_card_id": scene["card"]["id"]},
            ],
        ),
        say("Written up."),
    )
    res = ask(client, scene["owner"], scene["board"]["id"], "Write up the retro")
    assert res.status_code == 200
    assert tool_results(fake)[0]["ok"] is True
    note_id = tool_results(fake)[0]["note_id"]

    page = client.get(f"/api/notes/{note_id}", headers=scene["owner"]).json()
    assert [b["type"] for b in page["blocks"]] == ["heading2", "todo", "card_embed"]
    # The embed is validated against real state, so the card gets a real backlink.
    back = client.get(f"/api/cards/{scene['card']['id']}/notes", headers=scene["owner"]).json()
    assert [p["id"] for p in back] == [note_id]
    assert res.json()["changes"][0]["note_id"] == note_id


def test_the_assistant_reads_and_appends_to_a_page(client, scene, use_llm):
    page = client.post(
        f"/api/workspaces/{scene['board']['workspace_id']}/notes",
        json={"title": "Standup", "blocks": [{"text": "Yesterday: shipped"}]},
        headers=scene["owner"],
    ).json()

    fake = use_llm(
        call("read_page", note_id=page["id"]),
        call("append_to_page", note_id=page["id"], blocks=[{"text": "Today: review"}]),
        say("Added."),
    )
    ask(client, scene["owner"], scene["board"]["id"], "Add today's line")
    read, appended = tool_results(fake)
    assert [b["text"] for b in read["body"]] == ["Yesterday: shipped"]
    assert appended["blocks"] == 2

    after = client.get(f"/api/notes/{page['id']}", headers=scene["owner"]).json()
    assert [b["text"] for b in after["blocks"]] == ["Yesterday: shipped", "Today: review"]


def test_the_assistant_cannot_see_someone_elses_private_page(client, scene, use_llm):
    """Not "refused" - invisible. The tools go through the same visibility filter as the UI."""
    wid = scene["board"]["workspace_id"]
    private = client.post(
        f"/api/workspaces/{wid}/notes",
        json={"title": "Owner's private", "visibility": "private"},
        headers=scene["owner"],
    ).json()

    # The viewer's assistant searches and reads: the page is not there.
    fake = use_llm(call("search_pages", q="private"), call("read_page", note_id=private["id"]), say("Nothing."))
    res = ask(client, scene["viewer"], scene["board"]["id"], "Find the private page")
    assert res.status_code == 200
    searched, read = tool_results(fake)
    assert searched["pages"] == []
    assert read["error"] == "Note not found"


def test_a_viewer_cannot_write_a_page_through_the_assistant(client, scene, use_llm):
    fake = use_llm(call("create_page", title="Nope"), say("I cannot."))
    res = ask(client, scene["viewer"], scene["board"]["id"], "Write a page")
    assert res.status_code == 200
    error = tool_results(fake)[0]["error"]
    assert "member role" in error and "assistant cannot do this" in error
    assert res.json()["changes"] == []


def test_there_is_no_tool_that_deletes_a_page(client, scene, use_llm):
    """Archiving is reversible and runs immediately; nothing here can destroy a page."""
    from app.ai.tools import TOOLS

    assert not [name for name in TOOLS if "page" in name and "delete" in name]
    assert "archive_page" in TOOLS

    wid = scene["board"]["workspace_id"]
    page = client.post(
        f"/api/workspaces/{wid}/notes", json={"title": "Keepable"}, headers=scene["owner"]
    ).json()
    fake = use_llm(call("archive_page", note_id=page["id"]), say("Archived."))
    ask(client, scene["owner"], scene["board"]["id"], "Archive the page")
    assert tool_results(fake)[0]["ok"] is True
    # Archived, not gone: still readable, and restorable.
    assert client.get(f"/api/notes/{page['id']}", headers=scene["owner"]).json()["archived_at"]


def test_the_context_lists_visible_pages_only(client, scene, use_llm):
    wid = scene["board"]["workspace_id"]
    client.post(f"/api/workspaces/{wid}/notes", json={"title": "Team page"}, headers=scene["owner"])
    client.post(
        f"/api/workspaces/{wid}/notes",
        json={"title": "Owner's private", "visibility": "private"},
        headers=scene["owner"],
    )

    fake = use_llm(say("ok"))
    ask(client, scene["viewer"], scene["board"]["id"], "What pages are there?")
    system = fake.calls[-1][0]["content"]
    assert "Team page" in system
    assert "Owner's private" not in system
