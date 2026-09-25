import { backendFetch } from "@/lib/api/client";
import type { HealthResponse } from "@/lib/types/health";

/** Returns null when the backend is unreachable or unhealthy. */
export async function getBackendHealth(): Promise<HealthResponse | null> {
  try {
    return await backendFetch<HealthResponse>("/api/health");
  } catch {
    return null;
  }
}
