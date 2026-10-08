"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GlobalSearch } from "@/components/shell/global-search";
import { NavLinks } from "@/components/shell/nav-links";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import type { Role, Workspace } from "@/lib/types/workspace";

export function Sidebar({
  workspaceId,
  role,
  workspaces,
  active,
}: {
  workspaceId: number;
  role: Role;
  workspaces: Workspace[];
  active: Workspace;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCollapsed(window.localStorage.getItem("kobi.sidebar") === "collapsed");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem("kobi.sidebar", next ? "collapsed" : "open");
      return next;
    });
  }

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`} aria-label="Workspace navigation">
      <div className="sidebar-heading">
        {!collapsed ? (
          <WorkspaceSwitcher workspaces={workspaces} active={active} />
        ) : (
          <span className="sidebar-mark" aria-hidden="true">
            K
          </span>
        )}
        <button type="button" className="sidebar-toggle" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggle}>
          {collapsed ? "→" : "←"}
        </button>
      </div>
      <GlobalSearch workspaceId={workspaceId} />
      <NavLinks role={role} />
      <div className="sidebar-footer">
        <div className="sidebar-divider" />
        <Link className="sidebar-ai-entry" href="/" title="Ask Kobi from a board">
          <span className="nav-icon" aria-hidden="true">✦</span>
          {!collapsed && <span className="nav-label">Ask Kobi</span>}
        </Link>
        {!collapsed && <p className="sidebar-tip">Use ⌘K to find cards anywhere in this workspace.</p>}
      </div>
    </aside>
  );
}
