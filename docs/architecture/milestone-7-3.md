# Milestone 7.3 — installable distribution and clean-machine reliability

> **Historical record.** Written while the product's working name was AgentMap (later Sarvadrik); the product is now **Avalok** (CLI `avalok`, environment variables `AVALOK_*`). Commands and names below are as they were at the time.

M7.3 turns the M7.1/M7.2 source-workspace product into one installable Node package that runs without the AgentMap repository, pnpm workspace links, TypeScript source, or a development server. Nothing is published. The package is private, carries a reversible internal name, and is only ever packed to a local tarball.

## Baseline (before M7.3 changes)

| Item                  | Value                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| Node / pnpm           | `24.19.0` / `11.19.0`                                                        |
| Format / lint / types | pass                                                                         |
| Tests                 | 105 passing across 12 packages                                               |
| Production build      | pass (Next.js 15.5 app router)                                               |
| Known warning         | Next.js reports its optional ESLint plugin is not detected (non-blocking)    |
| OTLP                  | OTLP/HTTP JSON only; protobuf returns `415`                                  |
| CLI launcher          | `tsx` loading workspace TypeScript source                                    |
| Dashboard location    | `../../../apps/web` relative to CLI source, `next start`/`next dev`          |
| Fixture selection     | `/api/repository` always located the AgentMap source root (fatal if absent)  |
| Data root             | M7.2 platform root already in place; M7.1 `~/.agentmap/runtime` not migrated |

## Distribution principle

A user installs **one** top-level package. Internal workspace packages remain separate for development, but are compiled into the artifact; users never install `analyzer`, `collector`, dashboard, or adapter packages individually and never see the monorepo layout.

## What ships

```text
<package root>/
  package.json          generated manifest: bin, engines, files, runtime deps only
  README.md, LICENSE
  bin/agentmap.js       tiny launcher: Node version gate, then imports lib/cli.mjs
  lib/cli.mjs           esbuild bundle of the CLI, collector, analyzer, adapters, capabilities
  dashboard/            agentmap-launch.cjs (orphan watchdog) + Next.js standalone server
                        (server.js, .next/server, .next/static, public)
  samples/              small allowlisted example repositories for the source selector
```

| Component                         | Shipping form                                                       |
| --------------------------------- | ------------------------------------------------------------------- |
| CLI (`packages/cli`)              | Bundled into `lib/cli.mjs`                                          |
| OTLP receiver (`apps/collector`)  | Bundled into `lib/cli.mjs` (runs in the CLI process)                |
| Analyzer, adapters, capabilities  | Bundled (pure JS)                                                   |
| Dashboard (`apps/web`)            | Next.js `output: "standalone"` server + static assets, no source    |
| Dashboard workspace imports       | Compiled into `.next/server` chunks by Next                         |
| `typescript`, `@cdktf/hcl2json`   | External npm dependencies (TypeScript compiler API; HCL WASM asset) |
| `next`, `react`, `react-dom`      | External npm dependencies required by the standalone server         |
| `protobufjs`                      | Bundled into the CLI (OTLP protobuf decoding)                       |
| Samples                           | Copied allowlisted fixtures, analysis input only                    |
| Schemas, OTLP `.proto` definition | Compiled into the bundle; nothing is read from disk at runtime      |

Development-only and never shipped: TypeScript source, tests, fixtures beyond the allowlisted samples, `tsx`, `vitest`, `esbuild`, Turbo, ESLint, Tailwind/PostCSS, `.next/cache`, workspace `node_modules`, `.agentmap/` data, `.env*`, Terraform state, coverage, screenshots.

## Asset resolution

The installation directory and the target repository are separate concepts:

- **Installation assets** (dashboard, samples) resolve from the bundled module's own location (`import.meta.url` of `lib/cli.mjs`), never from `process.cwd()`, the home directory, or a workspace root.
- **The target repository** is `process.cwd()` or the explicit path argument, canonicalized by the CLI and passed to the dashboard as `AGENTMAP_TARGET_ROOT`.
- **Data** lives under the platform AgentMap data root (below).

