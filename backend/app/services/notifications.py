"""In-app notifications.

`notify()` is called from inside the mutating service functions, in the same transaction, and
never for the person who did the thing. Mentions are parsed out of comment bodies: `@name` or
`@email`, matched against the workspace's members only.
"""

import re
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import Notification, User, WorkspaceMember
from app.services.errors import NotFound
from app.util.time import now

ASSIGNED = "card.assigned"
MENTIONED = "card.mentioned"
COMPLETED = "card.completed"
COMMENTED = "card.commented"
AI_SIGNAL = "ai.signal"

# @ followed by a name, an email, or a dotted handle. Deliberately conservative.
MENTION = re.compile(r"@([\w.\-+]+(?:@[\w.\-]+)?)")


def notify(
    db: Session,
    recipient_id: int | None,
    actor: User | None,
    workspace_id: int,
    kind: str,
    title: str,
    body: str = "",
    board_id: int | None = None,
    card_id: int | None = None,
) -> Notification | None:
    """Add one notification, unless it would tell someone about their own action."""
    if recipient_id is None or (actor is not None and recipient_id == actor.id):
        return None
    entry = Notification(
        user_id=recipient_id,
        workspace_id=workspace_id,
        kind=kind,
        title=title[:200],
        body=body[:500],
        board_id=board_id,
        card_id=card_id,
        actor_id=actor.id if actor else None,
    )
    db.add(entry)
    return entry


def sync_ai_signals(db: Session, user: User, workspace_id: int, signals: list[dict]) -> int:
    """Create at most one unread/recent notification for each dashboard signal.

    The overview is intentionally idempotent: rendering the dashboard repeatedly must not flood
    the notification center. A one-day cooldown lets a persistent issue be surfaced again after
    it has had time to be noticed, while a changed title/card naturally creates a new signal.
    """
    cutoff = now() - timedelta(days=1)
    created = 0
    for signal in signals:
        existing = db.scalar(
            select(Notification).where(
                Notification.user_id == user.id,
                Notification.workspace_id == workspace_id,
                Notification.kind == AI_SIGNAL,
                Notification.board_id == signal["board_id"],
                Notification.card_id == signal.get("card_id"),
                Notification.title == signal["title"][:200],
                Notification.created_at >= cutoff,
            )
        )
        if existing is not None:
            continue
        db.add(
            Notification(
                user_id=user.id,
                workspace_id=workspace_id,
                kind=AI_SIGNAL,
                title=signal["title"][:200],
                body=signal.get("detail", "")[:500],
                board_id=signal["board_id"],
                card_id=signal.get("card_id"),
            )
        )
        created += 1
    if created:
        db.commit()
    return created


def mentioned_members(db: Session, workspace_id: int, text: str) -> list[User]:
    """People named with @ in `text` who are actually members of this workspace.

    Matching is by email or by display name with spaces removed, case-insensitively, so both
    `@ada@example.com` and `@AdaLovelace` find the same person. Anything else is just text.
    """
    handles = {h.lower() for h in MENTION.findall(text or "")}
    if not handles:
        return []
    members = db.scalars(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id)
    )
    found = []
    for member in members:
        user = member.user
        names = {user.email.lower(), user.name.lower().replace(" ", ""), user.email.split("@")[0].lower()}
        if names & handles:
            found.append(user)
    return found


def list_for(
    db: Session, user: User, unread_only: bool = False, limit: int = 50
) -> list[Notification]:
    stmt = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.id.desc())
        .limit(min(limit, 200))
    )
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    return list(db.scalars(stmt))


def unread_count(db: Session, user: User) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        )
        or 0
    )


def mark_read(db: Session, user: User, notification_id: int) -> Notification:
    entry = db.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user.id
        )
    )
    if entry is None:
        raise NotFound("Notification")
    if entry.read_at is None:
        entry.read_at = now()
        db.commit()
    return entry


def mark_all_read(db: Session, user: User) -> int:
    """Returns how many were still unread, so the UI can say what it just cleared."""
    count = unread_count(db, user)
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=now())
    )
    db.commit()
    return count
