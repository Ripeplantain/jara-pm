"""Restore proof for the single-replica SQLite beta topology."""

import sqlite3
from pathlib import Path

from app.db import get_engine


def headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_sqlite_backup_restore_preserves_workspace_rows(client, register_and_login, tmp_path: Path):
    owner_token = register_and_login("backup-owner@example.com")
    owner = headers(owner_token)
    workspace = client.get("/api/workspaces", headers=owner).json()[0]
    teammate_token = register_and_login("backup-teammate@example.com")
    teammate_id = client.get("/api/me", headers=headers(teammate_token)).json()["id"]
    assert client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"email": "backup-teammate@example.com", "role": "member"},
        headers=owner,
    ).status_code == 201

    board = client.post(
        "/api/boards",
        json={"title": "Backup board", "columns": ["Todo"]},
        headers=owner,
    ).json()
    card = client.post(
        f"/api/columns/{board['columns'][0]['id']}/cards",
        json={"title": "Preserve this card", "assignee_id": teammate_id},
        headers=owner,
    )
    assert card.status_code == 201
    source_path = Path(str(get_engine().url.database))
    restored_path = tmp_path / "restored.db"
    source = sqlite3.connect(source_path)
    restored = sqlite3.connect(restored_path)
    try:
        assert source.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        source.backup(restored)
        assert restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        for table in ("workspaces", "workspace_members", "cards", "activities", "notifications"):
            before = source.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            after = restored.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            assert before == after and before > 0, table
    finally:
        restored.close()
        source.close()
