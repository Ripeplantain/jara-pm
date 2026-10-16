import "server-only";
import { backendFetch } from "@/lib/api/client";
import type { Notification } from "@/lib/types/activity";
import type { WorkspaceOverview } from "@/lib/types/analytics";
import type { Board, BoardSummary, BoardTemplate, CardHit } from "@/lib/types/board";
import type { Goal } from "@/lib/types/goal";
import type { Habit } from "@/lib/types/habit";
import type { Label } from "@/lib/types/label";
import type { Note, NoteSummary } from "@/lib/types/note";
import type { Workspace } from "@/lib/types/workspace";
import type { OnboardingStatus } from "@/lib/types/workspace";

/**
 * Server-side reads for first paint. Mutations go through lib/api/browser.ts, which talks to
 * the same-origin proxy; nothing here ever runs in the browser.
 */
export const listWorkspaces = (token: string) =>
  backendFetch<Workspace[]>("/api/workspaces", { token });

export const getWorkspace = (token: string, id: number) =>
  backendFetch<Workspace>(`/api/workspaces/${id}`, { token });

export const getOverview = (token: string, id: number) =>
  backendFetch<WorkspaceOverview>(`/api/workspaces/${id}/overview`, { token });

export const listBoards = (token: string, workspaceId?: number) =>
  backendFetch<BoardSummary[]>(
    `/api/boards${workspaceId ? `?workspace_id=${workspaceId}` : ""}`,
    { token },
  );

export const getBoard = (token: string, id: number) =>
  backendFetch<Board>(`/api/boards/${id}`, { token });

export const listTemplates = (token: string) =>
  backendFetch<BoardTemplate[]>("/api/board-templates", { token });

export const listLabels = (token: string, workspaceId: number) =>
  backendFetch<Label[]>(`/api/workspaces/${workspaceId}/labels`, { token });

export const myCards = (token: string, workspaceId?: number) =>
  backendFetch<CardHit[]>(
    `/api/my-cards${workspaceId ? `?workspace_id=${workspaceId}` : ""}`,
    { token },
  );

export const listNotifications = (token: string) =>
  backendFetch<Notification[]>("/api/notifications", { token });

export const unreadCount = (token: string) =>
  backendFetch<{ unread: number }>("/api/notifications/unread-count", { token });

export const getOnboardingStatus = (token: string) =>
  backendFetch<OnboardingStatus>("/api/onboarding", { token });

export const listNotes = (token: string, workspaceId: number, includeArchived = false) =>
  backendFetch<NoteSummary[]>(
    `/api/workspaces/${workspaceId}/notes${includeArchived ? "?include_archived=true" : ""}`,
    { token },
  );

export const getNote = (token: string, id: number) =>
  backendFetch<Note>(`/api/notes/${id}`, { token });

export const listHabits = (token: string, workspaceId: number, includeArchived = false) =>
  backendFetch<Habit[]>(
    `/api/workspaces/${workspaceId}/habits${includeArchived ? "?include_archived=true" : ""}`,
    { token },
  );

export const listGoals = (token: string, workspaceId: number, includeArchived = false) =>
  backendFetch<Goal[]>(
    `/api/workspaces/${workspaceId}/goals${includeArchived ? "?include_archived=true" : ""}`,
    { token },
  );
