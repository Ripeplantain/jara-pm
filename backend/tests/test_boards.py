import pytest
from fastapi.routing import APIRoute

from app.db import get_db, get_engine
from app.main import app
from app.models import User, WorkspaceMember
from app.services import auth as auth_service
from app.services import boards as svc


@pytest.fixture
def db():
    gen = get_db()
    session = next(gen)
    yield session
    gen.close()


def _make_user(db, email: str) -> User:
    """Register through the service so the user gets the personal workspace boards live in."""
    return auth_service.register_user(db, email, "correct-horse")


@pytest.fixture
def user(db):
    return _make_user(db, "svc@example.com")


@pytest.fixture
def other(db):
    return _make_user(db, "other@example.com")


def titles(items):
    return [i.title for i in items]


def assert_contiguous(db, board_id):
    board = svc.get_board(db, _owner(db, board_id), board_id)
    assert [c.position for c in board.columns] == list(range(len(board.columns)))
    for col in board.columns:
        assert [c.position for c in col.cards] == list(range(len(col.cards)))


def _owner(db, board_id):
    """Any member of the board's workspace can read it; the creator will do."""
    from app.models import Board

    board = db.get(Board, board_id)
    member = (
        db.query(WorkspaceMember).filter(WorkspaceMember.workspace_id == board.workspace_id).first()
    )
    return db.get(User, member.user_id)


def make_board(db, user, cols=("Todo", "Doing", "Done")):
    return svc.create_board(db, user, "Board", list(cols))


# --- service: positions ------------------------------------------------------------------


def test_create_board_with_starter_columns(db, user):
    board = make_board(db, user)
    assert titles(board.columns) == ["Todo", "Doing", "Done"]
    assert [c.position for c in board.columns] == [0, 1, 2]


def test_create_column_insert_and_append(db, user):
    board = make_board(db, user)
    svc.create_column(db, user, board.id, "Last")
    svc.create_column(db, user, board.id, "First", position=0)
    svc.create_column(db, user, board.id, "Clamped", position=99)
    board = svc.get_board(db, user, board.id)
    assert titles(board.columns) == ["First", "Todo", "Doing", "Done", "Last", "Clamped"]
    assert_contiguous(db, board.id)


def test_reorder_column_forward_and_back(db, user):
    board = make_board(db, user)
    todo = board.columns[0]
    svc.update_column(db, user, todo.id, position=2)
    assert titles(svc.get_board(db, user, board.id).columns) == ["Doing", "Done", "Todo"]
    svc.update_column(db, user, todo.id, position=0)
    assert titles(svc.get_board(db, user, board.id).columns) == ["Todo", "Doing", "Done"]
    assert_contiguous(db, board.id)


def test_rename_column_keeps_position(db, user):
    board = make_board(db, user)
    col = svc.update_column(db, user, board.columns[1].id, title="Review")
    assert (col.title, col.position) == ("Review", 1)


def test_card_insert_and_reorder_within_column(db, user):
    board = make_board(db, user)
    col = board.columns[0]
    a = svc.create_card(db, user, col.id, "a")
    b = svc.create_card(db, user, col.id, "b")
    c = svc.create_card(db, user, col.id, "c", position=0)
    order = lambda: titles(svc.get_board(db, user, board.id).columns[0].cards)
    assert order() == ["c", "a", "b"]
    svc.move_card(db, user, a.id, col.id, position=2)
    assert order() == ["c", "b", "a"]
    svc.move_card(db, user, c.id, col.id)  # None appends
    assert order() == ["b", "a", "c"]
    assert b.id  # keep reference used
    assert_contiguous(db, board.id)


def test_move_card_across_columns_closes_gap_and_inserts(db, user):
    board = make_board(db, user)
    src, dst = board.columns[0], board.columns[1]
    cards = [svc.create_card(db, user, src.id, t) for t in "abc"]
    svc.create_card(db, user, dst.id, "x")
    svc.create_card(db, user, dst.id, "y")
    moved = svc.move_card(db, user, cards[1].id, dst.id, position=1)
    assert (moved.column_id, moved.position) == (dst.id, 1)
    board = svc.get_board(db, user, board.id)
    assert titles(board.columns[0].cards) == ["a", "c"]
    assert titles(board.columns[1].cards) == ["x", "b", "y"]
    assert_contiguous(db, board.id)


def test_move_card_to_empty_column(db, user):
    board = make_board(db, user)
    card = svc.create_card(db, user, board.columns[0].id, "a")
    moved = svc.move_card(db, user, card.id, board.columns[2].id, position=5)
    assert (moved.column_id, moved.position) == (board.columns[2].id, 0)


