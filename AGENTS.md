# AgentMap contributor instructions

## Start here

- AgentMap is a pnpm/Turborepo monorepo. Milestones 1-6 are complete and working; extend the existing system rather than rebuilding it.
- Read `docs/PROJECT_CONTEXT.md` before architecture, milestone, or cross-package work. Read only the narrower architecture document needed for the task.
- Respect more-specific `AGENTS.md` files under `apps/web`, `packages/analyzer`, and `packages/reconcile`.
- Preserve the established UI and all Demo and local Codex-session behavior unless the user explicitly requests a redesign or breaking change.

## Runtime and commands

- Required: Node.js `>=24.19.0 <25`; pinned package manager: pnpm `11.19.0`.
- On Jaishnav's machine, prefer the known Node 24 Codex runtime:

  ```bash
  export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
  ```

- Install: `pnpm install --frozen-lockfile`
- Develop: `pnpm dev` (web app at `http://localhost:3000`, local collector at `http://127.0.0.1:4318`)
- Verify: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- In a non-interactive runner, prefix pnpm commands with `CI=true`.
- Distribution (M7.3): `pnpm dist:build && pnpm dist:pack && pnpm dist:smoke --hide-workspace`. Run it after changes to the CLI, dashboard routes, collector, or anything the installed package loads; never publish.
- Packages bundled into the dashboard must not call `path` functions through a conditional function value (e.g. `(a ? win32.join : posix.join)(…)`); Next's build-time file tracer crashes on it. Use explicit branches.
- In dashboard-bundled code, take `homedir()` as a parameter default (`home = homedir()`), never inline inside a path expression, and do not build arrays of joined paths: Next's tracer evaluates them and, on Windows across drives, globs the home directory (`packages/cli/tests/build-tracing.test.ts` guards this).
- Release artifacts come from `pnpm release:build` (neutral temp path, path-leak scan, packaged smoke), never an in-place `dist:build`.
- Local HTTP (M7.4A): every dashboard request passes `apps/web/src/middleware.ts`; collector routes pass `guardCollectorRequest`. New mutation routes must accept JSON only; never add `Access-Control-*` headers. See `docs/security/local-http.md`.

## Architectural invariants

- Keep `schema`, `graph`, `replay`, `analyzer`, `reconcile`, and runtime adapters independent from React.
- Maintain three distinct concepts: static Architecture Graph, runtime Execution Graph, and derived Unified Graph.
- Static analysis is local, deterministic, read-only, and non-executing. Never import target modules, run target scripts/builds, install target dependencies, read secret values, upload source, invoke an LLM, or make network requests while analyzing a repository.
- Do not hard-code knowledge of this repository into analyzer rules. Add reusable detectors and fixture coverage.
- Reconciliation is deterministic and explainable. Preserve unmatched external runtime entities rather than forcing matches.
- Product language is “detected,” “observed,” “inferred,” “evidence,” and “confidence”—never claim complete understanding.

## Working rules

- Inspect existing code and tests before changing behavior. Keep diffs scoped and preserve unrelated work.
- Add or update focused tests for behavior changes. Analyzer work must cover the current repository plus reusable fixtures; reconciliation work must cover matched and unmatched activity.
- Run the smallest relevant checks during development and the full four-command verification before a milestone or release handoff.
- Do not add live cloud/cluster access, authentication, billing, hosted telemetry, or new runtime adapters unless explicitly requested. Infrastructure analysis remains static and non-executing.
- Update `docs/PROJECT_CONTEXT.md` only when durable status, commands, decisions, or limitations change; do not turn it into a session transcript.
