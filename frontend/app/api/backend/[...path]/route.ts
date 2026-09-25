import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ApiError, backendFetch } from "@/lib/api/client";
import { getAccessToken } from "@/lib/session";

/**
 * Same-origin proxy for client-side mutations: attaches the Bearer token from the httpOnly
 * session cookie so the browser never sees the token or calls FastAPI directly.
 */
const ALLOWED = new Set(["boards", "columns", "cards"]);

async function forward(req: NextRequest, ctx: RouteContext<"/api/backend/[...path]">) {
  const { path } = await ctx.params;
  if (!ALLOWED.has(path[0])) return NextResponse.json({ detail: "Not found" }, { status: 404 });

  const token = await getAccessToken();
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const body = req.method === "GET" || req.method === "DELETE" ? undefined : await req.json().catch(() => undefined);
  const target = `/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  try {
    const data = await backendFetch<unknown>(target, { method: req.method, body, token });
    return data === null ? new NextResponse(null, { status: 204 }) : NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json(err.body, { status: err.status });
    return NextResponse.json({ detail: "Backend unavailable" }, { status: 502 });
  }
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
