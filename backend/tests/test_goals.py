"""Goals: the progress rollup, and the ordinary workspace rules around it.

The rollup is the thing worth testing hardest. Progress is never stored, so every assertion
here moves a card and then reads the goal, which is the only way a percentage is allowed to
change. The permission cases follow `test_permissions.py`: a viewer reads and cannot write, and
a non-member sees a 404 rather than a 403.
"""

import pytest

from .conftest import session_for


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def scene(client, register_and_login):
    """A board with a Todo and a done column, a sprint, and four accounts with four roles."""
    tokens = {
        who: register_and_login(f"{who}@example.com")
        for who in ("owner", "admin", "member", "viewer", "outsider")
    }
    owner = headers(tokens["owner"])
    board = client.post(
        "/api/boards", json={"title": "Delivery", "columns": ["Todo", "Done"]}, headers=owner
    ).json()
    wid = board["workspace_id"]
    for who in ("admin", "member", "viewer"):
        client.post(
            f"/api/workspaces/{wid}/invites",
            json={"email": f"{who}@example.com", "role": who},
            headers=owner,
        )
    todo, done = board["columns"]
    client.patch(f"/api/columns/{done['id']}", json={"is_done": True}, headers=owner)
    sprint = client.post(
        f"/api/boards/{board['id']}/sprints", json={"name": "Sprint 1"}, headers=owner
    ).json()
    return {
        "wid": wid,
        "tokens": tokens,
        "board": board,
        "todo": todo["id"],
        "done": done["id"],
        "sprint": sprint,
    }


def make_goal(client, scene, who="owner", **body):
    body.setdefault("title", "Ship the beta")
    res = client.post(
        f"/api/workspaces/{scene['wid']}/goals", json=body, headers=headers(scene["tokens"][who])
    )
    assert res.status_code == 201, res.text
    return res.json()


def make_card(client, scene, title, column=None, who="owner", **fields):
    res = client.post(
        f"/api/columns/{column or scene['todo']}/cards",
        json={"title": title, **fields},
        headers=headers(scene["tokens"][who]),
    )
    assert res.status_code == 201, res.text
    return res.json()


def link(client, scene, goal_id, target_type, target_id, milestone_id=None, who="owner"):
    res = client.post(
        f"/api/goals/{goal_id}/links",
        json={"target_type": target_type, "target_id": target_id, "milestone_id": milestone_id},
        headers=headers(scene["tokens"][who]),
    )
    assert res.status_code == 200, res.text
    return res.json()


def move(client, scene, card_id, column_id, who="owner"):
    res = client.post(
        f"/api/cards/{card_id}/move",
        json={"column_id": column_id},
        headers=headers(scene["tokens"][who]),
    )
    assert res.status_code == 200, res.text


def read(client, scene, goal_id, who="owner"):
    res = client.get(f"/api/goals/{goal_id}", headers=headers(scene["tokens"][who]))
    assert res.status_code == 200, res.text
    return res.json()


# --- the rollup -------------------------------------------------------------------------------


def test_a_goal_with_nothing_linked_reports_no_evidence_rather_than_zero(client, scene):
    goal = make_goal(client, scene)
    assert goal["percent"] == 0
    assert goal["has_evidence"] is False
    assert (goal["cards_total"], goal["cards_done"]) == (0, 0)


def test_progress_comes_from_the_board_and_only_from_the_board(client, scene):
    goal = make_goal(client, scene)
    one = make_card(client, scene, "One")
    two = make_card(client, scene, "Two")
    link(client, scene, goal["id"], "card", one["id"])
    linked = link(client, scene, goal["id"], "card", two["id"])
    assert (linked["percent"], linked["has_evidence"]) == (0, True)

    move(client, scene, one["id"], scene["done"])
    assert read(client, scene, goal["id"])["percent"] == 50
    move(client, scene, two["id"], scene["done"])
    after = read(client, scene, goal["id"])
    assert (after["percent"], after["cards_done"], after["cards_total"]) == (100, 2, 2)

    # And it moves back: a card leaving the done column un-completes it.
    move(client, scene, two["id"], scene["todo"])
    assert read(client, scene, goal["id"])["percent"] == 50


