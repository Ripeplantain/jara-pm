"""Pages: the tree, the blocks, and above all who can see them.

Visibility is the one access rule in Kobi that workspace membership does not settle, so it is
tested on every read path separately - listing, fetching, search, backlinks, export, history and
the AI context - rather than once in general. A single query that forgot the filter is exactly
the bug these tests exist to catch.
"""

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

from app.db import get_engine

from .conftest import session_for


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def scene(client, register_and_login):
    """One workspace: an owner, an admin, a member, a viewer, and a board with a card."""
    tokens = {
        who: register_and_login(f"{who}@example.com")
        for who in ("owner", "admin", "member", "viewer")
    }
    owner = headers(tokens["owner"])
    board = client.post(
        "/api/boards", json={"title": "Board", "columns": ["Todo"]}, headers=owner
    ).json()
    wid = board["workspace_id"]
    for who in ("admin", "member", "viewer"):
        client.post(
            f"/api/workspaces/{wid}/invites",
            json={"email": f"{who}@example.com", "role": who},
            headers=owner,
        )
    card = client.post(
        f"/api/columns/{board['columns'][0]['id']}/cards", json={"title": "Fix login"}, headers=owner
    ).json()
    return {"board": board, "wid": wid, "card": card, "tokens": tokens}


def make_page(client, scene, who="owner", **body):
    res = client.post(
        f"/api/workspaces/{scene['wid']}/notes", json=body, headers=headers(scene["tokens"][who])
    )
    assert res.status_code == 201, res.text
    return res.json()


def positions(page):
    return [block["position"] for block in page["blocks"]]


def texts(page):
    return [block["text"] for block in page["blocks"]]


# --- the page and its body ------------------------------------------------------------------


def test_a_page_is_created_with_its_body_in_one_go(client, scene):
    page = make_page(
        client,
        scene,
        title="Launch plan",
        icon="🚀",
        blocks=[
            {"type": "heading2", "text": "Goals"},
            {"type": "todo", "text": "Ship the beta", "checked": True},
            {"type": "bulleted", "text": "Nested", "indent": 1},
        ],
    )
    assert page["title"] == "Launch plan"
    assert page["icon"] == "🚀"
    assert page["visibility"] == "workspace"
    assert page["owner"]["email"] == "owner@example.com"
    assert positions(page) == [0, 1, 2]
    assert [b["type"] for b in page["blocks"]] == ["heading2", "todo", "bulleted"]
    assert page["blocks"][1]["checked"] is True
    assert page["blocks"][2]["indent"] == 1

    fetched = client.get(f"/api/notes/{page['id']}", headers=headers(scene["tokens"]["owner"]))
    assert fetched.json()["blocks"] == page["blocks"]


def test_an_untitled_page_is_allowed_because_writing_comes_first(client, scene):
    page = make_page(client, scene)
    assert page["title"] == ""
    assert page["blocks"] == []


def test_a_document_save_keeps_the_blocks_it_sends_back(client, scene):
    """The editor's save must not churn block ids, or the caret jumps on every keystroke."""
    owner = headers(scene["tokens"]["owner"])
    page = make_page(
        client,
        scene,
        title="Spec",
        blocks=[{"text": "one"}, {"text": "two"}, {"text": "three"}],
    )
    first, second, third = (block["id"] for block in page["blocks"])

    saved = client.put(
        f"/api/notes/{page['id']}/blocks",
        json={
            "blocks": [
                {"id": third, "text": "three"},
                {"id": first, "text": "one, edited"},
                {"type": "quote", "text": "brand new"},
            ]
        },
        headers=owner,
    ).json()

    assert texts(saved) == ["three", "one, edited", "brand new"]
    assert positions(saved) == [0, 1, 2]
    # The two that came back by id are the same rows; `second` was left out, so it is gone.
    assert [b["id"] for b in saved["blocks"]][:2] == [third, first]
    assert second not in [b["id"] for b in saved["blocks"]]


def test_blocks_can_be_added_in_the_middle_and_stay_contiguous(client, scene):
    owner = headers(scene["tokens"]["owner"])
    page = make_page(client, scene, blocks=[{"text": "a"}, {"text": "b"}])
    out = client.post(
        f"/api/notes/{page['id']}/blocks",
        json={"blocks": [{"text": "wedged"}], "position": 1},
        headers=owner,
    ).json()
    assert texts(out) == ["a", "wedged", "b"]
    assert positions(out) == [0, 1, 2]


