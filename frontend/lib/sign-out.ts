import { signOut } from "next-auth/react";
import { resetIdentity } from "@/lib/analytics";

/**
 * The one way out of a session.
 *
 * Signing out has to clear the analytics identity as well as the NextAuth cookie, or the next
 * person at this browser inherits the previous one's person profile. There are four places that
 * sign out - the account menu, the danger zone, an expired session and the sign-out button - so
 * the pair lives here rather than being remembered correctly four times.
 */
export function signOutAndReset(options?: Parameters<typeof signOut>[0]): Promise<unknown> {
  resetIdentity();
  return signOut(options);
}
