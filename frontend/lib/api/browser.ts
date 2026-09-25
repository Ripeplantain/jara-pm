import type { AiResponse, ChatMessage } from "@/lib/types/ai";
import type { Board, Card, Column } from "@/lib/types/board";

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

export const api = {
  getBoard: (id: number) => request<Board>("GET", `/boards/${id}`),
  createBoard: (title: string, columns: string[] = []) =>
    request<Board>("POST", "/boards", { title, columns }),
  renameBoard: (id: number, title: string) => request<Board>("PATCH", `/boards/${id}`, { title }),
  deleteBoard: (id: number) => request<void>("DELETE", `/boards/${id}`),

  createColumn: (boardId: number, title: string) =>
    request<Column>("POST", `/boards/${boardId}/columns`, { title }),
  updateColumn: (id: number, patch: { title?: string; position?: number }) =>
    request<Column>("PATCH", `/columns/${id}`, patch),
  deleteColumn: (id: number, opts: { moveCardsTo?: number; deleteCards?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (opts.moveCardsTo !== undefined) q.set("move_cards_to", String(opts.moveCardsTo));
    if (opts.deleteCards) q.set("delete_cards", "true");
    return request<void>("DELETE", `/columns/${id}${q.size ? `?${q}` : ""}`);
  },

  createCard: (columnId: number, title: string, description = "") =>
    request<Card>("POST", `/columns/${columnId}/cards`, { title, description }),
  updateCard: (id: number, patch: { title?: string; description?: string }) =>
    request<Card>("PATCH", `/cards/${id}`, patch),
  moveCard: (id: number, columnId: number, position: number) =>
    request<Card>("POST", `/cards/${id}/move`, { column_id: columnId, position }),
  deleteCard: (id: number) => request<void>("DELETE", `/cards/${id}`),

  askAi: (boardId: number, message: string, history: ChatMessage[]) =>
    request<AiResponse>("POST", `/boards/${boardId}/ai`, { message, history }),
};
