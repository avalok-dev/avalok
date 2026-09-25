import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@visual-system/schema",
    "@visual-system/graph",
    "@visual-system/replay",
    "@visual-system/ui",
  ],
};

export default nextConfig;
