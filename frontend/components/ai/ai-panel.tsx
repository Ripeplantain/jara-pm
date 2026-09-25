"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { api, RequestError } from "@/lib/api/browser";
import type { AiResponse, AppliedChange, ChatMessage, PendingAction } from "@/lib/types/ai";
import type { Board } from "@/lib/types/board";

type PendingState = "open" | "confirmed" | "cancelled";

interface Entry {
  role: "user" | "assistant";
  content: string;
  changes?: AppliedChange[];
  pending?: { action: PendingAction; state: PendingState }[];
  error?: boolean;
}

interface Props {
  boardId: number;
  /** Server state returned with each reply. */
  onBoard: (board: Board) => void;
  onChanges: (changes: AppliedChange[]) => void;
  /** Runs the confirmed deletion through the same path as a manual delete. */
  onConfirm: (action: PendingAction) => void;
}

const HISTORY_LIMIT = 10;
const SUGGESTIONS = [
  "Plan a product launch",
  "Add the next step",
  "Summarize this board",
];

/** Failure here never touches the board: errors stay inside the panel. */
export function AiPanel({ boardId, onBoard, onChanges, onConfirm }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  function scrollDown() {
    requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }));
  }

  async function send(message: string) {
    const history: ChatMessage[] = entries
      .filter((e) => !e.error)
      .slice(-HISTORY_LIMIT)
      .map(({ role, content }) => ({ role, content }));
    setEntries((prev) => [...prev, { role: "user", content: message }]);
    setText("");
    setBusy(true);
    scrollDown();
    try {
      const res: AiResponse = await api.askAi(boardId, message, history);
      setEntries((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.reply,
          changes: res.changes,
          pending: res.pending.map((action) => ({ action, state: "open" as const })),
        },
      ]);
      onBoard(res.board);
      onChanges(res.changes);
    } catch (err) {
      const msg = err instanceof RequestError ? err.message : "The assistant failed. Please try again.";
      setEntries((prev) => [...prev, { role: "assistant", content: msg, error: true }]);
    } finally {
      setBusy(false);
      scrollDown();
    }
  }

  function resolve(entryIndex: number, pendingIndex: number, state: PendingState) {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === entryIndex
          ? { ...e, pending: e.pending?.map((p, j) => (j === pendingIndex ? { ...p, state } : p)) }
          : e,
      ),
    );
  }

  return (
    <aside className="ai-panel" aria-labelledby="ai-title">
      <header className="ai-header">
        <div className="ai-heading">
          <span className="ai-icon" aria-hidden="true">✦</span>
          <div>
            <h2 id="ai-title">Ask Kobi</h2>
            <p className="ai-subtitle">Work with this board using natural language.</p>
          </div>
        </div>
        <span className="ai-status"><span aria-hidden="true" /> This board</span>
      </header>
      <div ref={logRef} className="ai-log" role="log" aria-live="polite">
        {entries.length === 0 && (
          <div className="ai-empty">
            <div className="ai-empty-icon" aria-hidden="true">✧</div>
            <strong>What would you like to do?</strong>
            <p className="ai-hint">Ask Kobi to organize cards, rename columns, move work forward, or create a board.</p>
            <div className="ai-suggestions" aria-label="Suggested prompts">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => void send(suggestion)}>
                  {suggestion}<span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.map((entry, i) => (
          <article key={i} className={`ai-msg ${entry.role}${entry.error ? " error" : ""}`}>
            <div className="ai-msg-head">
              <span className={`ai-avatar ${entry.role}`} aria-hidden="true">{entry.role === "user" ? "You" : "✦"}</span>
              <strong>{entry.role === "user" ? "You" : "Assistant"}</strong>
              {entry.error && <span className="ai-error-label">Needs attention</span>}
            </div>
            <p className="ai-msg-content" role={entry.error ? "alert" : undefined}>{entry.content}</p>
            {entry.changes && entry.changes.length > 0 && (
              <div className="ai-change-block">
                <span className="ai-change-label">Applied to your board</span>
                <ul className="ai-changes" aria-label="Changes applied">
                  {entry.changes.map((c, j) => (
                    <li key={j}>
                      <span>{c.summary}</span>
                      {c.kind === "create_board" && <Link href={`/boards/${c.board_id}`}>Open board <span aria-hidden="true">↗</span></Link>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {entry.pending?.map((p, j) => (
              <div key={j} className="ai-pending" role="group" aria-label={`Confirm: ${p.action.summary}`}>
                <div className="ai-pending-copy">
                  <span className="ai-pending-label">Confirmation needed</span>
                  <span>{p.action.summary}?</span>
                </div>
                {p.state === "open" ? (
                  <div className="ai-pending-actions">
                    <button
                      type="button"
                      className="ai-confirm"
                      onClick={() => {
                        resolve(i, j, "confirmed");
                        onConfirm(p.action);
                      }}
                    >
                      Confirm
                    </button>{" "}
                    <button className="ai-cancel" type="button" onClick={() => resolve(i, j, "cancelled")}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <em className={`ai-pending-status ${p.state}`}>
                    {p.state === "confirmed" ? "Confirmed" : "Cancelled"}
                  </em>
                )}
              </div>
            ))}
          </article>
        ))}
        {busy && (
          <p className="ai-thinking" role="status">
            <span className="ai-avatar assistant" aria-hidden="true">✦</span>
            Thinking<span className="ai-thinking-dots" aria-hidden="true">…</span>
          </p>
        )}
      </div>
      <form
        className="ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          const message = text.trim();
          if (message && !busy) void send(message);
        }}
      >
        <div className="ai-compose-label">
          <label htmlFor="ai-input">Ask Kobi</label>
          <span>Enter to send</span>
        </div>
        <textarea
          id="ai-input"
          rows={3}
          maxLength={2000}
          placeholder="Ask anything about this board…"
          aria-describedby="ai-input-help"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="ai-form-footer">
          <span id="ai-input-help">Shift + Enter for a new line</span>
          <span className="ai-count" aria-live="polite">{text.length}/2000</span>
          <button className="ai-send" type="submit" disabled={busy || !text.trim()}>
            Send <span aria-hidden="true">↗</span>
          </button>
        </div>
      </form>
    </aside>
  );
}