def test_one_block_can_be_patched_without_resending_the_page(client, scene):
    owner = headers(scene["tokens"]["owner"])
    page = make_page(client, scene, blocks=[{"type": "todo", "text": "Ship it"}])
    block_id = page["blocks"][0]["id"]
    out = client.patch(f"/api/note-blocks/{block_id}", json={"checked": True}, headers=owner).json()
    assert out["blocks"][0]["checked"] is True
    assert out["blocks"][0]["text"] == "Ship it"


def test_an_unknown_block_type_is_refused(client, scene):
    res = client.post(
        f"/api/workspaces/{scene['wid']}/notes",
        json={"blocks": [{"type": "iframe", "text": "x"}]},
        headers=headers(scene["tokens"]["owner"]),
    )
    assert res.status_code == 422


def test_checked_only_sticks_to_a_todo(client, scene):
    """A paragraph that claims to be checked is stored unchecked: the type owns the field."""
    page = make_page(client, scene, blocks=[{"type": "paragraph", "text": "x", "checked": True}])
    assert page["blocks"][0]["checked"] is False


# --- the tree -------------------------------------------------------------------------------


def test_a_subpage_hangs_off_its_parent(client, scene):
    parent = make_page(client, scene, title="Handbook")
    child = make_page(client, scene, title="Onboarding", parent_id=parent["id"])
    assert child["parent_id"] == parent["id"]

    listed = client.get(
        f"/api/workspaces/{scene['wid']}/notes", headers=headers(scene["tokens"]["owner"])
    ).json()
    assert {p["title"]: p["parent_id"] for p in listed} == {
        "Handbook": None,
        "Onboarding": parent["id"],
    }


def test_pages_keep_contiguous_positions_as_they_are_reordered(client, scene):
    owner = headers(scene["tokens"]["owner"])
    pages = [make_page(client, scene, title=t) for t in ("A", "B", "C")]
    assert [p["position"] for p in pages] == [0, 1, 2]

    client.post(f"/api/notes/{pages[2]['id']}/move", json={"position": 0}, headers=owner)
    listed = client.get(f"/api/workspaces/{scene['wid']}/notes", headers=owner).json()
    assert [(p["title"], p["position"]) for p in listed] == [("C", 0), ("A", 1), ("B", 2)]


def test_a_page_cannot_be_moved_inside_itself_or_its_own_subpage(client, scene):
    owner = headers(scene["tokens"]["owner"])
    parent = make_page(client, scene, title="Parent")
    child = make_page(client, scene, title="Child", parent_id=parent["id"])

    itself = client.post(
        f"/api/notes/{parent['id']}/move", json={"parent_id": parent["id"]}, headers=owner
    )
    assert itself.status_code == 422

    cycle = client.post(
        f"/api/notes/{parent['id']}/move", json={"parent_id": child["id"]}, headers=owner
    )
    assert cycle.status_code == 422
    assert "subpage" in cycle.json()["detail"]


def test_archiving_takes_the_subtree_off_the_list_and_restoring_brings_it_back(client, scene):
    owner = headers(scene["tokens"]["owner"])
    parent = make_page(client, scene, title="Old project")
    make_page(client, scene, title="Old notes", parent_id=parent["id"])
    keep = make_page(client, scene, title="Current")

    client.post(f"/api/notes/{parent['id']}/archive", headers=owner)
    live = client.get(f"/api/workspaces/{scene['wid']}/notes", headers=owner).json()
    assert [p["title"] for p in live] == ["Current"]
    # Archived pages leave the ordering, the way archived cards do.
    assert [p["position"] for p in live] == [0]

    with_archived = client.get(
        f"/api/workspaces/{scene['wid']}/notes?include_archived=true", headers=owner
    ).json()
    assert {p["title"] for p in with_archived} == {"Old project", "Old notes", "Current"}

    client.post(f"/api/notes/{parent['id']}/unarchive", headers=owner)
    back = client.get(f"/api/workspaces/{scene['wid']}/notes", headers=owner).json()
    assert {p["title"] for p in back} == {"Old project", "Old notes", "Current"}
    assert sorted(p["position"] for p in back if p["parent_id"] is None) == [0, 1]
    assert keep["title"] == "Current"


# --- who can see a page ---------------------------------------------------------------------


