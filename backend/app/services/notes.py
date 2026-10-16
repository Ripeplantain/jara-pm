"""Pages, their blocks, and their links to board work.

The only code that writes note data; used by the HTTP routers and the AI tools, exactly as
`services/boards.py` is for boards.

Two invariants are worth stating up front.

**Ordering.** A page's siblings under one parent hold contiguous positions 0..n-1, and so do the
blocks inside a page. Every mutation renumbers the affected siblings and commits once. Positions
span *all* siblings whatever their visibility, so the ordering stays gap-free even though no
single user can see the whole of it - which is why inserts are counted in the siblings the acting
user can see and translated onto the full list.

**Visibility.** A private page is its owner's alone, and `services/permissions.py` decides that.
Here, two consequences are enforced: a page inside a private page is private too (a shared child
of a parent nobody can open would be listed and unreachable), and a private page writes no
activity and sends no notifications, because both are workspace-visible and neither can be
filtered after the fact.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    BLOCK_TYPES,
    MAX_INDENT,
    Activity,
    Board,
    Card,
    Column,
    Note,
    NoteBlock,
    NoteLink,
    NoteVisibility,
    User,
    WorkspaceRole,
)
from app.services import activity, notifications, permissions
from app.services.boards import _fresh, _renumber, board_for, card_for
from app.services.errors import Forbidden, InvalidRequest, NotFound

VIEWER = WorkspaceRole.VIEWER
MEMBER = WorkspaceRole.MEMBER

MAX_BLOCKS = 2_000
"""A page is a page, not a database. The schema caps each block's text as well."""

EDIT_HISTORY_COOLDOWN = timedelta(minutes=5)
"""Editing is autosaved, so one activity row per keystroke-batch would drown the feed. One row
per actor per page per five minutes reads like "someone worked on this page", which is what the
feed is for."""

UNSET: Any = object()
"""Sentinel for "leave this field alone", so None can mean "clear it" - as in `services/boards`."""


@dataclass
class NewBlock:
    """One block on the way in. `id` lets a document save keep existing rows rather than
    replacing them, so the editor's block identities survive a save."""

    type: str = BLOCK_TYPES[0]
    text: str = ""
    checked: bool = False
    indent: int = 0
    ref_card_id: int | None = None
    ref_board_id: int | None = None
    id: int | None = None


# --- scoped lookups ---------------------------------------------------------------------------


def _resolve_embeds(db: Session, note: Note) -> Note:
    """Fill in each embed block's `ref_title` from the card or board it points at.

    Two queries at most, and only when the page actually embeds something. A reference whose
    target has since been deleted keeps an empty title, which the UI shows as unavailable - the
    block is deliberately not removed, because a page's body is the user's text, not a cache.
    """
    card_ids = {b.ref_card_id for b in note.blocks if b.ref_card_id is not None}
    board_ids = {b.ref_board_id for b in note.blocks if b.ref_board_id is not None}
    titles: dict[tuple[str, int], str] = {}
    boards_of_cards: dict[int, int] = {}
    if card_ids:
        rows = db.execute(
            select(Card.id, Card.title, Column.board_id)
            .join(Column, Card.column_id == Column.id)
            .where(Card.id.in_(card_ids))
        )
        for cid, title, board_id in rows:
            titles[("card", cid)] = title
            boards_of_cards[cid] = board_id
    if board_ids:
        for bid, title in db.execute(select(Board.id, Board.title).where(Board.id.in_(board_ids))):
            titles[("board", bid)] = title
    for block in note.blocks:
        if block.ref_card_id is not None:
            block.ref_title = titles.get(("card", block.ref_card_id), "")
            block.ref_card_board_id = boards_of_cards.get(block.ref_card_id)
        elif block.ref_board_id is not None:
            block.ref_title = titles.get(("board", block.ref_board_id), "")
    return note


def note_for(db: Session, user: User, note_id: int, minimum: WorkspaceRole = VIEWER) -> Note:
    """Load a page the user may act on. `permissions.require_note` is what decides.

    The visibility filter is applied to the query as well, so a caller that somehow skipped the
    permission check still cannot load someone else's private page.
    """
    permissions.require_note(db, user, note_id, minimum)
    note = db.scalar(
        _fresh(
            select(Note)
            .options(selectinload(Note.blocks))
            .where(Note.id == note_id, permissions.note_visibility_filter(user))
        )
    )
    if note is None:
        raise NotFound("Note")
    return _resolve_embeds(db, note)