def test_a_board_link_counts_every_live_card_on_it(client, scene):
    goal = make_goal(client, scene)
    make_card(client, scene, "One")
    make_card(client, scene, "Two", column=scene["done"])
    linked = link(client, scene, goal["id"], "board", scene["board"]["id"])
    assert (linked["cards_total"], linked["cards_done"], linked["percent"]) == (2, 1, 50)

    # A card added to the board later is counted without touching the goal.
    make_card(client, scene, "Three")
    assert read(client, scene, goal["id"])["cards_total"] == 3


def test_a_sprint_link_counts_the_cards_planned_into_it(client, scene):
    goal = make_goal(client, scene)
    inside = make_card(client, scene, "Planned")
    make_card(client, scene, "Backlog")
    planned = client.put(
        f"/api/cards/{inside['id']}/sprint",
        json={"sprint_id": scene["sprint"]["id"]},
        headers=headers(scene["tokens"]["owner"]),
    )
    assert planned.status_code == 200, planned.text
    linked = link(client, scene, goal["id"], "sprint", scene["sprint"]["id"])
    assert linked["cards_total"] == 1
    move(client, scene, inside["id"], scene["done"])
    assert read(client, scene, goal["id"])["percent"] == 100


def test_each_milestone_is_one_equally_weighted_group(client, scene):
    """A milestone with one card counts as much as a milestone with three: a step is a step."""
    goal = make_goal(client, scene, milestones=["Small", "Large"])
    small, large = goal["milestones"]
    one = make_card(client, scene, "The small one")
    link(client, scene, goal["id"], "card", one["id"], small["id"])
    for index in range(3):
        card = make_card(client, scene, f"Large {index}")
        link(client, scene, goal["id"], "card", card["id"], large["id"])

    move(client, scene, one["id"], scene["done"])
    after = read(client, scene, goal["id"])
    # 100% of the small milestone and 0% of the large one, not 1 card in 4.
    assert after["percent"] == 50
    assert [m["percent"] for m in after["milestones"]] == [100, 0]
    assert (after["cards_done"], after["cards_total"]) == (1, 4)


def test_a_milestone_with_nothing_linked_counts_as_unstarted(client, scene):
    goal = make_goal(client, scene, milestones=["Done bit", "Empty bit"])
    done_bit = goal["milestones"][0]
    card = make_card(client, scene, "Finished", column=scene["done"])
    link(client, scene, goal["id"], "card", card["id"], done_bit["id"])
    after = read(client, scene, goal["id"])
    assert [m["percent"] for m in after["milestones"]] == [100, 0]
    assert after["percent"] == 50


def test_milestones_without_links_are_still_no_evidence(client, scene):
    """Writing down the steps is not progress: there has to be work pointing at them."""
    goal = make_goal(client, scene, milestones=["Plan it", "Build it"])
    assert goal["has_evidence"] is False
    assert goal["percent"] == 0
    card = make_card(client, scene, "Real work")
    linked = link(client, scene, goal["id"], "card", card["id"], goal["milestones"][0]["id"])
    assert linked["has_evidence"] is True


def test_the_goal_s_own_links_are_one_group_beside_its_milestones(client, scene):
    goal = make_goal(client, scene, milestones=["Step"])
    step = goal["milestones"][0]
    planned = make_card(client, scene, "In the step")
    loose = make_card(client, scene, "Straight on the goal", column=scene["done"])
    link(client, scene, goal["id"], "card", planned["id"], step["id"])
    after = link(client, scene, goal["id"], "card", loose["id"])
    # The step is 0% and the goal's direct links are 100%: two groups, mean 50.
    assert after["percent"] == 50
    assert len(after["links"]) == 1 and after["links"][0]["milestone_id"] is None


def test_a_card_linked_twice_is_counted_once(client, scene):
    goal = make_goal(client, scene, milestones=["A", "B"])
    first, second = goal["milestones"]
    card = make_card(client, scene, "Shared", column=scene["done"])
    link(client, scene, goal["id"], "card", card["id"], first["id"])
    after = link(client, scene, goal["id"], "card", card["id"], second["id"])
    assert (after["cards_total"], after["cards_done"]) == (1, 1)
    assert after["percent"] == 100