The CLI decides between two layouts: a packaged layout (`dashboard/server.js` beside `lib/`) and the contributor source layout (`apps/web` in the workspace). `AGENTMAP_DASHBOARD_DIR` remains a development override.

## Runtime topology (unchanged from M7.1)

```text
agentmap (CLI process)
 ├─ static preflight analysis of the target
 ├─ OTLP/HTTP receiver 127.0.0.1:4318   (JSON + protobuf, Claude hooks, test trace)
 └─ child: node dashboard/server.js      127.0.0.1:4737 (standalone Next.js)
```

## Data directory

The stable AgentMap-owned root (introduced in M7.2) is retained:

| Platform | Root                                                    |
| -------- | ------------------------------------------------------- |
| macOS    | `~/Library/Application Support/AgentMap`                |
| Linux    | `$XDG_DATA_HOME/agentmap` or `~/.local/share/agentmap`  |
| Windows  | `%LOCALAPPDATA%\AgentMap` or `~\AppData\Local\AgentMap` |

Layout: `runtime/` (persisted normalized runs), `settings.json` (UI settings), `migration.json` (legacy-migration record). Repository analysis cache remains process-local. M7.3 adds a safe copy/verify/activate migration from the provisional M7.1 `~/.agentmap/runtime`; see `docs/development/data-migration.md`.

## OTLP

The receiver accepts OTLP/HTTP `application/json` and `application/x-protobuf` on the standard `/v1/traces` path. Protobuf is decoded with `protobufjs` against the official OpenTelemetry trace service definitions and converted into the same OTLP/JSON-shaped canonical request, which then flows through the existing `parseOtlpJson → normalizeTraces → LocalRuntimeStore` pipeline. There is no separate protobuf graph path. OTLP/gRPC is not supported. See `docs/development/otlp-protobuf.md`.

## Identity and version

`packages/cli/product.json` holds the display name, CLI name, and internal package name; `packages/cli/package.json#version` is the only version. The CLI (`--version`, startup, doctor), dashboard capability report, and generated package manifest all read these. The package is `private: true` so `npm publish` refuses it.

## Decisions made during implementation

- **Standalone Next.js, not a rewrite.** `output: "standalone"` is enabled only for the packaging build (`AGENTMAP_DASHBOARD_STANDALONE=1`) so contributor `pnpm dev`/`pnpm build` are unchanged. Its traced `node_modules` (pnpm symlink layout) is not shipped; `next`/`react`/`react-dom` are exact-pinned package dependencies instead.
- **Fixture selection no longer requires the source tree.** `/api/repository` resolves allowlisted sample names to `AGENTMAP_SAMPLES_DIR/<name>` in packaged mode and to workspace fixtures in contributor mode; previously the whole route failed without the checkout.
- **Dashboard lifecycle.** The CLI's readiness probe uses a non-keep-alive request (a pooled socket delayed Next's graceful close), the SIGKILL fallback timer is cleared, and the packaged dashboard exits immediately on SIGTERM. A small launcher exits the dashboard if the CLI process disappears. Measured Ctrl+C shutdown on macOS: ≈50 ms (was ≈5 s).
- **Privacy/security defaults for the child.** `HOSTNAME` is pinned to `127.0.0.1` (shells often export the machine name, which the standalone server would bind to) and `NEXT_TELEMETRY_DISABLED=1` is set for both the packaging build and runtime.
- **Build-time tracer constraint.** Next's file tracer statically evaluates `path` calls; a call through a conditional function value such as `(a ? win32.join : posix.join)(…)` crashes the build, so platform-specific joins use explicit branches.
- **Independence is enforced, not just tested.** `dist:build` fails on workspace protocol use, runtime loads from the checkout or internal packages, symlinks, or forbidden content.

## Final verification (macOS, 2026-09-27)

148 automated tests (baseline 105), format/lint/typecheck/build green; packed tarball ≈1.8 MB; clean-install smoke 43/43 with the checkout renamed away and the standard Python exporter. Linux and Windows are covered by unit tests and a CI matrix that has not yet run (see `docs/development/platform-support.md`).

## Out of scope

Publishing, final naming, releases, auto-update, update checks, analytics, OTLP/gRPC, and M7.4 public-readiness work.