def test_a_private_page_is_invisible_to_everyone_else_including_the_owner_of_the_workspace(
    client, scene
):
    """The whole point: a private page is not "forbidden" to an admin, it does not exist."""
    page = make_page(client, scene, who="member", title="My thinking", visibility="private")
    wid = scene["wid"]

    for who in ("owner", "admin", "viewer"):
        them = headers(scene["tokens"][who])
        assert client.get(f"/api/notes/{page['id']}", headers=them).status_code == 404
        assert page["id"] not in [p["id"] for p in client.get(f"/api/workspaces/{wid}/notes", headers=them).json()]
        found = client.get(f"/api/workspaces/{wid}/search?q=thinking", headers=them).json()
        assert found["notes"] == []

    mine = headers(scene["tokens"]["member"])
    assert client.get(f"/api/notes/{page['id']}", headers=mine).status_code == 200
    assert [p["title"] for p in client.get(f"/api/workspaces/{wid}/notes", headers=mine).json()] == [
        "My thinking"
    ]


def test_a_private_page_writes_no_history(client, scene):
    """Activity is readable by the whole workspace and never edited, so a private page must
    leave no row at all - not a filtered one."""
    make_page(client, scene, who="member", title="Shared thoughts")
    make_page(client, scene, who="member", title="Secret thoughts", visibility="private")

    feed = client.get(
        f"/api/workspaces/{scene['wid']}/activity", headers=headers(scene["tokens"]["owner"])
    ).json()
    summaries = [row["summary"] for row in feed]
    assert any("Shared thoughts" in s for s in summaries)
    assert not any("Secret thoughts" in s for s in summaries)

    with session_for() as db:
        rows = db.execute(
            sa.text("SELECT summary FROM activities WHERE entity_type = 'note'")
        ).fetchall()
    assert [r[0] for r in rows] == ["created the page “Shared thoughts”"]


def test_only_the_owner_of_a_page_decides_who_sees_it(client, scene):
    page = make_page(client, scene, who="member", title="Draft")
    url = f"/api/notes/{page['id']}/visibility"

    # An admin may administer the workspace, but a page's audience is its author's call.
    refused = client.put(url, json={"visibility": "private"}, headers=headers(scene["tokens"]["admin"]))
    assert refused.status_code == 403

    mine = headers(scene["tokens"]["member"])
    assert client.put(url, json={"visibility": "private"}, headers=mine).json()["visibility"] == "private"
    assert client.get(f"/api/notes/{page['id']}", headers=headers(scene["tokens"]["admin"])).status_code == 404
    assert client.put(url, json={"visibility": "workspace"}, headers=mine).json()["visibility"] == "workspace"
    assert client.get(f"/api/notes/{page['id']}", headers=headers(scene["tokens"]["admin"])).status_code == 200


def test_privacy_is_inherited_by_the_subtree(client, scene):
    """A shared page inside a private one would be listed and unreachable, so it cannot exist."""
    mine = headers(scene["tokens"]["member"])
    parent = make_page(client, scene, who="member", title="Journal", visibility="private")

    # Asking for a shared subpage of a private page gets a private one.
    child = make_page(
        client, scene, who="member", title="Week 1", parent_id=parent["id"], visibility="workspace"
    )
    assert child["visibility"] == "private"

    # And it cannot be shared on its own while it sits there.
    refused = client.put(
        f"/api/notes/{child['id']}/visibility", json={"visibility": "workspace"}, headers=mine
    )
    assert refused.status_code == 422
    assert "private page" in refused.json()["detail"]


def test_making_a_page_private_takes_its_subpages_with_it(client, scene):
    mine = headers(scene["tokens"]["member"])
    parent = make_page(client, scene, who="member", title="Project")
    child = make_page(client, scene, who="member", title="Detail", parent_id=parent["id"])

    client.put(f"/api/notes/{parent['id']}/visibility", json={"visibility": "private"}, headers=mine)
    assert client.get(f"/api/notes/{child['id']}", headers=mine).json()["visibility"] == "private"
    assert client.get(f"/api/notes/{child['id']}", headers=headers(scene["tokens"]["owner"])).status_code == 404


def test_a_private_page_cannot_be_moved_under_a_shared_parent_by_accident(client, scene):
    """The guard is the other way round too: a shared page may not move into a private one."""
    mine = headers(scene["tokens"]["member"])
    private = make_page(client, scene, who="member", title="Private", visibility="private")
    shared = make_page(client, scene, who="member", title="Shared")

    refused = client.post(
        f"/api/notes/{shared['id']}/move", json={"parent_id": private["id"]}, headers=mine
    )
    assert refused.status_code == 422
    assert "make this page private first" in refused.json()["detail"]


# --- roles ----------------------------------------------------------------------------------


