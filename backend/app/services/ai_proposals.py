"""Create and consume server-side, single-use AI mutation proposals."""

import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import AiProposal, User
from app.services.errors import InvalidRequest, NotFound
from app.util.time import as_utc

TTL = timedelta(minutes=15)


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def create(
    db: Session,
    user: User,
    board_id: int,
    tool: str,
    args: dict,
) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(
        AiProposal(
            token_hash=_hash(raw),
            user_id=user.id,
            board_id=board_id,
            tool=tool,
            args_json=json.dumps(args, ensure_ascii=False, separators=(",", ":")),
            expires_at=datetime.now(UTC) + TTL,
        )
    )
    db.commit()
    return raw


def consume(db: Session, user: User, board_id: int, raw: str) -> tuple[str, dict]:
    proposal = db.scalar(select(AiProposal).where(AiProposal.token_hash == _hash(raw)))
    if proposal is None or proposal.user_id != user.id or proposal.board_id != board_id:
        raise NotFound("AI proposal")
    now = datetime.now(UTC)
    if proposal.consumed_at is not None or as_utc(proposal.expires_at) <= now:
        raise InvalidRequest("This AI proposal has expired or was already used")
    # SQLite ignores SELECT ... FOR UPDATE. Claim atomically so a repeated/concurrent confirm
    # cannot execute the same mutation twice.
    claimed = db.execute(
        update(AiProposal)
        .where(
            AiProposal.id == proposal.id,
            AiProposal.consumed_at.is_(None),
            AiProposal.expires_at > now,
        )
        .values(consumed_at=now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise InvalidRequest("This AI proposal has expired or was already used")
    proposal.consumed_at = now
    db.commit()
    try:
        args = json.loads(proposal.args_json)
    except json.JSONDecodeError:
        raise InvalidRequest("This AI proposal is invalid") from None
    return proposal.tool, args
