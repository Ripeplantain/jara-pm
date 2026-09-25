import { backendFetch } from "@/lib/api/client";
import type { Board, BoardSummary } from "@/lib/types/board";

/** Server-side reads for first load. Mutations go through lib/api/browser.ts. */
export const listBoards = (token: string) => backendFetch<BoardSummary[]>("/api/boards", { token });

export const getBoard = (token: string, id: number) =>
  backendFetch<Board>(`/api/boards/${id}`, { token });
