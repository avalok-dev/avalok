# Building the installable package

AgentMap ships as **one** npm package containing the CLI, OTLP receiver, analyzers, adapters, and a production dashboard. Users need Node.js only; pnpm, the monorepo, and TypeScript source are contributor-only. Nothing is published in M7.3.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm dist:build   # → packages/cli/dist/ (a ready-to-pack package directory)
pnpm dist:pack    # → artifacts/visual-system-agentmap-<version>.tgz
pnpm dist:smoke   # clean temp install + installed-product smoke test
```

`pnpm dist:smoke --hide-workspace` additionally renames the checkout during the run (restored afterwards) to prove the install never resolves anything from it. `--python <venv>/bin/python` adds the standard Python exporter step; `--keep` keeps the temporary directory.

## What `dist:build` does

1. Builds `apps/web` with `AGENTMAP_DASHBOARD_STANDALONE=1` (Next.js `output: "standalone"`) and `NEXT_TELEMETRY_DISABLED=1`. Contributor builds (`pnpm build`, `pnpm dev`) keep the default output.
2. Copies the standalone server **without** its traced `node_modules`, plus `.next/static` and `public/`, into `dist/dashboard/`, and adds `agentmap-launch.cjs` (orphan watchdog, see platform support).
3. Bundles `packages/cli/src/bin.ts` — CLI, collector, analyzer, adapters, capabilities, protobuf decoder — with esbuild into `dist/lib/cli.mjs`. `next`, `react`, `react-dom`, `typescript`, and `@cdktf/hcl2json` stay external runtime dependencies.
4. Writes `dist/bin/agentmap.mjs`: a tiny launcher that checks the Node version before loading anything else.
5. Copies the six allowlisted sample repositories into `dist/samples/` (excluding `node_modules`, virtualenvs, caches, `.env*`).
6. Generates `dist/package.json` from `packages/cli/product.json` + `packages/cli/package.json#version` + root `engines`, with exact-pinned runtime dependencies and an explicit `files` allowlist (`bin`, `lib`, `dashboard`, `samples`).
7. **Verifies independence** and fails the build if the manifest uses `workspace:`, the CLI bundle embeds the checkout path, any shipped file loads from the checkout or an internal `@visual-system/*` package at runtime, a symlink is present, or forbidden content (`.env*`, `node_modules`, `.git`, `.agentmap`, coverage, `.turbo`, virtualenvs, Terraform state/vars) is included.

## Package identity and version

| Item         | Source                                     | Current                   |
| ------------ | ------------------------------------------ | ------------------------- |
| Display name | `packages/cli/product.json`                | AgentMap (working name)   |
| CLI command  | `packages/cli/product.json`                | `agentmap`                |
| Package name | `packages/cli/product.json`                | `@visual-system/agentmap` |
| Version      | `packages/cli/package.json#version` (only) | `0.1.0-alpha.0`           |
| Node range   | root `package.json#engines`                | `>=24.19.0 <25`           |

`agentmap --version`, startup output, `doctor`, the dashboard capability report (Setup footer), and the generated manifest all read these; tests assert they agree. The internal scope is deliberately reversible and the generated manifest is `private: true`, so `npm publish` refuses it. Renaming the product later is a `product.json` edit.

## Runtime layout

```text
<install>/node_modules/@visual-system/agentmap/
  bin/agentmap.mjs        Node gate → lib/cli.mjs
  lib/cli.mjs             bundled CLI + collector (+ LEGAL.txt with bundled licenses)
  dashboard/              agentmap-launch.cjs, server.js, .next/{server,static}, public/
  samples/                allowlisted analysis samples
```

The CLI locates `dashboard/` and `samples/` relative to its own module file, never `process.cwd()`. The target repository is the cwd or explicit path. The dashboard child receives the target, data root, OTLP port, samples directory, and version through its environment, and is bound to `127.0.0.1` even if the shell exports `HOSTNAME`.

## Size (0.1.0-alpha.0, macOS arm64)

| Measure                     | Size    |
| --------------------------- | ------- |
| Packed tarball              | ≈1.8 MB |
| Unpacked package            | ≈6.8 MB |
| Installed with dependencies | ≈360 MB |

Almost all installed size is Next.js's own dependency tree: its optional `@next/swc-<platform>` compiler binary (≈139 MB, unused at runtime), `next` itself (≈150 MB), `typescript` (≈23 MB, required by the analyzer), and sharp/libvips (≈18 MB, optional, unused). Vendoring Next's trace-minimized standalone `node_modules` via `bundleDependencies` could cut this substantially; it is recorded for M7.4 rather than done here.

## Development-only

`tsx`, `vitest`, `esbuild`, Turbo, ESLint, Tailwind/PostCSS, and the OpenTelemetry SDK packages used by tests are never runtime dependencies of the installed package. The package declares no lifecycle scripts and needs no `sudo`.

## Known build note

The build prints `The Next.js plugin was not detected in your ESLint configuration`. This predates M7.3, does not affect the production or standalone output, and lint passes.

Next.js keeps build-time source file paths as module labels inside `.next/server` chunks. They are metadata, not loaded at runtime (the independence check and the hidden-workspace smoke test prove this), but they do reveal the build machine's checkout path. Release builds should run in CI from a neutral path (M7.4).
