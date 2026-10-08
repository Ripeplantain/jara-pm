"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/shell/avatar";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import type { User } from "@/lib/types/auth";

export function AccountMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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

  return (
    <div className="account" ref={root}>
      <button
        type="button"
        className="account-button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${user.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar user={user} />
      </button>

      {open && (
        <div className="account-menu" role="menu">
          <div className="account-head">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          <ThemeToggle />
          <Link href="/settings/profile" role="menuitem" onClick={() => setOpen(false)}>
            Profile settings
          </Link>
          <Link href="/settings/workspace" role="menuitem" onClick={() => setOpen(false)}>
            Workspace settings
          </Link>
          <button type="button" role="menuitem" onClick={() => signOut({ callbackUrl: "/signin" })}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