def test_a_viewer_reads_pages_but_writes_nothing(client, scene):
    page = make_page(client, scene, title="Readme", blocks=[{"text": "hello"}])
    viewer = headers(scene["tokens"]["viewer"])

    assert client.get(f"/api/notes/{page['id']}", headers=viewer).status_code == 200
    assert client.get(f"/api/workspaces/{scene['wid']}/notes", headers=viewer).status_code == 200

    assert client.post(f"/api/workspaces/{scene['wid']}/notes", json={"title": "No"}, headers=viewer).status_code == 403
    assert client.patch(f"/api/notes/{page['id']}", json={"title": "No"}, headers=viewer).status_code == 403
    assert client.put(f"/api/notes/{page['id']}/blocks", json={"blocks": []}, headers=viewer).status_code == 403
    assert client.post(f"/api/notes/{page['id']}/archive", headers=viewer).status_code == 403
    assert client.delete(f"/api/notes/{page['id']}", headers=viewer).status_code == 403


def test_an_outsider_sees_no_pages_at_all(client, scene, register_and_login):
    page = make_page(client, scene, title="Internal")
    outsider = headers(register_and_login("nobody@example.com"))
    assert client.get(f"/api/notes/{page['id']}", headers=outsider).status_code == 404
    assert client.get(f"/api/workspaces/{scene['wid']}/notes", headers=outsider).status_code == 404


def test_a_page_is_deleted_by_its_owner_or_an_admin_and_nobody_else(client, scene):
    owner_of_page = "member"
    page = make_page(client, scene, who=owner_of_page, title="Mine")
    other_member = headers(scene["tokens"]["viewer"])  # viewer is refused earlier, by role
    assert client.delete(f"/api/notes/{page['id']}", headers=other_member).status_code == 403

    # The page's own author may delete it.
    assert client.delete(f"/api/notes/{page['id']}", headers=headers(scene["tokens"][owner_of_page])).status_code == 204

    # So may an admin, for somebody else's page.
    theirs = make_page(client, scene, who="member", title="Theirs")
    assert client.delete(f"/api/notes/{theirs['id']}", headers=headers(scene["tokens"]["admin"])).status_code == 204


def test_deleting_a_page_takes_its_subpages_and_leaves_the_history(client, scene):
    owner = headers(scene["tokens"]["owner"])
    parent = make_page(client, scene, title="Doomed")
    child = make_page(client, scene, title="Also doomed", parent_id=parent["id"])

    client.delete(f"/api/notes/{parent['id']}", headers=owner)
    assert client.get(f"/api/notes/{child['id']}", headers=owner).status_code == 404

    feed = client.get(f"/api/workspaces/{scene['wid']}/activity", headers=owner).json()
    assert any(row["action"] == "note.deleted" for row in feed)


# --- history and notifications --------------------------------------------------------------


def test_creating_and_editing_a_page_is_written_to_the_feed(client, scene):
    owner = headers(scene["tokens"]["owner"])
    page = make_page(client, scene, title="Plan")
    client.put(
        f"/api/notes/{page['id']}/blocks", json={"blocks": [{"text": "body"}]}, headers=owner
    )
    feed = client.get(f"/api/workspaces/{scene['wid']}/activity", headers=owner).json()
    actions = [row["action"] for row in feed]
    assert "note.created" in actions
    assert "note.updated" in actions


def test_repeated_autosaves_do_not_flood_the_feed(client, scene):
    """Editing is autosaved; one history row per burst is what the feed is for."""
    owner = headers(scene["tokens"]["owner"])
    page = make_page(client, scene, title="Plan")
    for n in range(5):
        client.put(
            f"/api/notes/{page['id']}/blocks",
            json={"blocks": [{"text": f"draft {n}"}]},
            headers=owner,
        )
    feed = client.get(f"/api/workspaces/{scene['wid']}/activity", headers=owner).json()
    assert [row["action"] for row in feed].count("note.updated") == 1


def test_a_mention_in_a_shared_page_notifies_once(client, scene):
    owner = headers(scene["tokens"]["owner"])
    page = make_page(
        client, scene, title="Standup", blocks=[{"text": "@member@example.com please review"}]
    )
    them = headers(scene["tokens"]["member"])
    notes = client.get("/api/notifications", headers=them).json()
    mentions = [n for n in notes if n["kind"] == "note.mentioned"]
    assert len(mentions) == 1
    assert mentions[0]["entity_type"] == "note"
    assert mentions[0]["entity_id"] == page["id"]

    # Saving again must not deliver it twice.
    client.put(
        f"/api/notes/{page['id']}/blocks",
        json={"blocks": [{"text": "@member@example.com please review"}, {"text": "more"}]},
        headers=owner,
    )
    again = client.get("/api/notifications", headers=them).json()
    assert len([n for n in again if n["kind"] == "note.mentioned"]) == 1


