# Building the installable package

Avalok ships as **one** npm package containing the CLI, OTLP receiver, analyzers, adapters, and a production dashboard. Users need Node.js only; pnpm, the monorepo, and TypeScript source are contributor-only. Nothing is published in M7.3.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm dist:build   # → packages/cli/dist/ (a ready-to-pack package directory)
pnpm dist:pack    # → artifacts/visual-system-avalok-<version>.tgz
pnpm dist:smoke   # clean temp install + installed-product smoke test
```

`pnpm dist:smoke --hide-workspace` additionally renames the checkout during the run (restored afterwards) to prove the install never resolves anything from it. `--python <venv>/bin/python` adds the standard Python exporter step; `--keep` keeps the temporary directory.

## What `dist:build` does

1. Builds `apps/web` with `AVALOK_DASHBOARD_STANDALONE=1` (Next.js `output: "standalone"`) and `NEXT_TELEMETRY_DISABLED=1`. Contributor builds (`pnpm build`, `pnpm dev`) keep the default output.
2. Copies the standalone server, plus `.next/static` and `public/`, into `dist/dashboard/`, and adds `avalok-launch.cjs` (orphan watchdog, see platform support). Next's traced runtime dependencies are shipped as a **flat, real-file** `dist/dashboard/node_modules` (`shipDashboardModules`): pnpm's symlinked virtual store is flattened because npm drops symlinks from tarballs, two traced versions of one package fail the build, and platform-specific binaries (`sharp`/`@img/*`, `@next/swc-*`) are excluded because Avalok does not use `next/image` and the compiler is build-time only.
3. Bundles `packages/cli/src/bin.ts` — CLI, collector, analyzer, adapters, capabilities, protobuf decoder — with esbuild into `dist/lib/cli.mjs`. Only `typescript` and `@cdktf/hcl2json` stay external runtime dependencies that npm installs.
4. Writes `dist/bin/avalok.mjs`: a tiny launcher that checks the Node version before loading anything else.
5. Copies the six allowlisted sample repositories into `dist/samples/` (excluding `node_modules`, virtualenvs, caches, `.env*`).
6. Generates `dist/package.json` from `packages/cli/product.json` + `packages/cli/package.json#version` + root `engines`, with exact-pinned runtime dependencies and an explicit `files` allowlist (`bin`, `lib`, `dashboard`, `samples`).
7. **Verifies independence** and fails the build if the manifest uses `workspace:`, the CLI bundle embeds the checkout path, any shipped file loads from the checkout or an internal `@visual-system/*` package at runtime, a symlink is present, or forbidden content (`.env*`, any `node_modules` other than the flat `dashboard/node_modules`, a `.pnpm` store, `.git`, `.agentmap`, coverage, `.turbo`, virtualenvs, Terraform state/vars) is included.

## Package identity and version

| Item         | Source                                     | Current               |
| ------------ | ------------------------------------------ | --------------------- |
| Display name | `packages/cli/product.json`                | Avalok (working name) |
| CLI command  | `packages/cli/product.json`                | `avalok`              |
| Package name | `packages/cli/product.json`                | `avalok`              |
| Version      | `packages/cli/package.json#version` (only) | `0.1.0-alpha.0`       |
| Node range   | root `package.json#engines`                | `>=24.19.0 <25`       |

`avalok --version`, startup output, `doctor`, the dashboard capability report (Setup footer), and the generated manifest all read these; tests assert they agree. The internal scope is deliberately reversible and the generated manifest is `private: true`, so `npm publish` refuses it. Renaming the product later is a `product.json` edit.

## Runtime layout

```text
<install>/node_modules/avalok/
  bin/avalok.mjs        Node gate → lib/cli.mjs
  lib/cli.mjs             bundled CLI + collector (+ LEGAL.txt with bundled licenses)
  dashboard/              avalok-launch.cjs, server.js, .next/{server,static}, public/
  samples/                allowlisted analysis samples
```

The CLI locates `dashboard/` and `samples/` relative to its own module file, never `process.cwd()`. The target repository is the cwd or explicit path. The dashboard child receives the target, data root, OTLP port, samples directory, and version through its environment, and is bound to `127.0.0.1` even if the shell exports `HOSTNAME`.

## Size (0.1.0-alpha.1, macOS arm64, measured 2026-10-06)

| Measure                                  | Size                                                         |
| ---------------------------------------- | ------------------------------------------------------------ |
| Packed tarball                           | ≈8 MB (was ≈1.9 MB)                                          |
| Installed with dependencies, clean `npm` | ≈67 MB: Avalok ≈42 MB, `typescript` ≈23 MB (was ≈344-353 MB) |

Before L1 the package installed the whole `next` dependency tree (`next` ≈153 MB, the unused `@next/swc-<platform>` compiler binary ≈125 MB, `typescript` ≈23 MB, sharp/libvips ≈18 MB). The dashboard now ships only Next's traced runtime modules (19 packages, `next` ≈28 MB), without the compiler and without sharp. The largest remaining item is `typescript` (needed by the analyzer); bundling its parser into the CLI is a possible follow-up. Linux and Windows sizes are not measured here and CI does not report them yet.

## Development-only

`tsx`, `vitest`, `esbuild`, Turbo, ESLint, Tailwind/PostCSS, and the OpenTelemetry SDK packages used by tests are never runtime dependencies of the installed package. The package declares no lifecycle scripts and needs no `sudo`.

## Known build note

The build prints `The Next.js plugin was not detected in your ESLint configuration`. This predates M7.3, does not affect the production or standalone output, and lint passes.

Next.js keeps build-time source file paths as module labels inside `.next/server` chunks. They are metadata, not loaded at runtime (the independence check and the hidden-workspace smoke test prove this), but an in-place build reveals the build machine's checkout path (29 files). Release artifacts come from `pnpm release:build`, which builds from a neutral temporary path and fails on any home directory, username, or original checkout path in the package; see [release build](release-build.md).