def test_move_card_to_other_board_is_rejected(db, user):
    b1, b2 = make_board(db, user), make_board(db, user)
    card = svc.create_card(db, user, b1.columns[0].id, "a")
    with pytest.raises(svc.InvalidRequest):
        svc.move_card(db, user, card.id, b2.columns[0].id)
    assert_contiguous(db, b1.id)


def test_delete_card_closes_gap(db, user):
    board = make_board(db, user)
    cards = [svc.create_card(db, user, board.columns[0].id, t) for t in "abc"]
    svc.delete_card(db, user, cards[0].id)
    assert titles(svc.get_board(db, user, board.id).columns[0].cards) == ["b", "c"]
    assert_contiguous(db, board.id)


# --- service: column delete --------------------------------------------------------------


def test_delete_empty_column_renumbers(db, user):
    board = make_board(db, user)
    svc.delete_column(db, user, board.columns[0].id)
    board = svc.get_board(db, user, board.id)
    assert titles(board.columns) == ["Doing", "Done"]
    assert_contiguous(db, board.id)


def test_delete_column_with_cards_needs_decision(db, user):
    board = make_board(db, user)
    svc.create_card(db, user, board.columns[0].id, "a")
    with pytest.raises(svc.Conflict):
        svc.delete_column(db, user, board.columns[0].id)
    assert len(svc.get_board(db, user, board.id).columns) == 3


def test_delete_column_moving_cards_appends_to_target(db, user):
    board = make_board(db, user)
    src, dst = board.columns[0], board.columns[1]
    svc.create_card(db, user, dst.id, "x")
    for t in "ab":
        svc.create_card(db, user, src.id, t)
    svc.delete_column(db, user, src.id, move_cards_to=dst.id)
    board = svc.get_board(db, user, board.id)
    assert titles(board.columns) == ["Doing", "Done"]
    assert titles(board.columns[0].cards) == ["x", "a", "b"]
    assert_contiguous(db, board.id)


def test_delete_column_with_explicit_card_deletion(db, user):
    board = make_board(db, user)
    svc.create_card(db, user, board.columns[0].id, "a")
    svc.delete_column(db, user, board.columns[0].id, delete_cards=True)
    assert len(svc.get_board(db, user, board.id).columns) == 2


def test_delete_column_bad_targets(db, user):
    b1, b2 = make_board(db, user), make_board(db, user)
    svc.create_card(db, user, b1.columns[0].id, "a")
    with pytest.raises(svc.InvalidRequest):
        svc.delete_column(db, user, b1.columns[0].id, move_cards_to=b2.columns[0].id)
    with pytest.raises(svc.InvalidRequest):
        svc.delete_column(db, user, b1.columns[0].id, move_cards_to=b1.columns[0].id)
    with pytest.raises(svc.InvalidRequest):
        svc.delete_column(db, user, b1.columns[0].id, move_cards_to=b1.columns[1].id, delete_cards=True)
    assert len(svc.get_board(db, user, b1.id).columns[0].cards) == 1


def test_delete_board_removes_everything(db, user):
    board = make_board(db, user)
    svc.create_card(db, user, board.columns[0].id, "a")
    svc.delete_board(db, user, board.id)
    with pytest.raises(svc.NotFound):
        svc.get_board(db, user, board.id)
    with get_engine().connect() as conn:
        from sqlalchemy import text

        assert conn.execute(text("select count(*) from cards")).scalar_one() == 0
        assert conn.execute(text("select count(*) from columns")).scalar_one() == 0


# --- service: ownership ------------------------------------------------------------------


def test_service_ownership_isolation(db, user, other):
    board = make_board(db, user)
    col = board.columns[0]
    card = svc.create_card(db, user, col.id, "a")
    calls = [
        lambda: svc.get_board(db, other, board.id),
        lambda: svc.update_board(db, other, board.id, "x"),
        lambda: svc.delete_board(db, other, board.id),
        lambda: svc.create_column(db, other, board.id, "x"),
        lambda: svc.update_column(db, other, col.id, title="x"),
        lambda: svc.delete_column(db, other, col.id),
        lambda: svc.create_card(db, other, col.id, "x"),
        lambda: svc.update_card(db, other, card.id, title="x"),
        lambda: svc.move_card(db, other, card.id, col.id),
        lambda: svc.delete_card(db, other, card.id),
    ]
    for call in calls:
        with pytest.raises(svc.NotFound):
            call()
    assert svc.list_boards(db, other) == []
    # nothing changed for the owner
    assert svc.get_board(db, user, board.id).title == "Board"
    assert titles(svc.get_board(db, user, board.id).columns[0].cards) == ["a"]