def test_a_mention_in_a_private_page_notifies_nobody(client, scene):
    make_page(
        client,
        scene,
        who="owner",
        title="Private",
        visibility="private",
        blocks=[{"text": "@member@example.com"}],
    )
    them = headers(scene["tokens"]["member"])
    assert [n for n in client.get("/api/notifications", headers=them).json() if n["kind"] == "note.mentioned"] == []


# --- links to board work --------------------------------------------------------------------


def test_an_embedded_card_gives_the_card_a_backlink(client, scene):
    owner = headers(scene["tokens"]["owner"])
    card_id = scene["card"]["id"]
    page = make_page(
        client,
        scene,
        title="Release notes",
        blocks=[{"type": "card_embed", "ref_card_id": card_id}],
    )
    back = client.get(f"/api/cards/{card_id}/notes", headers=owner).json()
    assert [p["id"] for p in back] == [page["id"]]

    # Take the embed out and the backlink goes with it: links are derived, never stale.
    client.put(f"/api/notes/{page['id']}/blocks", json={"blocks": [{"text": "plain"}]}, headers=owner)
    assert client.get(f"/api/cards/{card_id}/notes", headers=owner).json() == []


def test_an_embed_block_carries_the_current_title_of_what_it_points_at(client, scene):
    owner = headers(scene["tokens"]["owner"])
    page = make_page(
        client,
        scene,
        blocks=[{"type": "card_embed", "ref_card_id": scene["card"]["id"]}],
    )
    assert page["blocks"][0]["ref_title"] == "Fix login"
    # The board comes back too, so the UI can link straight to the card on its board.
    assert page["blocks"][0]["ref_card_board_id"] == scene["board"]["id"]

    # Renaming the card renames the embed, because the title is resolved on read, not stored.
    client.patch(f"/api/cards/{scene['card']['id']}", json={"title": "Fix sign-in"}, headers=owner)
    again = client.get(f"/api/notes/{page['id']}", headers=owner).json()
    assert again["blocks"][0]["ref_title"] == "Fix sign-in"

    # And a deleted card leaves the block in place with nothing to show.
    client.delete(f"/api/cards/{scene['card']['id']}", headers=owner)
    after = client.get(f"/api/notes/{page['id']}", headers=owner).json()
    assert after["blocks"][0]["type"] == "card_embed"
    assert after["blocks"][0]["ref_title"] == ""


def test_a_backlink_from_someone_elses_private_page_stays_hidden(client, scene):
    client.post(
        f"/api/workspaces/{scene['wid']}/notes",
        json={
            "title": "My private read",
            "visibility": "private",
            "blocks": [{"type": "card_embed", "ref_card_id": scene["card"]["id"]}],
        },
        headers=headers(scene["tokens"]["member"]),
    )
    url = f"/api/cards/{scene['card']['id']}/notes"
    assert client.get(url, headers=headers(scene["tokens"]["owner"])).json() == []
    assert len(client.get(url, headers=headers(scene["tokens"]["member"])).json()) == 1


def test_an_embed_must_point_at_something_in_this_workspace(client, scene, register_and_login):
    elsewhere = register_and_login("elsewhere@example.com")
    other_board = client.post(
        "/api/boards", json={"title": "Theirs", "columns": ["Todo"]}, headers=headers(elsewhere)
    ).json()
    other_card = client.post(
        f"/api/columns/{other_board['columns'][0]['id']}/cards",
        json={"title": "Not yours"},
        headers=headers(elsewhere),
    ).json()

    res = client.post(
        f"/api/workspaces/{scene['wid']}/notes",
        json={"blocks": [{"type": "card_embed", "ref_card_id": other_card["id"]}]},
        headers=headers(scene["tokens"]["owner"]),
    )
    # Not even "wrong workspace": that card is not visible to this user at all.
    assert res.status_code == 404

    missing_ref = client.post(
        f"/api/workspaces/{scene['wid']}/notes",
        json={"blocks": [{"type": "card_embed"}]},
        headers=headers(scene["tokens"]["owner"]),
    )
    assert missing_ref.status_code == 422


