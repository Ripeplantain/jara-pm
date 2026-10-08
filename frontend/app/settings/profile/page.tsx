import type { Metadata } from "next";
import { PasswordForm } from "@/components/settings/password-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { AccountDangerZone } from "@/components/settings/account-danger-zone";
import { AppShell } from "@/components/shell/app-shell";
import { loadShell } from "@/lib/page-data";

export const metadata: Metadata = { title: "Profile · Kobi" };
export const dynamic = "force-dynamic";

export default async function ProfileSettings() {
  const shell = await loadShell();
  return (
    <AppShell {...shell}>
      <main id="main-content" className="page settings-page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">Settings</div>
            <h1>Your profile</h1>
          </div>
        </div>
        <ProfileForm user={shell.user} />
        <PasswordForm />
        <AccountDangerZone />
      </main>
    </AppShell>
  );
}