def list_notes(
    db: Session, user: User, workspace_id: int, include_archived: bool = False
) -> list[Note]:
    """Every page the user can see, flat and ordered: roots first, then grouped by parent.

    Flat rather than nested on purpose - the caller assembles the tree, and a flat list is also
    what the AI reads. A visible page always has a visible parent, because visibility is
    inherited downwards, so the list can never contain an orphan.
    """
    permissions.require_workspace(db, user, workspace_id)
    stmt = (
        select(Note)
        .where(Note.workspace_id == workspace_id, permissions.note_visibility_filter(user))
        .order_by(Note.parent_id.is_(None).desc(), Note.parent_id, Note.position, Note.id)
    )
    if not include_archived:
        stmt = stmt.where(Note.archived_at.is_(None))
    return list(db.scalars(_fresh(stmt)))


def _siblings(db: Session, workspace_id: int, parent_id: int | None) -> list[Note]:
    """The ordered, live pages under one parent - private ones included, archived ones not.

    Archived pages leave the ordering entirely, the way archived cards do, which is what keeps
    the visible positions contiguous.
    """
    stmt = (
        select(Note)
        .where(Note.workspace_id == workspace_id, Note.archived_at.is_(None))
        .order_by(Note.position, Note.id)
    )
    stmt = stmt.where(
        Note.parent_id.is_(None) if parent_id is None else Note.parent_id == parent_id
    )
    return list(db.scalars(_fresh(stmt)))


def _descendants(db: Session, note: Note) -> list[Note]:
    """Every page under this one. Visibility and archiving are inherited down this list."""
    found: list[Note] = []
    frontier = [note.id]
    while frontier:
        children = list(db.scalars(select(Note).where(Note.parent_id.in_(frontier))))
        if not children:
            break
        found.extend(children)
        frontier = [child.id for child in children]
    return found


def _insert_among_visible(
    user: User, siblings: list[Note], note: Note, position: int | None
) -> None:
    """Insert at `position` counted in the siblings the user can see, then renumber them all.

    `siblings` must not already contain `note`. A position past the end, or none at all, means
    the end of the list.
    """
    visible = [n for n in siblings if permissions.may_read_note(user, n)]
    if position is None or position >= len(visible):
        index = len(siblings)
    else:
        index = siblings.index(visible[max(position, 0)])
    siblings.insert(index, note)
    _renumber(siblings)


# --- history and notifications ----------------------------------------------------------------


def _label(note: Note) -> str:
    return note.title or "Untitled"


def _touch(note: Note) -> None:
    """Editing a block is editing the page: "recently edited" must notice."""
    note.updated_at = datetime.now(UTC)


def _record(db: Session, user: User, note: Note, action: str, summary: str) -> None:
    """One history row, unless the page is private - see `activity.NOTE`."""
    if note.is_private:
        return
    activity.record(
        db,
        user,
        note.workspace_id,
        action,
        summary,
        entity_type=activity.NOTE,
        entity_id=note.id,
    )


def _record_edit(db: Session, user: User, note: Note) -> None:
    """`note.updated` for a body edit, at most once per cooldown so autosave cannot flood."""
    if note.is_private:
        return
    recent = db.scalar(
        select(Activity).where(
            Activity.workspace_id == note.workspace_id,
            Activity.entity_type == activity.NOTE,
            Activity.entity_id == note.id,
            Activity.action == activity.NOTE_UPDATED,
            Activity.actor_id == user.id,
            Activity.created_at >= datetime.now(UTC) - EDIT_HISTORY_COOLDOWN,
        )
    )
    if recent is None:
        _record(db, user, note, activity.NOTE_UPDATED, f"edited the page “{_label(note)}”")


