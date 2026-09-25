import "server-only";

/** Server-side backend client: uses the compose-network URL, never runs in the browser. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Backend responded ${status}`);
  }
}

interface Options {
  method?: string;
  body?: unknown;
  token?: string;
}

export async function backendFetch<T>(path: string, opts: Options = {}): Promise<T> {
  const baseUrl = process.env.BACKEND_INTERNAL_URL;
  if (!baseUrl) throw new Error("BACKEND_INTERNAL_URL is not set");
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}
