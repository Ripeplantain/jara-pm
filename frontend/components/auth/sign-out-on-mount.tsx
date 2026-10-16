"use client";

import { useEffect } from "react";
import { Skeleton } from "@/components/shell/skeleton";
import { signOutAndReset } from "@/lib/sign-out";

/** Clears a session the backend no longer accepts, then goes to sign-in. */
export function SignOutOnMount() {
  useEffect(() => {
    void signOutAndReset({ callbackUrl: "/signin" });
  }, []);
  return (
    <main className="simple-state">
      <Skeleton rows={1} label="Signing out" />
    </main>
  );
}