def test_the_same_work_cannot_be_linked_to_the_same_place_twice(client, scene):
    goal = make_goal(client, scene)
    card = make_card(client, scene, "One")
    link(client, scene, goal["id"], "card", card["id"])
    refused = client.post(
        f"/api/goals/{goal['id']}/links",
        json={"target_type": "card", "target_id": card["id"]},
        headers=headers(scene["tokens"]["owner"]),
    )
    assert refused.status_code == 422
    assert "already linked" in refused.json()["detail"]


def test_an_archived_card_leaves_the_rollup_and_is_reported_as_unresolved(client, scene):
    goal = make_goal(client, scene)
    one = make_card(client, scene, "One", column=scene["done"])
    two = make_card(client, scene, "Two")
    link(client, scene, goal["id"], "card", one["id"])
    link(client, scene, goal["id"], "card", two["id"])
    assert read(client, scene, goal["id"])["percent"] == 50

    client.post(f"/api/cards/{two['id']}/archive", headers=headers(scene["tokens"]["owner"]))
    after = read(client, scene, goal["id"])
    assert (after["cards_total"], after["percent"]) == (1, 100)
    assert after["unresolved_links"] == 1


def test_a_deleted_card_does_not_take_the_goal_with_it(client, scene):
    goal = make_goal(client, scene)
    card = make_card(client, scene, "Doomed")
    link(client, scene, goal["id"], "card", card["id"])
    client.delete(f"/api/cards/{card['id']}", headers=headers(scene["tokens"]["owner"]))
    after = read(client, scene, goal["id"])
    assert after["cards_total"] == 0
    assert after["unresolved_links"] == 1
    assert after["links"][0]["target_title"] == ""


def test_a_link_s_title_follows_the_work_it_points_at(client, scene):
    goal = make_goal(client, scene)
    card = make_card(client, scene, "Original title")
    linked = link(client, scene, goal["id"], "card", card["id"])
    assert linked["links"][0]["target_title"] == "Original title"
    assert linked["links"][0]["board_id"] == scene["board"]["id"]
    client.patch(
        f"/api/cards/{card['id']}", json={"title": "Renamed"}, headers=headers(scene["tokens"]["owner"])
    )
    assert read(client, scene, goal["id"])["links"][0]["target_title"] == "Renamed"


def test_removing_a_link_changes_the_progress_it_was_feeding(client, scene):
    goal = make_goal(client, scene)
    one = make_card(client, scene, "One", column=scene["done"])
    two = make_card(client, scene, "Two")
    link(client, scene, goal["id"], "card", one["id"])
    with_both = link(client, scene, goal["id"], "card", two["id"])
    assert with_both["percent"] == 50
    unlinked_id = next(
        row["id"] for row in with_both["links"] if row["target_id"] == two["id"]
    )
    after = client.delete(
        f"/api/goal-links/{unlinked_id}", headers=headers(scene["tokens"]["owner"])
    )
    assert after.status_code == 200
    assert after.json()["percent"] == 100


# --- milestones -------------------------------------------------------------------------------


def test_milestones_keep_contiguous_positions_through_add_move_and_delete(client, scene):
    goal = make_goal(client, scene, milestones=["One", "Two", "Three"])
    owner = headers(scene["tokens"]["owner"])
    assert [m["position"] for m in goal["milestones"]] == [0, 1, 2]

    added = client.post(
        f"/api/goals/{goal['id']}/milestones", json={"title": "Zero", "position": 0}, headers=owner
    ).json()
    assert [m["title"] for m in added["milestones"]] == ["Zero", "One", "Two", "Three"]
    assert [m["position"] for m in added["milestones"]] == [0, 1, 2, 3]

    moved = client.patch(
        f"/api/goal-milestones/{added['milestones'][0]['id']}", json={"position": 3}, headers=owner
    ).json()
    assert [m["title"] for m in moved["milestones"]] == ["One", "Two", "Three", "Zero"]

    deleted = client.delete(
        f"/api/goal-milestones/{moved['milestones'][1]['id']}", headers=owner
    ).json()
    assert [m["title"] for m in deleted["milestones"]] == ["One", "Three", "Zero"]
    assert [m["position"] for m in deleted["milestones"]] == [0, 1, 2]


