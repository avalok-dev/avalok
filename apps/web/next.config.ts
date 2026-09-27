import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The installable package ships Next's standalone server. Contributor builds keep the
  // default output so `next start` and `pnpm dev` behave as before.
  ...(process.env.AGENTMAP_DASHBOARD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["@cdktf/hcl2json"],
  webpack(config, { isServer }) {
    if (isServer) {
      // Workspace-source imports bypass Next's package externalization in this route.
      // Keep the parser as a real Node dependency so its adjacent WASM asset resolves.
      config.externals.push("@cdktf/hcl2json");
      config.resolve.fallback = {
        ...config.resolve.fallback,
        // The HCL WebAssembly bridge references this legacy Node polyfill behind
        // `globalThis.performance ??=`. Supported Node runtimes already provide it.
        performance: false,
      };
    }
    return config;
  },
  transpilePackages: [
    "@visual-system/schema",
    "@visual-system/graph",
    "@visual-system/replay",
    "@visual-system/ui",
  ],
};

export default nextConfig;
