import Link from "next/link";
import { PostHogIdentity } from "@/components/analytics/posthog-identity";
import { AccountMenu } from "@/components/shell/account-menu";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { NotificationBell } from "@/components/shell/notification-bell";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { Sidebar } from "@/components/shell/sidebar";
import { KobiLogo } from "@/components/shell/kobi-logo";
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
      <PostHogIdentity userId={user.id} />
      <header className="app-header">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <div className="header-left">
          <Link href="/" className="brand-link">
            <KobiLogo size="sm" />
          </Link>
          <Breadcrumbs context={context} />
        </div>
        <div className="header-account">
          <NotificationBell initialUnread={unread} />
          <AccountMenu user={user} />
        </div>
      </header>
      <OfflineBanner />
      <div className="app-layout">
        {active && (
          <Sidebar
            workspaceId={active.id}
            role={active.my_role}
            workspaces={workspaces}
            active={active}
          />
        )}
        <div className="app-content">{children}</div>
      </div>
    </>
  );
}
