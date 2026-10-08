import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { hasLiveBackendToken } from "@/lib/auth";

const AUTH_PAGES = ["/signin", "/signup"];
const PUBLIC_PAGES = [
  "/welcome",
  "/privacy",
  "/terms",
  "/invite",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
];

/**
 * Optimistic redirect only. Server components still verify the session
 * (lib/session.ts) and the backend verifies every token.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  const signedIn = hasLiveBackendToken(token);
  const isAuthPage = AUTH_PAGES.includes(pathname);

  if (!signedIn && !isAuthPage && !PUBLIC_PAGES.includes(pathname) && pathname !== "/signout") {
    const url = new URL(pathname === "/" ? "/welcome" : "/signin", req.url);
    if (pathname !== "/") url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  if (signedIn && (isAuthPage || pathname === "/welcome")) return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
