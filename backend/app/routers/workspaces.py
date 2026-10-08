from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.models import Workspace
from app.schemas.activity import ActivityOut
from app.schemas.ai import WorkspaceAiRequest, WorkspaceAiResponse
from app.schemas.analytics import WorkspaceOverview
from app.schemas.boards import CardHit, CardOut
from app.schemas.data_lifecycle import WorkspaceExport
from app.schemas.labels import LabelCreate, LabelOut, LabelUpdate
from app.schemas.workspaces import (
    InviteCreate,
    InviteOut,
    InviteResult,
    MemberAdd,
    MemberOut,
    RoleUpdate,
    WorkspaceCreate,
    WorkspaceDelete,
    WorkspaceOut,
    WorkspaceUpdate,
)
from app.services import activity as activity_svc
from app.services import ai_briefing, ai_usage, data_lifecycle, permissions
from app.services import analytics as analytics_svc
from app.services import labels as label_svc
from app.services import search as search_svc
from app.services import workspaces as svc

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


def _hit(card) -> CardHit:
    """A card plus where it lives, for lists shown outside their board."""
    return CardHit(
        **CardOut.model_validate(card).model_dump(),
        board_id=card.column.board_id,
        board_title=card.column.board.title,
        column_title=card.column.title,
    )


def _out(db: Session, user, workspace: Workspace) -> WorkspaceOut:
    """Attach the caller's own role so the UI never has to guess what it may offer."""
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        created_at=workspace.created_at,
        my_role=permissions.role_in(db, user, workspace.id),
        members=[MemberOut.model_validate(m) for m in workspace.members],
    )


@router.get("/workspaces", response_model=list[WorkspaceOut])
def list_workspaces(user: CurrentUser, db: DbSession):
    return [_out(db, user, w) for w in svc.list_workspaces(db, user)]


@router.post("/workspaces", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(body: WorkspaceCreate, user: CurrentUser, db: DbSession):
    workspace = svc.create_workspace(db, user, body.name)
    return _out(db, user, svc.get_workspace(db, user, workspace.id))


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceOut)
def get_workspace(workspace_id: int, user: CurrentUser, db: DbSession):
    return _out(db, user, svc.get_workspace(db, user, workspace_id))


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceOut)
def rename_workspace(workspace_id: int, body: WorkspaceUpdate, user: CurrentUser, db: DbSession):
    return _out(db, user, svc.rename_workspace(db, user, workspace_id, body.name))


@router.get("/workspaces/{workspace_id}/export", response_model=WorkspaceExport)
def export_workspace(workspace_id: int, user: CurrentUser, db: DbSession):
    return data_lifecycle.export_workspace(db, user, workspace_id)