def test_cannot_move_card_into_another_users_column(db, user, other):
    mine = make_board(db, user)
    theirs = make_board(db, other)
    card = svc.create_card(db, user, mine.columns[0].id, "a")
    with pytest.raises(svc.NotFound):
        svc.move_card(db, user, card.id, theirs.columns[0].id)


# --- HTTP --------------------------------------------------------------------------------


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_all_board_routes_require_auth(client):
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith(("/api/boards", "/api/columns", "/api/cards")):
            method = next(iter(route.methods))
            res = client.request(method, route.path.replace("{board_id}", "1").replace("{column_id}", "1").replace("{card_id}", "1"))
            assert res.status_code == 401, route.path


def test_http_full_flow(client, register_and_login):
    h = auth(register_and_login())
    res = client.post("/api/boards", json={"title": " Sprint ", "columns": ["Todo", "Done"]}, headers=h)
    assert res.status_code == 201
    board = res.json()
    assert board["title"] == "Sprint"
    todo, done = board["columns"]

    card = client.post(f"/api/columns/{todo['id']}/cards", json={"title": "Write"}, headers=h).json()
    assert card["position"] == 0 and card["description"] == ""
    card = client.patch(f"/api/cards/{card['id']}", json={"description": "d"}, headers=h).json()
    assert card["description"] == "d" and card["title"] == "Write"
    card = client.post(f"/api/cards/{card['id']}/move", json={"column_id": done["id"]}, headers=h).json()
    assert card["column_id"] == done["id"]

    col = client.patch(f"/api/columns/{done['id']}", json={"position": 0}, headers=h).json()
    assert col["position"] == 0 and len(col["cards"]) == 1

    got = client.get(f"/api/boards/{board['id']}", headers=h).json()
    assert [c["title"] for c in got["columns"]] == ["Done", "Todo"]

    assert client.delete(f"/api/columns/{done['id']}", headers=h).status_code == 409
    assert client.delete(f"/api/columns/{done['id']}?move_cards_to={todo['id']}", headers=h).status_code == 204
    assert client.delete(f"/api/cards/{card['id']}", headers=h).status_code == 204
    assert client.delete(f"/api/boards/{board['id']}", headers=h).status_code == 204
    assert client.get("/api/boards", headers=h).json() == []


def test_http_validation(client, register_and_login):
    h = auth(register_and_login())
    assert client.post("/api/boards", json={"title": "  "}, headers=h).status_code == 422
    board = client.post("/api/boards", json={"title": "b", "columns": ["c"]}, headers=h).json()
    col = board["columns"][0]["id"]
    assert client.post(f"/api/columns/{col}/cards", json={"title": "x", "position": -1}, headers=h).status_code == 422
    assert client.get("/api/boards/9999", headers=h).status_code == 404


def test_http_ignores_client_supplied_owner(client, register_and_login):
    a, b = auth(register_and_login("a@example.com")), auth(register_and_login("b@example.com"))
    res = client.post("/api/boards", json={"title": "mine", "owner_id": 2}, headers=a)
    assert client.get(f"/api/boards/{res.json()['id']}", headers=b).status_code == 404


def test_http_user_b_gets_404_on_user_a_data(client, register_and_login):
    a, b = auth(register_and_login("a@example.com")), auth(register_and_login("b@example.com"))
    board = client.post("/api/boards", json={"title": "A", "columns": ["c"]}, headers=a).json()
    col = board["columns"][0]["id"]
    card = client.post(f"/api/columns/{col}/cards", json={"title": "t"}, headers=a).json()["id"]

    requests = [
        ("get", f"/api/boards/{board['id']}", None),
        ("patch", f"/api/boards/{board['id']}", {"title": "x"}),
        ("delete", f"/api/boards/{board['id']}", None),
        ("post", f"/api/boards/{board['id']}/columns", {"title": "x"}),
        ("patch", f"/api/columns/{col}", {"title": "x"}),
        ("delete", f"/api/columns/{col}", None),
        ("post", f"/api/columns/{col}/cards", {"title": "x"}),
        ("patch", f"/api/cards/{card}", {"title": "x"}),
        ("post", f"/api/cards/{card}/move", {"column_id": col}),
        ("delete", f"/api/cards/{card}", None),
    ]
    for method, url, body in requests:
        res = client.request(method, url, json=body, headers=b)
        assert res.status_code == 404, (method, url)
    assert client.get("/api/boards", headers=b).json() == []
    assert client.get(f"/api/boards/{board['id']}", headers=a).json()["columns"][0]["cards"][0]["title"] == "t"