def _notify_mentions(
    db: Session, user: User, note: Note, new_text: str, old_text: str = ""
) -> None:
    """Tell the people newly named with @ in a shared page.

    Only the people who were not already mentioned in the previous body are told, because the
    editor autosaves and nobody wants the same mention delivered on every keystroke.
    """
    if note.is_private:
        return
    already = {person.id for person in notifications.mentioned_members(db, note.workspace_id, old_text)}
    for person in notifications.mentioned_members(db, note.workspace_id, new_text):
        if person.id in already:
            continue
        notifications.notify(
            db,
            person.id,
            user,
            note.workspace_id,
            notifications.NOTE_MENTIONED,
            f"{user.name} mentioned you in “{_label(note)}”",
            new_text[:500],
            entity_type=activity.NOTE,
            entity_id=note.id,
        )


def _notify_links(db: Session, user: User, note: Note, added: set[tuple[str, int]]) -> None:
    """Tell a card's assignee when a shared page starts pointing at their card."""
    if note.is_private:
        return
    for target_type, target_id in sorted(added):
        if target_type != "card":
            continue
        card = db.get(Card, target_id)
        if card is None:
            continue
        notifications.notify(
            db,
            card.assignee_id,
            user,
            note.workspace_id,
            notifications.NOTE_LINKED,
            f"{user.name} linked “{card.title}” from a page",
            _label(note),
            card_id=card.id,
            entity_type=activity.NOTE,
            entity_id=note.id,
        )


# --- pages ------------------------------------------------------------------------------------


def _visibility_for_child(parent: Note | None, asked: str | None) -> NoteVisibility:
    """A subpage of a private page is private, whatever was asked for."""
    if parent is not None and parent.is_private:
        return NoteVisibility.PRIVATE
    if asked is not None:
        return NoteVisibility(asked)
    return parent.visibility_enum if parent is not None else NoteVisibility.WORKSPACE


def create_note(
    db: Session,
    user: User,
    workspace_id: int,
    title: str = "",
    parent_id: int | None = None,
    visibility: str | None = None,
    icon: str = "",
    position: int | None = None,
    blocks: list[NewBlock] | None = None,
) -> Note:
    """Create a page, optionally with a body. Everything is checked before the first write."""
    permissions.require_workspace(db, user, workspace_id, MEMBER)
    parent = None
    if parent_id is not None:
        parent = note_for(db, user, parent_id, MEMBER)
        if parent.workspace_id != workspace_id:
            raise InvalidRequest("That parent page belongs to a different workspace")

    body = blocks or []
    _check_block_count(len(body))
    for new in body:
        _check_block(db, user, workspace_id, new)

    siblings = _siblings(db, workspace_id, parent.id if parent else None)
    note = Note(
        workspace_id=workspace_id,
        parent_id=parent.id if parent else None,
        owner_id=user.id,
        title=title,
        icon=icon,
        visibility=_visibility_for_child(parent, visibility).value,
        position=0,
    )
    db.add(note)
    db.flush()
    _insert_among_visible(user, siblings, note, position)

    for index, new in enumerate(body):
        block = NoteBlock(note_id=note.id, position=index)
        _apply_block(block, new)
        db.add(block)
    db.flush()

    added = _sync_links(db, note)
    _record(db, user, note, activity.NOTE_CREATED, f"created the page “{_label(note)}”")
    _notify_mentions(db, user, note, "\n".join(new.text for new in body))
    _notify_links(db, user, note, added)
    db.commit()
    return note_for(db, user, note.id)


def update_note(
    db: Session, user: User, note_id: int, title: Any = UNSET, icon: Any = UNSET
) -> Note:
    """Rename a page or change its icon. Absent fields are left alone."""
    note = note_for(db, user, note_id, MEMBER)
    renamed = title is not UNSET and title != note.title
    if title is not UNSET:
        note.title = title
    if icon is not UNSET:
        note.icon = icon
    _touch(note)
    if renamed:
        _record(db, user, note, activity.NOTE_UPDATED, f"renamed a page to “{_label(note)}”")
    db.commit()
    return note_for(db, user, note.id)


