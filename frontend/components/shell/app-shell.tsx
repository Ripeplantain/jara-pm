import Link from "next/link";
import { AccountMenu } from "@/components/shell/account-menu";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { NotificationBell } from "@/components/shell/notification-bell";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { Sidebar } from "@/components/shell/sidebar";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import type { User } from "@/lib/types/auth";
import type { Workspace } from "@/lib/types/workspace";

/**
 * The frame every signed-in page renders inside: brand, workspace switcher, primary nav,
 * notifications and the account menu. A Server Component - only the interactive pieces inside
 * it are client components.
 */
export function AppShell({
  user,
  workspaces,
  active,
  unread,
  context,
  children,
}: {
  user: User;
  workspaces: Workspace[];
  active: Workspace | null;
  unread: number;
  /** Where you are, shown next to the brand (a board title, usually). */
  context?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="app-header">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <div className="header-left">
          <Link href="/" className="brand-link">
            <span className="brand-mark" aria-hidden="true">
              K
            </span>
            <span>Kobi</span>
          </Link>
          {active && <WorkspaceSwitcher workspaces={workspaces} active={active} />}
          <Breadcrumbs context={context} />
        </div>
        <div className="header-account">
          <NotificationBell initialUnread={unread} />
          <AccountMenu user={user} />
        </div>
      </header>
      <OfflineBanner />
      <div className="app-layout">
        {active && <Sidebar workspaceId={active.id} role={active.my_role} />}
        <div className="app-content">{children}</div>
      </div>
    </>
  );
}