def test_deleting_a_milestone_takes_only_its_own_links(client, scene):
    goal = make_goal(client, scene, milestones=["Step"])
    step = goal["milestones"][0]
    inside = make_card(client, scene, "In the step")
    loose = make_card(client, scene, "On the goal")
    link(client, scene, goal["id"], "card", inside["id"], step["id"])
    link(client, scene, goal["id"], "card", loose["id"])
    after = client.delete(
        f"/api/goal-milestones/{step['id']}", headers=headers(scene["tokens"]["owner"])
    ).json()
    assert after["milestones"] == []
    assert [row["target_id"] for row in after["links"]] == [loose["id"]]


# --- the goal itself --------------------------------------------------------------------------


def test_a_goal_is_achieved_by_a_person_while_progress_stays_derived(client, scene):
    goal = make_goal(client, scene)
    card = make_card(client, scene, "One")
    link(client, scene, goal["id"], "card", card["id"])
    owner = headers(scene["tokens"]["owner"])
    achieved = client.patch(
        f"/api/goals/{goal['id']}", json={"state": "achieved"}, headers=owner
    ).json()
    assert achieved["state"] == "achieved"
    assert achieved["achieved_at"] is not None
    # Closing it does not freeze the number; the board still speaks.
    assert achieved["percent"] == 0
    move(client, scene, card["id"], scene["done"])
    assert read(client, scene, goal["id"])["percent"] == 100

    reopened = client.patch(
        f"/api/goals/{goal['id']}", json={"state": "active"}, headers=owner
    ).json()
    assert reopened["achieved_at"] is None


def test_archiving_takes_a_goal_off_the_list_without_losing_it(client, scene):
    goal = make_goal(client, scene)
    owner = headers(scene["tokens"]["owner"])
    client.patch(f"/api/goals/{goal['id']}", json={"state": "archived"}, headers=owner)
    assert client.get(f"/api/workspaces/{scene['wid']}/goals", headers=owner).json() == []
    with_archived = client.get(
        f"/api/workspaces/{scene['wid']}/goals?include_archived=true", headers=owner
    ).json()
    assert [g["id"] for g in with_archived] == [goal["id"]]


def test_a_target_date_cannot_precede_the_start(client, scene):
    refused = client.post(
        f"/api/workspaces/{scene['wid']}/goals",
        json={"title": "Backwards", "starts_on": "2026-06-01", "target_date": "2026-05-01"},
        headers=headers(scene["tokens"]["owner"]),
    )
    assert refused.status_code == 422


def test_a_date_sent_as_null_is_cleared_and_one_left_out_is_kept(client, scene):
    goal = make_goal(client, scene, starts_on="2026-01-01", target_date="2026-03-01")
    owner = headers(scene["tokens"]["owner"])
    renamed = client.patch(
        f"/api/goals/{goal['id']}", json={"title": "Still dated"}, headers=owner
    ).json()
    assert renamed["target_date"] == "2026-03-01"
    cleared = client.patch(
        f"/api/goals/{goal['id']}", json={"target_date": None}, headers=owner
    ).json()
    assert cleared["target_date"] is None
    assert cleared["starts_on"] == "2026-01-01"


def test_goals_are_listed_by_target_date_with_undated_ones_last(client, scene):
    make_goal(client, scene, title="No date")
    make_goal(client, scene, title="Later", target_date="2026-12-01")
    make_goal(client, scene, title="Sooner", target_date="2026-07-01")
    listed = client.get(
        f"/api/workspaces/{scene['wid']}/goals", headers=headers(scene["tokens"]["owner"])
    ).json()
    assert [g["title"] for g in listed] == ["Sooner", "Later", "No date"]


# --- permissions ------------------------------------------------------------------------------


def test_every_member_reads_a_goal_and_a_viewer_cannot_write_one(client, scene):
    goal = make_goal(client, scene)
    for who in ("admin", "member", "viewer"):
        assert read(client, scene, goal["id"], who)["title"] == goal["title"]

    viewer = headers(scene["tokens"]["viewer"])
    assert client.post(
        f"/api/workspaces/{scene['wid']}/goals", json={"title": "No"}, headers=viewer
    ).status_code == 403
    assert client.patch(
        f"/api/goals/{goal['id']}", json={"title": "No"}, headers=viewer
    ).status_code == 403
    assert client.post(
        f"/api/goals/{goal['id']}/milestones", json={"title": "No"}, headers=viewer
    ).status_code == 403
    assert client.delete(f"/api/goals/{goal['id']}", headers=viewer).status_code == 403


