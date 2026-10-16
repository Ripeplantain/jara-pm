"""HTTP endpoints for pages. Thin: parse, delegate, return - the service decides everything."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.schemas.notes import (
    NoteBlockPatch,
    NoteBlocksAdd,
    NoteBlocksReplace,
    NoteCreate,
    NoteDetail,
    NoteMove,
    NoteSummary,
    NoteUpdate,
    NoteVisibilityUpdate,
)
from app.services import notes as svc

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


def _blocks(body) -> list[svc.NewBlock]:
    return [svc.NewBlock(**block.model_dump()) for block in body.blocks]


@router.get("/workspaces/{workspace_id}/notes", response_model=list[NoteSummary])
def list_notes(workspace_id: int, user: CurrentUser, db: DbSession, include_archived: bool = False):
    """Flat and ordered; the client assembles the tree from `parent_id`."""
    return svc.list_notes(db, user, workspace_id, include_archived)


@router.post(
    "/workspaces/{workspace_id}/notes",
    response_model=NoteDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_note(workspace_id: int, body: NoteCreate, user: CurrentUser, db: DbSession):
    return svc.create_note(
        db,
        user,
        workspace_id,
        title=body.title,
        parent_id=body.parent_id,
        visibility=body.visibility.value if body.visibility else None,
        icon=body.icon,
        position=body.position,
        blocks=_blocks(body),
    )


@router.get("/notes/{note_id}", response_model=NoteDetail)
def get_note(note_id: int, user: CurrentUser, db: DbSession):
    return svc.note_for(db, user, note_id)


@router.patch("/notes/{note_id}", response_model=NoteDetail)
def update_note(note_id: int, body: NoteUpdate, user: CurrentUser, db: DbSession):
    """A field sent as null is left alone; an empty title is allowed, pages start untitled."""
    return svc.update_note(
        db,
        user,
        note_id,
        body.title if body.title is not None else svc.UNSET,
        body.icon if body.icon is not None else svc.UNSET,
    )


@router.put("/notes/{note_id}/visibility", response_model=NoteDetail)
def set_visibility(note_id: int, body: NoteVisibilityUpdate, user: CurrentUser, db: DbSession):
    """Owner only, and it applies to the whole subtree."""
    return svc.set_visibility(db, user, note_id, body.visibility.value)


@router.post("/notes/{note_id}/move", response_model=NoteDetail)
def move_note(note_id: int, body: NoteMove, user: CurrentUser, db: DbSession):
    """`parent_id` left out keeps the current parent; sent as null moves the page to the top."""
    sent = body.model_fields_set
    return svc.move_note(
        db,
        user,
        note_id,
        body.parent_id if "parent_id" in sent else svc.UNSET,
        body.position,
    )


@router.post("/notes/{note_id}/archive", response_model=NoteDetail)
def archive_note(note_id: int, user: CurrentUser, db: DbSession):
    return svc.archive_note(db, user, note_id)


@router.post("/notes/{note_id}/unarchive", response_model=NoteDetail)
def unarchive_note(note_id: int, user: CurrentUser, db: DbSession):
    return svc.unarchive_note(db, user, note_id)


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(note_id: int, user: CurrentUser, db: DbSession):
    svc.delete_note(db, user, note_id)


@router.put("/notes/{note_id}/blocks", response_model=NoteDetail)
def replace_blocks(note_id: int, body: NoteBlocksReplace, user: CurrentUser, db: DbSession):
    """The editor's save: the page's whole body, in one transaction."""
    return svc.replace_blocks(db, user, note_id, _blocks(body))


@router.post("/notes/{note_id}/blocks", response_model=NoteDetail)
def add_blocks(note_id: int, body: NoteBlocksAdd, user: CurrentUser, db: DbSession):
    return svc.add_blocks(db, user, note_id, _blocks(body), body.position)


@router.patch("/note-blocks/{block_id}", response_model=NoteDetail)
def patch_block(block_id: int, body: NoteBlockPatch, user: CurrentUser, db: DbSession):
    """One block, without resending the page. Returns the page, since positions may shift."""
    return svc.patch_block(
        db,
        user,
        block_id,
        text=body.text if body.text is not None else svc.UNSET,
        type=body.type if body.type is not None else svc.UNSET,
        checked=body.checked if body.checked is not None else svc.UNSET,
        indent=body.indent if body.indent is not None else svc.UNSET,
    )


@router.get("/cards/{card_id}/notes", response_model=list[NoteSummary])
def notes_for_card(card_id: int, user: CurrentUser, db: DbSession):
    """The card's backlinks: pages that embed it, and that this user can see."""
    return svc.notes_linking_to(db, user, "card", card_id)