def set_visibility(db: Session, user: User, note_id: int, visibility: str) -> Note:
    """Who can see this page. Only its owner decides.

    An admin cannot un-private someone else's page: the role table governs workspace data, and a
    private page is personal. The change applies to the whole subtree, so a subpage is never
    more visible than the page it sits in.
    """
    note = note_for(db, user, note_id, MEMBER)
    if note.owner_id != user.id:
        raise Forbidden("Only the page's owner can change who can see it")
    chosen = NoteVisibility(visibility)
    if chosen is NoteVisibility.WORKSPACE and note.parent_id is not None:
        parent = db.get(Note, note.parent_id)
        if parent is not None and parent.is_private:
            raise InvalidRequest("This page sits inside a private page; move it out first")

    for page in [note, *_descendants(db, note)]:
        page.visibility = chosen.value
    _touch(note)
    # Going private records nothing, because `_record` skips a private page - which is the point.
    summary = (
        f"made the page “{_label(note)}” private"
        if chosen is NoteVisibility.PRIVATE
        else f"shared the page “{_label(note)}” with the workspace"
    )
    _record(db, user, note, activity.NOTE_UPDATED, summary)
    db.commit()
    return note_for(db, user, note.id)


def move_note(
    db: Session, user: User, note_id: int, parent_id: Any = UNSET, position: int | None = None
) -> Note:
    """Reparent and/or reorder a page. Both sibling lists end up contiguous."""
    note = note_for(db, user, note_id, MEMBER)
    old_parent_id = note.parent_id
    new_parent_id = old_parent_id if parent_id is UNSET else parent_id

    if new_parent_id is not None:
        if new_parent_id == note.id:
            raise InvalidRequest("A page cannot be its own parent")
        parent = note_for(db, user, new_parent_id, MEMBER)
        if parent.workspace_id != note.workspace_id:
            raise InvalidRequest("That parent page belongs to a different workspace")
        if parent.id in {page.id for page in _descendants(db, note)}:
            raise InvalidRequest("A page cannot be moved inside one of its own subpages")
        if parent.is_private and not note.is_private:
            raise InvalidRequest("That parent page is private; make this page private first")

    if new_parent_id != old_parent_id:
        _renumber(
            [n for n in _siblings(db, note.workspace_id, old_parent_id) if n.id != note.id]
        )
        note.parent_id = new_parent_id

    siblings = [n for n in _siblings(db, note.workspace_id, new_parent_id) if n.id != note.id]
    _insert_among_visible(user, siblings, note, position)
    _touch(note)
    _record(db, user, note, activity.NOTE_MOVED, f"moved the page “{_label(note)}”")
    db.commit()
    return note_for(db, user, note.id)


def archive_note(db: Session, user: User, note_id: int) -> Note:
    """Archive a page and its subpages. Reversible, which is why it needs no confirmation."""
    note = note_for(db, user, note_id, MEMBER)
    if note.archived_at is None:
        when = datetime.now(UTC)
        note.archived_at = when
        for page in _descendants(db, note):
            page.archived_at = when
        _renumber([n for n in _siblings(db, note.workspace_id, note.parent_id) if n.id != note.id])
        _record(db, user, note, activity.NOTE_ARCHIVED, f"archived the page “{_label(note)}”")
        db.commit()
    return note_for(db, user, note.id)


def unarchive_note(db: Session, user: User, note_id: int) -> Note:
    """Restore a page to the end of its sibling list, with its subpages."""
    note = note_for(db, user, note_id, MEMBER)
    if note.archived_at is not None:
        siblings = _siblings(db, note.workspace_id, note.parent_id)
        note.archived_at = None
        for page in _descendants(db, note):
            page.archived_at = None
        _insert_among_visible(user, siblings, note, None)
        _record(db, user, note, activity.NOTE_UNARCHIVED, f"restored the page “{_label(note)}”")
        db.commit()
    return note_for(db, user, note.id)


def delete_note(db: Session, user: User, note_id: int) -> None:
    """Hard delete, with the subpages, blocks and links under it. The owner or an admin only."""
    note = note_for(db, user, note_id, MEMBER)
    role = permissions.role_in(db, user, note.workspace_id)
    if note.owner_id != user.id and not (role is not None and role.at_least(permissions.ADMIN)):
        raise Forbidden("Only the page's owner or a workspace admin can delete it")
    siblings = [n for n in _siblings(db, note.workspace_id, note.parent_id) if n.id != note.id]
    # Written before the delete: history outlives its subject, and `entity_id` is a plain
    # integer precisely so this row survives.
    _record(db, user, note, activity.NOTE_DELETED, f"deleted the page “{_label(note)}”")
    db.delete(note)
    _renumber(siblings)
    db.commit()