def test_a_member_may_set_and_change_a_goal(client, scene):
    """Goals are planning work, which the role table gives to a member, not only an admin."""
    goal = make_goal(client, scene, who="member", title="Member's goal")
    assert client.patch(
        f"/api/goals/{goal['id']}",
        json={"title": "Member edited it"},
        headers=headers(scene["tokens"]["member"]),
    ).status_code == 200


def test_a_non_member_sees_nothing_at_all(client, scene):
    goal = make_goal(client, scene)
    outsider = headers(scene["tokens"]["outsider"])
    assert client.get(f"/api/goals/{goal['id']}", headers=outsider).status_code == 404
    assert client.get(
        f"/api/workspaces/{scene['wid']}/goals", headers=outsider
    ).status_code == 404
    assert client.patch(
        f"/api/goals/{goal['id']}", json={"title": "No"}, headers=outsider
    ).status_code == 404


def test_a_goal_cannot_be_linked_to_work_in_another_workspace(client, scene):
    """The link is checked against real state before it is written, as every AI-reachable
    reference is."""
    goal = make_goal(client, scene)
    other = client.post(
        "/api/boards",
        json={"title": "Elsewhere", "columns": ["Todo"]},
        headers=headers(scene["tokens"]["outsider"]),
    ).json()
    refused = client.post(
        f"/api/goals/{goal['id']}/links",
        json={"target_type": "board", "target_id": other["id"]},
        headers=headers(scene["tokens"]["owner"]),
    )
    # The board is not the owner's to see, so it is missing rather than refused.
    assert refused.status_code == 404


def test_an_unknown_link_target_is_refused(client, scene):
    goal = make_goal(client, scene)
    owner = headers(scene["tokens"]["owner"])
    assert client.post(
        f"/api/goals/{goal['id']}/links",
        json={"target_type": "card", "target_id": 9_999},
        headers=owner,
    ).status_code == 404
    assert client.post(
        f"/api/goals/{goal['id']}/links",
        json={"target_type": "epic", "target_id": 1},
        headers=owner,
    ).status_code == 422


def test_a_milestone_from_another_goal_is_refused(client, scene):
    first = make_goal(client, scene, title="First", milestones=["Step"])
    second = make_goal(client, scene, title="Second")
    card = make_card(client, scene, "One")
    refused = client.post(
        f"/api/goals/{second['id']}/links",
        json={
            "target_type": "card",
            "target_id": card["id"],
            "milestone_id": first["milestones"][0]["id"],
        },
        headers=headers(scene["tokens"]["owner"]),
    )
    assert refused.status_code == 422


# --- history ----------------------------------------------------------------------------------


def test_every_goal_change_lands_in_the_activity_feed(client, scene):
    goal = make_goal(client, scene)
    owner = headers(scene["tokens"]["owner"])
    card = make_card(client, scene, "One")
    link(client, scene, goal["id"], "card", card["id"])
    client.post(f"/api/goals/{goal['id']}/milestones", json={"title": "Step"}, headers=owner)
    client.patch(f"/api/goals/{goal['id']}", json={"state": "achieved"}, headers=owner)

    feed = client.get(f"/api/workspaces/{scene['wid']}/activity", headers=owner).json()
    actions = [row["action"] for row in feed if row["action"].startswith("goal.")]
    assert "goal.created" in actions
    assert "goal.achieved" in actions
    assert actions.count("goal.updated") == 2  # the link and the milestone
    for row in feed:
        if row["action"].startswith("goal."):
            assert row["entity_type"] == "goal"
            assert row["entity_id"] == goal["id"]


def test_a_deleted_goal_leaves_its_history_behind(client, scene):
    goal = make_goal(client, scene)
    owner = headers(scene["tokens"]["owner"])
    assert client.delete(f"/api/goals/{goal['id']}", headers=owner).status_code == 204
    feed = client.get(f"/api/workspaces/{scene['wid']}/activity", headers=owner).json()
    assert any(row["action"] == "goal.deleted" for row in feed)
    with session_for() as db:
        from app.models import Goal, GoalLink, GoalMilestone

        assert db.query(Goal).count() == 0
        assert db.query(GoalMilestone).count() == 0
        assert db.query(GoalLink).count() == 0


