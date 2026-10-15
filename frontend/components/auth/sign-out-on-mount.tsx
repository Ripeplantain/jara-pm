"use client";

import { signOut } from "next-auth/react";
import { useEffect } from "react";
import { Skeleton } from "@/components/shell/skeleton";

/** Clears a session the backend no longer accepts, then goes to sign-in. */
export function SignOutOnMount() {
  useEffect(() => {
    void signOut({ callbackUrl: "/signin" });
  }, []);
  return (
    <main className="simple-state">
      <Skeleton rows={1} label="Signing out" />
    </main>
  );
}
