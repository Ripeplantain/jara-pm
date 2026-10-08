import type { AiResponse, ChatMessage, WorkspaceAiResponse } from "@/lib/types/ai";
import type { Activity, Notification } from "@/lib/types/activity";
import type { BoardAnalytics, WorkspaceOverview } from "@/lib/types/analytics";
import type { User } from "@/lib/types/auth";
import type {
  Board,
  BoardSummary,
  BoardTemplate,
  Card,
  CardHit,
  Column,
  Priority,
} from "@/lib/types/board";
import type { ChecklistItem, Comment } from "@/lib/types/card-detail";
import type { Label } from "@/lib/types/label";
import type { Sprint, SprintProgress } from "@/lib/types/sprint";
import type {
  Invite,
  InviteResult,
  Member,
  OnboardingStatus,
  Role,
  Workspace,
} from "@/lib/types/workspace";

/** Browser-side client. Talks to the same-origin proxy (app/api/backend), never to FastAPI. */
export class RequestError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/backend${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new RequestError("Network error. Check your connection and try again.");
  }
  // The proxy redirects to sign-in when the session cookie is gone.
  if (res.status === 401 || res.redirected) {
    // Full navigation on purpose: this runs outside React and must clear the session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/signout");
    throw new RequestError("Your session has expired.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new RequestError(
      typeof detail === "string" ? detail : `Request failed (${res.status}). Please try again.`,
    );
  }
  return data as T;
}

/** Query string from defined values only, with ISO dates safely encoded. */
function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  return search.size ? `?${search}` : "";
}

export interface CardPatch {
  title?: string;
  description?: string;
  /** null clears the field; leaving it out keeps it. */
  assignee_id?: number | null;
  priority?: Priority;
  due_date?: string | null;
  estimate?: number | null;
}

export interface CardFilters {
  q?: string;
  assignee_id?: number;
  label_id?: number;
  priority?: Priority;
  due_before?: string;
  sprint_id?: number;
  archived?: boolean;
}

