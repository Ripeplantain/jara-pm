import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decode } from "next-auth/jwt";
import { getMe } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { hasLiveBackendToken } from "@/lib/auth";
import type { User } from "@/lib/types/auth";

/** Backend access token from the httpOnly session cookie, or null if signed out/expired. */
export async function getAccessToken(): Promise<string | null> {
  const jar = await cookies();
  // NextAuth prefixes the cookie name over HTTPS.
  const raw =
    jar.get("__Secure-next-auth.session-token")?.value ?? jar.get("next-auth.session-token")?.value;
  if (!raw) return null;
  const token = await decode({ token: raw, secret: process.env.AUTH_SECRET as string }).catch(
    () => null,
  );
  return hasLiveBackendToken(token) ? token.accessToken : null;
}

/** Authoritative server-side check: redirects to sign-in without a session. */
export async function requireUser(): Promise<User> {
  const token = await getAccessToken();
  if (!token) redirect("/signin");
  try {
    return await getMe(token);
  } catch (err) {
    // Backend rejected the token (expired, user gone): clear the session.
    if (err instanceof ApiError && err.status === 401) redirect("/signout");
    throw err;
  }
}
