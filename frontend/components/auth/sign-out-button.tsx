"use client";

import { signOutAndReset } from "@/lib/sign-out";
export function SignOutButton() {
  return (
    <button
      className="sign-out-button"
      type="button"
      onClick={() => void signOutAndReset({ callbackUrl: "/signin" })}
    >
      Sign out
    </button>
  );
}