@router.delete("/workspaces/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(workspace_id: int, body: WorkspaceDelete, user: CurrentUser, db: DbSession):
    data_lifecycle.delete_workspace(db, user, workspace_id, body.confirmation)


# --- members ----------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/members", response_model=list[MemberOut])
def list_members(workspace_id: int, user: CurrentUser, db: DbSession):
    return svc.list_members(db, user, workspace_id)


@router.post(
    "/workspaces/{workspace_id}/members",
    response_model=MemberOut,
    status_code=status.HTTP_201_CREATED,
)
def add_member(workspace_id: int, body: MemberAdd, user: CurrentUser, db: DbSession):
    return svc.add_member(db, user, workspace_id, body.email, body.role)


@router.get("/workspaces/{workspace_id}/invites", response_model=list[InviteOut])
def list_invites(workspace_id: int, user: CurrentUser, db: DbSession):
    return svc.list_invites(db, user, workspace_id)


@router.post(
    "/workspaces/{workspace_id}/invites",
    response_model=InviteResult,
    status_code=status.HTTP_201_CREATED,
)
def invite_member(workspace_id: int, body: InviteCreate, user: CurrentUser, db: DbSession):
    """Invite an email address.

    One endpoint for both cases: an address that already has an account joins immediately, an
    address that does not gets an invitation it redeems by registering. The caller is told which
    happened rather than having to guess from a status code.
    """
    try:
        invite = svc.invite_member(db, user, workspace_id, body.email, body.role)
    except svc.AlreadyRegistered:
        member = svc.add_member(db, user, workspace_id, body.email, body.role)
        return InviteResult(kind="member", member=MemberOut.model_validate(member))
    return InviteResult(kind="invite", invite=InviteOut.model_validate(invite))


@router.delete(
    "/workspaces/{workspace_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT
)
def revoke_invite(workspace_id: int, invite_id: int, user: CurrentUser, db: DbSession):
    svc.revoke_invite(db, user, workspace_id, invite_id)


@router.post(
    "/workspaces/{workspace_id}/invites/{invite_id}/resend",
    response_model=InviteOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def resend_invite(workspace_id: int, invite_id: int, user: CurrentUser, db: DbSession):
    return svc.resend_invite(db, user, workspace_id, invite_id)


@router.patch("/workspaces/{workspace_id}/members/{user_id}", response_model=MemberOut)
def change_role(
    workspace_id: int, user_id: int, body: RoleUpdate, user: CurrentUser, db: DbSession
):
    return svc.change_role(db, user, workspace_id, user_id, body.role)


@router.delete(
    "/workspaces/{workspace_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_member(workspace_id: int, user_id: int, user: CurrentUser, db: DbSession):
    svc.remove_member(db, user, workspace_id, user_id)


# --- labels -------------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/labels", response_model=list[LabelOut])
def list_labels(workspace_id: int, user: CurrentUser, db: DbSession):
    return label_svc.list_labels(db, user, workspace_id)


@router.post(
    "/workspaces/{workspace_id}/labels", response_model=LabelOut, status_code=status.HTTP_201_CREATED
)
def create_label(workspace_id: int, body: LabelCreate, user: CurrentUser, db: DbSession):
    return label_svc.create_label(db, user, workspace_id, body.name, body.color)


@router.patch("/labels/{label_id}", response_model=LabelOut)
def update_label(label_id: int, body: LabelUpdate, user: CurrentUser, db: DbSession):
    return label_svc.update_label(db, user, label_id, body.name, body.color)


@router.delete("/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_label(label_id: int, user: CurrentUser, db: DbSession):
    label_svc.delete_label(db, user, label_id)


@router.get("/workspaces/{workspace_id}/activity", response_model=list[ActivityOut])
def workspace_activity(
    workspace_id: int,
    user: CurrentUser,
    db: DbSession,
    limit: int = 50,
    before_id: int | None = None,
    board_id: int | None = None,
    actor_id: int | None = None,
):
    return activity_svc.for_workspace(db, user, workspace_id, limit, before_id, board_id, actor_id)


@router.get("/workspaces/{workspace_id}/search", response_model=list[CardHit])
def search_workspace(workspace_id: int, q: str, user: CurrentUser, db: DbSession, limit: int = 50):
    """Cards across every board in the workspace. An empty query returns nothing."""
    return [_hit(card) for card in search_svc.search_workspace(db, user, workspace_id, q, limit)]


@router.get("/my-cards", response_model=list[CardHit])
def my_cards(user: CurrentUser, db: DbSession, workspace_id: int | None = None):
    """Everything assigned to me and still open, newest deadlines first."""
    return [_hit(card) for card in search_svc.my_cards(db, user, workspace_id)]


@router.get("/workspaces/{workspace_id}/overview", response_model=WorkspaceOverview)
def workspace_overview(workspace_id: int, user: CurrentUser, db: DbSession):
    return analytics_svc.workspace_overview(db, user, workspace_id)


@router.post("/workspaces/{workspace_id}/ai", response_model=WorkspaceAiResponse)
def workspace_ai(workspace_id: int, body: WorkspaceAiRequest, user: CurrentUser, db: DbSession):
    ai_usage.reserve(db, user, workspace_id)
    from time import monotonic

    started = monotonic()
    try:
        result = ai_briefing.answer_workspace_question(db, user, workspace_id, body.question)
    except Exception:
        ai_usage.record_completion(db, workspace_id, started, 0, error=True)
        raise
    ai_usage.record_completion(db, workspace_id, started, 0)
    return result