# --- blocks -----------------------------------------------------------------------------------


def _blocks_of(db: Session, note_id: int) -> list[NoteBlock]:
    return list(
        db.scalars(
            _fresh(
                select(NoteBlock)
                .where(NoteBlock.note_id == note_id)
                .order_by(NoteBlock.position, NoteBlock.id)
            )
        )
    )


def _check_block_count(count: int) -> None:
    if count > MAX_BLOCKS:
        raise InvalidRequest(f"A page holds at most {MAX_BLOCKS} blocks")


def _check_block(db: Session, user: User, workspace_id: int, new: NewBlock) -> None:
    """Validate one block before anything is written, embeds against real state included."""
    if new.type not in BLOCK_TYPES:
        raise InvalidRequest(f"Unknown block type “{new.type}”")
    if not 0 <= new.indent <= MAX_INDENT:
        raise InvalidRequest(f"A block's indent must be between 0 and {MAX_INDENT}")
    if new.type == "card_embed":
        if new.ref_card_id is None:
            raise InvalidRequest("A card embed needs a card")
        card = card_for(db, user, new.ref_card_id)
        board_id = activity.board_id_of_card(db, card)
        if board_id is None or board_for(db, user, board_id).workspace_id != workspace_id:
            raise InvalidRequest("That card belongs to a different workspace")
    elif new.type == "board_embed":
        if new.ref_board_id is None:
            raise InvalidRequest("A board embed needs a board")
        if board_for(db, user, new.ref_board_id).workspace_id != workspace_id:
            raise InvalidRequest("That board belongs to a different workspace")


def _apply_block(block: NoteBlock, new: NewBlock) -> None:
    """Copy an incoming block onto a row, clearing references a non-embed block must not keep."""
    block.type = new.type
    block.text = new.text
    block.checked = new.checked if new.type == "todo" else False
    block.indent = new.indent
    block.ref_card_id = new.ref_card_id if new.type == "card_embed" else None
    block.ref_board_id = new.ref_board_id if new.type == "board_embed" else None


def _sync_links(db: Session, note: Note) -> set[tuple[str, int]]:
    """Rebuild the page's links from its embed blocks; returns the ones that are new.

    Derived, never hand-maintained: a link that disagreed with the body would make a card's
    backlink list lie.
    """
    wanted: set[tuple[str, int]] = set()
    for block in _blocks_of(db, note.id):
        if block.type == "card_embed" and block.ref_card_id is not None:
            wanted.add(("card", block.ref_card_id))
        elif block.type == "board_embed" and block.ref_board_id is not None:
            wanted.add(("board", block.ref_board_id))
    existing = {
        (link.target_type, link.target_id): link
        for link in db.scalars(select(NoteLink).where(NoteLink.note_id == note.id))
    }
    for key, link in existing.items():
        if key not in wanted:
            db.delete(link)
    added = wanted - set(existing)
    for target_type, target_id in sorted(added):
        db.add(NoteLink(note_id=note.id, target_type=target_type, target_id=target_id))
    return added


def replace_blocks(db: Session, user: User, note_id: int, blocks: list[NewBlock]) -> Note:
    """Save a page's whole body in one transaction.

    Blocks that arrive with an `id` this page already has are updated in place rather than
    replaced, so the editor's block identities survive a save and a half-finished save cannot
    leave the page empty. Blocks the save leaves out are deleted.
    """
    note = note_for(db, user, note_id, MEMBER)
    _check_block_count(len(blocks))
    for new in blocks:
        _check_block(db, user, note.workspace_id, new)

    existing = {block.id: block for block in _blocks_of(db, note.id)}
    old_text = "\n".join(block.text for block in existing.values())
    kept: list[NoteBlock] = []
    seen: set[int] = set()
    for index, new in enumerate(blocks):
        block = existing.get(new.id) if new.id is not None else None
        if block is None:
            block = NoteBlock(note_id=note.id)
            db.add(block)
        else:
            seen.add(block.id)
        _apply_block(block, new)
        block.position = index
        kept.append(block)
    for block_id, block in existing.items():
        if block_id not in seen:
            db.delete(block)
    db.flush()
    _renumber(kept)

    added = _sync_links(db, note)
    _touch(note)
    _record_edit(db, user, note)
    _notify_mentions(db, user, note, "\n".join(new.text for new in blocks), old_text)
    _notify_links(db, user, note, added)
    db.commit()
    return note_for(db, user, note.id)