# --- migration ---------------------------------------------------------------------------------


def test_migration_0021_adds_the_goal_tables_without_touching_board_data(client, scene):
    import sqlalchemy as sa
    from alembic import command
    from alembic.config import Config

    from app.db import get_engine

    goal = make_goal(client, scene, milestones=["Step"])
    card = make_card(client, scene, "Keep me")
    link(client, scene, goal["id"], "card", card["id"], goal["milestones"][0]["id"])

    command.downgrade(Config("alembic.ini"), "0020")
    command.upgrade(Config("alembic.ini"), "head")
    with get_engine().connect() as conn:
        assert conn.execute(sa.text("select count(*) from goals")).scalar() == 0
        assert conn.execute(sa.text("select count(*) from goal_links")).scalar() == 0
        assert conn.execute(sa.text("select count(*) from cards")).scalar() == 1


# --- search and export ------------------------------------------------------------------------


def test_a_goal_is_findable_in_workspace_search(client, scene):
    goal = make_goal(client, scene, title="Reach 100 teams", detail="North star for the half")
    owner = headers(scene["tokens"]["owner"])
    found = client.get(f"/api/workspaces/{scene['wid']}/search?q=100 teams", headers=owner).json()
    assert [g["id"] for g in found["goals"]] == [goal["id"]]
    # The detail is searched too, not only the title.
    by_detail = client.get(
        f"/api/workspaces/{scene['wid']}/search?q=north star", headers=owner
    ).json()
    assert [g["title"] for g in by_detail["goals"]] == ["Reach 100 teams"]

    client.patch(f"/api/goals/{goal['id']}", json={"state": "archived"}, headers=owner)
    after = client.get(f"/api/workspaces/{scene['wid']}/search?q=100 teams", headers=owner).json()
    assert after["goals"] == []


def test_a_viewer_finds_goals_in_search_and_an_outsider_does_not(client, scene):
    make_goal(client, scene, title="Shared aim")
    viewer = client.get(
        f"/api/workspaces/{scene['wid']}/search?q=shared", headers=headers(scene["tokens"]["viewer"])
    ).json()
    assert [g["title"] for g in viewer["goals"]] == ["Shared aim"]
    assert client.get(
        f"/api/workspaces/{scene['wid']}/search?q=shared",
        headers=headers(scene["tokens"]["outsider"]),
    ).status_code == 404


def test_the_workspace_export_carries_goals_with_their_milestones_and_links(client, scene):
    goal = make_goal(client, scene, title="Exported goal", milestones=["Step"])
    card = make_card(client, scene, "Linked work")
    link(client, scene, goal["id"], "card", card["id"], goal["milestones"][0]["id"])
    export = client.get(
        f"/api/workspaces/{scene['wid']}/export", headers=headers(scene["tokens"]["owner"])
    ).json()
    exported = export["goals"][0]
    assert exported["title"] == "Exported goal"
    assert [m["title"] for m in exported["milestones"]] == ["Step"]
    assert exported["links"][0]["target_id"] == card["id"]


# --- the dashboard ----------------------------------------------------------------------------


def test_the_dashboard_overview_carries_goal_progress(client, scene):
    goal = make_goal(client, scene, title="Dashboard goal")
    card = make_card(client, scene, "One", column=scene["done"])
    link(client, scene, goal["id"], "card", card["id"])
    overview = client.get(
        f"/api/workspaces/{scene['wid']}/overview", headers=headers(scene["tokens"]["owner"])
    ).json()
    assert [g["title"] for g in overview["goals"]] == ["Dashboard goal"]
    assert overview["goals"][0]["percent"] == 100

    # An archived goal leaves the dashboard, like an archived board card leaves its column.
    client.patch(
        f"/api/goals/{goal['id']}", json={"state": "archived"}, headers=headers(scene["tokens"]["owner"])
    )
    after = client.get(
        f"/api/workspaces/{scene['wid']}/overview", headers=headers(scene["tokens"]["owner"])
    ).json()
    assert after["goals"] == []