def test_an_assignee_hears_when_a_page_points_at_their_card(client, scene):
    owner = headers(scene["tokens"]["owner"])
    client.patch(
        f"/api/cards/{scene['card']['id']}",
        json={"assignee_id": client.get("/api/me", headers=headers(scene["tokens"]["member"])).json()["id"]},
        headers=owner,
    )
    make_page(
        client,
        scene,
        title="Context",
        blocks=[{"type": "card_embed", "ref_card_id": scene["card"]["id"]}],
    )
    them = client.get("/api/notifications", headers=headers(scene["tokens"]["member"])).json()
    assert [n["kind"] for n in them if n["kind"] == "note.linked"] == ["note.linked"]


# --- search and export ----------------------------------------------------------------------


def test_search_finds_pages_by_title_and_body_with_an_excerpt(client, scene):
    owner = headers(scene["tokens"]["owner"])
    make_page(client, scene, title="Pricing research", blocks=[{"text": "We should test annual billing"}])
    make_page(client, scene, title="Unrelated")

    by_title = client.get(f"/api/workspaces/{scene['wid']}/search?q=pricing", headers=owner).json()
    assert [p["title"] for p in by_title["notes"]] == ["Pricing research"]

    by_body = client.get(f"/api/workspaces/{scene['wid']}/search?q=annual", headers=owner).json()
    assert [p["title"] for p in by_body["notes"]] == ["Pricing research"]
    assert "annual billing" in by_body["notes"][0]["excerpt"]


def test_an_export_carries_my_pages_and_nobody_elses_private_ones(client, scene):
    make_page(client, scene, who="member", title="Team page")
    make_page(client, scene, who="member", title="Member's private", visibility="private")
    make_page(client, scene, who="owner", title="Owner's private", visibility="private")

    export = client.get(
        f"/api/workspaces/{scene['wid']}/export", headers=headers(scene["tokens"]["owner"])
    ).json()
    titles = {note["title"] for note in export["notes"]}
    assert titles == {"Team page", "Owner's private"}
    assert "Member's private" not in titles


def test_an_export_carries_the_blocks_of_a_page(client, scene):
    make_page(client, scene, title="With body", blocks=[{"type": "todo", "text": "do it"}])
    export = client.get(
        f"/api/workspaces/{scene['wid']}/export", headers=headers(scene["tokens"]["owner"])
    ).json()
    page = next(n for n in export["notes"] if n["title"] == "With body")
    assert [(b["type"], b["text"]) for b in page["blocks"]] == [("todo", "do it")]


# --- the migration --------------------------------------------------------------------------


def test_migration_0019_leaves_existing_board_data_alone(tmp_path, monkeypatch):
    """0019 adds tables and nullable columns, so nothing may be rebuilt - and the rule in
    agents.md is that any migration touching an existing table is tested with child rows
    already in place."""
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "legacy19.db"))
    get_engine.cache_clear()
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "0018")

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO users (email, password_hash, created_at) "
                "VALUES ('old@example.com', 'x', CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            sa.text("INSERT INTO workspaces (name, created_by_id, created_at) VALUES ('W', 1, CURRENT_TIMESTAMP)")
        )
        conn.execute(
            sa.text(
                "INSERT INTO boards (workspace_id, created_by_id, title, description, created_at) "
                "VALUES (1, 1, 'Old board', '', CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(sa.text("INSERT INTO columns (board_id, title, position, is_done) VALUES (1, 'Todo', 0, 0)"))
        conn.execute(
            sa.text(
                "INSERT INTO cards (column_id, title, description, position, priority, created_at, updated_at) "
                "VALUES (1, 'Old card', '', 0, 'none', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO activities (workspace_id, action, summary, created_at) "
                "VALUES (1, 'card.created', 'created a card', CURRENT_TIMESTAMP)"
            )
        )

    command.upgrade(cfg, "0019")

    with engine.begin() as conn:
        assert conn.execute(sa.text("SELECT COUNT(*) FROM cards")).scalar() == 1
        assert conn.execute(sa.text("SELECT COUNT(*) FROM columns")).scalar() == 1
        assert conn.execute(sa.text("SELECT COUNT(*) FROM activities")).scalar() == 1
        # The new columns are there and null on the rows that predate them.
        assert conn.execute(sa.text("SELECT entity_type FROM activities")).scalar() is None
        for table in ("notes", "note_blocks", "note_links"):
            assert conn.execute(sa.text(f"SELECT COUNT(*) FROM {table}")).scalar() == 0