def add_blocks(
    db: Session, user: User, note_id: int, blocks: list[NewBlock], position: int | None = None
) -> Note:
    """Insert blocks into a page without resending the rest of it: the AI's append, and the
    editor's quick add."""
    note = note_for(db, user, note_id, MEMBER)
    existing = _blocks_of(db, note.id)
    _check_block_count(len(existing) + len(blocks))
    for new in blocks:
        _check_block(db, user, note.workspace_id, new)

    index = len(existing) if position is None else min(max(position, 0), len(existing))
    created: list[NoteBlock] = []
    for offset, new in enumerate(blocks):
        block = NoteBlock(note_id=note.id, position=index + offset)
        _apply_block(block, new)
        db.add(block)
        created.append(block)
    existing[index:index] = created
    db.flush()
    _renumber(existing)

    added = _sync_links(db, note)
    _touch(note)
    _record_edit(db, user, note)
    _notify_mentions(db, user, note, "\n".join(new.text for new in blocks))
    _notify_links(db, user, note, added)
    db.commit()
    return note_for(db, user, note.id)


def patch_block(
    db: Session,
    user: User,
    block_id: int,
    text: Any = UNSET,
    type: Any = UNSET,
    checked: Any = UNSET,
    indent: Any = UNSET,
) -> Note:
    """Change one block - ticking a todo, mostly - without resending the page."""
    block = db.get(NoteBlock, block_id)
    if block is None:
        raise NotFound("Block")
    try:
        note = note_for(db, user, block.note_id, MEMBER)
    except NotFound:
        raise NotFound("Block") from None

    new = NewBlock(
        type=block.type if type is UNSET else type,
        text=block.text if text is UNSET else text,
        checked=block.checked if checked is UNSET else checked,
        indent=block.indent if indent is UNSET else indent,
        ref_card_id=block.ref_card_id,
        ref_board_id=block.ref_board_id,
        id=block.id,
    )
    _check_block(db, user, note.workspace_id, new)
    old_text = block.text
    _apply_block(block, new)
    db.flush()

    added = _sync_links(db, note)
    _touch(note)
    _record_edit(db, user, note)
    _notify_mentions(db, user, note, new.text, old_text)
    _notify_links(db, user, note, added)
    db.commit()
    return note_for(db, user, note.id)


# --- links ------------------------------------------------------------------------------------


def notes_linking_to(
    db: Session, user: User, target_type: str, target_id: int
) -> list[Note]:
    """The pages the user can see that point at one card or board: its backlinks.

    Someone else's private page that mentions your card stays invisible, which is the whole
    point of the visibility filter being a single expression.
    """
    if target_type not in ("card", "board"):
        raise InvalidRequest("A link target is a card or a board")
    if target_type == "card":
        card_for(db, user, target_id)
    else:
        board_for(db, user, target_id)
    return list(
        db.scalars(
            _fresh(
                select(Note)
                .join(NoteLink, NoteLink.note_id == Note.id)
                .where(
                    NoteLink.target_type == target_type,
                    NoteLink.target_id == target_id,
                    Note.archived_at.is_(None),
                    permissions.note_visibility_filter(user),
                )
                .order_by(Note.updated_at.desc(), Note.id)
            )
        )
    )


__all__ = [
    "Forbidden",
    "InvalidRequest",
    "NewBlock",
    "NotFound",
    "add_blocks",
    "archive_note",
    "create_note",
    "delete_note",
    "list_notes",
    "move_note",
    "note_for",
    "notes_linking_to",
    "patch_block",
    "replace_blocks",
    "set_visibility",
    "unarchive_note",
    "update_note",
]
