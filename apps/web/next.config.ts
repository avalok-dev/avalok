import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// Avalok is local-first: never send Next.js framework telemetry from any Avalok workflow
// (`pnpm dev`, `pnpm build`, the packaging build). Next reads this variable when it creates its
// telemetry client, which happens after this file is evaluated, and child processes inherit it.
// The packaged runtime also sets it explicitly (packages/cli/src/dashboard.ts).
process.env.NEXT_TELEMETRY_DISABLED = "1";

interface ManifestModule {
  resource?: string;
  rootModule?: ManifestModule;
  modules?: Iterable<ManifestModule>;
}

// Release builds record every module webpack bundles so the third-party notices list exactly the
// packages whose code ships in the dashboard (packages/cli/scripts/third-party-notices.mjs).
const manifestDirectory = process.env.AVALOK_MODULE_MANIFEST;
const moduleManifestPlugin = {
  apply(compiler: {
    name?: string;
    hooks: {
      done: {
        tap: (
          name: string,
          callback: (stats: { compilation: { modules: Iterable<ManifestModule> } }) => void,
        ) => void;
      };
    };
  }) {
    compiler.hooks.done.tap("AvalokModuleManifest", (stats) => {
      const resources = new Set<string>();
      const visit = (entry: ManifestModule) => {
        if (entry.resource) resources.add(entry.resource.split("?")[0]!);
        if (entry.rootModule) visit(entry.rootModule);
        for (const inner of entry.modules ?? []) visit(inner);
      };
      for (const entry of stats.compilation.modules) visit(entry);
      mkdirSync(manifestDirectory!, { recursive: true });
      writeFileSync(
        join(manifestDirectory!, `${compiler.name ?? "compiler"}.json`),
        `${JSON.stringify([...resources].sort(), null, 2)}\n`,
      );
    });
  },
};

const nextConfig: NextConfig = {
  // The installable package ships Next's standalone server. Contributor builds keep the
  // default output so `next start` and `pnpm dev` behave as before.
  ...(process.env.AVALOK_DASHBOARD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // Avalok does not use next/image; the packaged dashboard ships without sharp's native binaries.
  images: { unoptimized: true },
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
    if (manifestDirectory) config.plugins.push(moduleManifestPlugin);
    return config;
  },
  transpilePackages: [
    "@visual-system/export",
    "@visual-system/local-security",
    "@visual-system/schema",
    "@visual-system/graph",
    "@visual-system/replay",
    "@visual-system/ui",
  ],
};

export default nextConfig;
