import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production image.
  output: "standalone",
};

export default nextConfig;
