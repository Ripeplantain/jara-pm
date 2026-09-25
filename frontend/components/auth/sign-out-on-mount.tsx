"use client";

import { signOut } from "next-auth/react";
import { useEffect } from "react";

/** Clears a session the backend no longer accepts, then goes to sign-in. */
export function SignOutOnMount() {
  useEffect(() => {
    void signOut({ callbackUrl: "/signin" });
  }, []);
  return <p>Signing out…</p>;
}
