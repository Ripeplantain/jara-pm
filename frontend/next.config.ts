import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production image.
  output: "standalone",
  // instrumentation.ts is compiled for the edge runtime as well, because proxy.ts runs there,
  // and posthog-node has no edge build. Leaving it to Node's own require at runtime keeps it
  // out of the edge bundle; the hook that uses it only runs under NEXT_RUNTIME === "nodejs".
  serverExternalPackages: ["posthog-node"],
};

export default nextConfig;