export const api = {
  // --- me ---------------------------------------------------------------------------------
  getMe: () => request<User>("GET", "/me"),
  updateProfile: (patch: { display_name?: string; avatar_color?: string }) =>
    request<User>("PATCH", "/me", patch),
  changePassword: (current_password: string, new_password: string) =>
    request<void>("POST", "/me/password", { current_password, new_password }),

  // --- workspaces -------------------------------------------------------------------------
  listWorkspaces: () => request<Workspace[]>("GET", "/workspaces"),
  getWorkspace: (id: number) => request<Workspace>("GET", `/workspaces/${id}`),
  createWorkspace: (name: string) => request<Workspace>("POST", "/workspaces", { name }),
  renameWorkspace: (id: number, name: string) =>
    request<Workspace>("PATCH", `/workspaces/${id}`, { name }),
  deleteWorkspace: (id: number, confirmation: string) =>
    request<void>("DELETE", `/workspaces/${id}`, { confirmation }),
  exportWorkspace: (id: number) => request<Record<string, unknown>>("GET", `/workspaces/${id}/export`),
  deleteAccount: (password: string) => request<void>("DELETE", "/me", { password }),
  getOverview: (id: number) => request<WorkspaceOverview>("GET", `/workspaces/${id}/overview`),
  onboardingStatus: () => request<OnboardingStatus>("GET", "/onboarding"),
  completeOnboarding: (body: {
    workspace_name: string;
    product_context: string;
    team_size: number;
    board_template: string;
    sprint_name: string;
    sprint_goal: string;
    invites: { email: string; role: Role }[];
  }) => request<OnboardingStatus>("POST", "/onboarding", body),
  completeDemoOnboarding: () => request<OnboardingStatus>("POST", "/onboarding/demo"),

  // --- members and invitations -------------------------------------------------------------
  listMembers: (workspaceId: number) =>
    request<Member[]>("GET", `/workspaces/${workspaceId}/members`),
  changeRole: (workspaceId: number, userId: number, role: Role) =>
    request<Member>("PATCH", `/workspaces/${workspaceId}/members/${userId}`, { role }),
  removeMember: (workspaceId: number, userId: number) =>
    request<void>("DELETE", `/workspaces/${workspaceId}/members/${userId}`),
  listInvites: (workspaceId: number) =>
    request<Invite[]>("GET", `/workspaces/${workspaceId}/invites`),
  /** Adds them if they already have an account, invites them if not; the result says which. */
  invite: (workspaceId: number, email: string, role: Role) =>
    request<InviteResult>("POST", `/workspaces/${workspaceId}/invites`, { email, role }),
  revokeInvite: (workspaceId: number, inviteId: number) =>
    request<void>("DELETE", `/workspaces/${workspaceId}/invites/${inviteId}`),
  resendInvite: (workspaceId: number, inviteId: number) =>
    request<Invite>("POST", `/workspaces/${workspaceId}/invites/${inviteId}/resend`),

  // --- labels ------------------------------------------------------------------------------
  listLabels: (workspaceId: number) => request<Label[]>("GET", `/workspaces/${workspaceId}/labels`),
  createLabel: (workspaceId: number, name: string, color: string) =>
    request<Label>("POST", `/workspaces/${workspaceId}/labels`, { name, color }),
  updateLabel: (id: number, patch: { name?: string; color?: string }) =>
    request<Label>("PATCH", `/labels/${id}`, patch),
  deleteLabel: (id: number) => request<void>("DELETE", `/labels/${id}`),
  addLabelToCard: (cardId: number, labelId: number) =>
    request<Card>("POST", `/cards/${cardId}/labels/${labelId}`),
  removeLabelFromCard: (cardId: number, labelId: number) =>
    request<Card>("DELETE", `/cards/${cardId}/labels/${labelId}`),

  // --- boards ------------------------------------------------------------------------------
  listBoards: (workspaceId?: number) =>
    request<BoardSummary[]>("GET", `/boards${query({ workspace_id: workspaceId })}`),
  getBoard: (id: number, includeArchived = false) =>
    request<Board>("GET", `/boards/${id}${query({ include_archived: includeArchived || undefined })}`),
  createBoard: (title: string, columns: string[] = [], workspaceId?: number) =>
    request<Board>("POST", "/boards", { title, columns, workspace_id: workspaceId }),
  listTemplates: () => request<BoardTemplate[]>("GET", "/board-templates"),
  createBoardFromTemplate: (template: string, title?: string, workspaceId?: number) =>
    request<Board>("POST", "/boards/from-template", {
      template,
      title,
      workspace_id: workspaceId,
    }),
  updateBoard: (id: number, patch: { title?: string; description?: string }) =>
    request<Board>("PATCH", `/boards/${id}`, patch),
  deleteBoard: (id: number) => request<void>("DELETE", `/boards/${id}`),
  setFavorite: (id: number, favorite: boolean) =>
    request<BoardSummary>(favorite ? "PUT" : "DELETE", `/boards/${id}/favorite`),

  // --- columns -----------------------------------------------------------------------------
  createColumn: (boardId: number, title: string) =>
    request<Column>("POST", `/boards/${boardId}/columns`, { title }),
  updateColumn: (
    id: number,
    patch: { title?: string; position?: number; wip_limit?: number | null; is_done?: boolean },
  ) => request<Column>("PATCH", `/columns/${id}`, patch),
  deleteColumn: (id: number, opts: { moveCardsTo?: number; deleteCards?: boolean } = {}) =>
    request<void>(
      "DELETE",
      `/columns/${id}${query({ move_cards_to: opts.moveCardsTo, delete_cards: opts.deleteCards })}`,
    ),

  // --- cards -------------------------------------------------------------------------------
  createCard: (columnId: number, title: string, description = "") =>
    request<Card>("POST", `/columns/${columnId}/cards`, { title, description }),
  updateCard: (id: number, patch: CardPatch) => request<Card>("PATCH", `/cards/${id}`, patch),
  moveCard: (id: number, columnId: number, position: number) =>
    request<Card>("POST", `/cards/${id}/move`, { column_id: columnId, position }),
  archiveCard: (id: number) => request<Card>("POST", `/cards/${id}/archive`),
  unarchiveCard: (id: number) => request<Card>("POST", `/cards/${id}/unarchive`),
  deleteCard: (id: number) => request<void>("DELETE", `/cards/${id}`),
  listArchivedCards: (boardId: number) =>
    request<Card[]>("GET", `/boards/${boardId}/archived-cards`),
  filterCards: (boardId: number, filters: CardFilters) =>
    request<Card[]>("GET", `/boards/${boardId}/cards${query({ ...filters })}`),
  search: (workspaceId: number, q: string) =>
    request<CardHit[]>("GET", `/workspaces/${workspaceId}/search${query({ q })}`),
  myCards: (workspaceId?: number) =>
    request<CardHit[]>("GET", `/my-cards${query({ workspace_id: workspaceId })}`),

  // --- checklist and comments ----------------------------------------------------------------
  listChecklist: (cardId: number) => request<ChecklistItem[]>("GET", `/cards/${cardId}/checklist`),
  addChecklistItem: (cardId: number, text: string) =>
    request<ChecklistItem>("POST", `/cards/${cardId}/checklist`, { text }),
  updateChecklistItem: (
    id: number,
    patch: { text?: string; done?: boolean; position?: number },
  ) => request<ChecklistItem>("PATCH", `/checklist-items/${id}`, patch),
  deleteChecklistItem: (id: number) => request<void>("DELETE", `/checklist-items/${id}`),
  listComments: (cardId: number) => request<Comment[]>("GET", `/cards/${cardId}/comments`),
  addComment: (cardId: number, body: string) =>
    request<Comment>("POST", `/cards/${cardId}/comments`, { body }),
  updateComment: (id: number, body: string) => request<Comment>("PATCH", `/comments/${id}`, { body }),
  deleteComment: (id: number) => request<void>("DELETE", `/comments/${id}`),

  // --- sprints ------------------------------------------------------------------------------
  listSprints: (boardId: number) => request<Sprint[]>("GET", `/boards/${boardId}/sprints`),
  createSprint: (
    boardId: number,
    body: { name: string; goal?: string; starts_on?: string | null; ends_on?: string | null },
  ) => request<Sprint>("POST", `/boards/${boardId}/sprints`, body),
  updateSprint: (
    id: number,
    patch: { name?: string; goal?: string; starts_on?: string | null; ends_on?: string | null },
  ) => request<Sprint>("PATCH", `/sprints/${id}`, patch),
  deleteSprint: (id: number) => request<void>("DELETE", `/sprints/${id}`),
  startSprint: (id: number) => request<Sprint>("POST", `/sprints/${id}/start`),
  completeSprint: (id: number, moveUnfinishedTo?: number) =>
    request<Sprint>("POST", `/sprints/${id}/complete`, { move_unfinished_to: moveUnfinishedTo ?? null }),
  sprintProgress: (id: number) => request<SprintProgress>("GET", `/sprints/${id}/progress`),
  setCardSprint: (cardId: number, sprintId: number | null) =>
    request<Card>("PUT", `/cards/${cardId}/sprint`, { sprint_id: sprintId }),

  // --- insights -------------------------------------------------------------------------------
  boardAnalytics: (boardId: number) =>
    request<BoardAnalytics>("GET", `/boards/${boardId}/analytics`),
  boardActivity: (boardId: number, limit = 50, beforeId?: number) =>
    request<Activity[]>("GET", `/boards/${boardId}/activity${query({ limit, before_id: beforeId })}`),
  workspaceActivity: (
    workspaceId: number,
    opts: { limit?: number; beforeId?: number; boardId?: number; actorId?: number } = {},
  ) =>
    request<Activity[]>(
      "GET",
      `/workspaces/${workspaceId}/activity${query({
        limit: opts.limit,
        before_id: opts.beforeId,
        board_id: opts.boardId,
        actor_id: opts.actorId,
      })}`,
    ),

  // --- notifications ---------------------------------------------------------------------------
  listNotifications: (unreadOnly = false) =>
    request<Notification[]>("GET", `/notifications${query({ unread_only: unreadOnly || undefined })}`),
  unreadCount: () => request<{ unread: number }>("GET", "/notifications/unread-count"),
  markNotificationRead: (id: number) => request<Notification>("POST", `/notifications/${id}/read`),
  markAllNotificationsRead: () => request<{ unread: number }>("POST", "/notifications/read-all"),

  // --- ai ---------------------------------------------------------------------------------------
  askAi: (boardId: number, message: string, history: ChatMessage[]) =>
    request<AiResponse>("POST", `/boards/${boardId}/ai`, { message, history }),
  confirmAi: (boardId: number, proposalToken: string) =>
    request<AiResponse>("POST", `/boards/${boardId}/ai/confirm`, { proposal_token: proposalToken }),
  askWorkspaceAi: (workspaceId: number, question: string) =>
    request<WorkspaceAiResponse>("POST", `/workspaces/${workspaceId}/ai`, { question }),
};
