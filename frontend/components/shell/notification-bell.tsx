"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/browser";
import { shortAgo } from "@/lib/dates";
import type { Notification } from "@/lib/types/activity";

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // The count comes from the server on every render of the page, but marking one read has to
  // show immediately. Adjusting during render (rather than in an effect) is React's own pattern
  // for "reset local state when a prop changes": the server value always wins when it moves.
  const [unread, setUnread] = useState(initialUnread);
  const [seenFromServer, setSeenFromServer] = useState(initialUnread);
  if (seenFromServer !== initialUnread) {
    setSeenFromServer(initialUnread);
    setUnread(initialUnread);
  }

  useEffect(() => {
    if (!open) return;
    api.listNotifications().then(setItems).catch(() => {
      setItems([]);
      setLoadError(true);
    });
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(item: Notification) {
    if (item.read_at) return;
    setItems((list) =>
      list?.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)) ?? null,
    );
    setUnread((n) => Math.max(0, n - 1));
    await api.markNotificationRead(item.id).catch(() => undefined);
    router.refresh();
  }

  async function markAll() {
    const now = new Date().toISOString();
    setItems((list) => list?.map((n) => ({ ...n, read_at: n.read_at ?? now })) ?? null);
    setUnread(0);
    await api.markAllNotificationsRead().catch(() => undefined);
    router.refresh();
  }

  return (
    <div className="bell" ref={root}>
      <button
        type="button"
        className="bell-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen((v) => {
          if (!v) setLoadError(false);
          return !v;
        })}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="bell-count" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          {items === null && <p className="muted">Loading…</p>}
          {loadError && (
            <p className="notification-error" role="alert">
              Could not load notifications. Close and open this panel to retry.
            </p>
          )}
          {!loadError && items?.length === 0 && <p className="muted">Nothing yet. You are all caught up.</p>}
          <ul className="bell-list">
            {items?.map((item) => (
              <li key={item.id} className={item.read_at ? "" : "unread"}>
                <Link
                  href={
                    item.board_id
                      ? `/boards/${item.board_id}${item.card_id ? `?card=${item.card_id}` : ""}`
                      : "/"
                  }
                  onClick={() => {
                    setOpen(false);
                    void markRead(item);
                  }}
                >
                  <span className="bell-title">{item.title}</span>
                  {item.body && <span className="bell-body">{item.body}</span>}
                  <span className="bell-time">{shortAgo(item.created_at)} ago</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
