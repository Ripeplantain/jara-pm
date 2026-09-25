import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";

export function AppHeader({ email, context }: { email: string; context?: string }) {
  const initials = email.slice(0, 1).toUpperCase();
  return (
    <header className="app-header">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <nav aria-label="Main">
        <Link href="/" className="brand-link">
          <span className="brand-mark" aria-hidden="true">K</span>
          <span>Kobi</span>
          {context && <span className="brand-context">{context}</span>}
        </Link>
      </nav>
      <div className="header-account">
        <span className="account-email">{email}</span>
        <span className="avatar" aria-hidden="true">{initials}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
