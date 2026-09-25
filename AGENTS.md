# AgentMap contributor instructions

## Start here

- AgentMap is a pnpm/Turborepo monorepo. Milestones 1-3 are complete and working; extend the existing system rather than rebuilding it.
- Read `docs/PROJECT_CONTEXT.md` before architecture, milestone, or cross-package work. Read only the narrower architecture document needed for the task.
- Respect more-specific `AGENTS.md` files under `apps/web`, `packages/analyzer`, and `packages/reconcile`.
- Preserve the established UI and all Demo and local Codex-session behavior unless the user explicitly requests a redesign or breaking change.

## Runtime and commands

- Required: Node.js `>=22.13.0`; pinned package manager: pnpm `11.19.0`.
- On Jaishnav's machine, prefer the known Node 24 Codex runtime:

  ```bash
  export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
  ```

- Install: `pnpm install --frozen-lockfile`
- Develop: `pnpm dev` (web app at `http://localhost:3000`)
- Verify: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- In a non-interactive runner, prefix pnpm commands with `CI=true`.

## Architectural invariants

- Keep `schema`, `graph`, `replay`, `analyzer`, `reconcile`, and `codex-adapter` independent from React.
- Maintain three distinct concepts: static Architecture Graph, runtime Execution Graph, and derived Unified Graph.
- Static analysis is local, deterministic, read-only, and non-executing. Never import target modules, run target scripts/builds, install target dependencies, read secret values, upload source, invoke an LLM, or make network requests while analyzing a repository.
- Do not hard-code knowledge of this repository into analyzer rules. Add reusable detectors and fixture coverage.
- Reconciliation is deterministic and explainable. Preserve unmatched external runtime entities rather than forcing matches.
- Product language is “detected,” “observed,” “inferred,” “evidence,” and “confidence”—never claim complete understanding.

## Working rules

- Inspect existing code and tests before changing behavior. Keep diffs scoped and preserve unrelated work.
- Add or update focused tests for behavior changes. Analyzer work must cover the current repository plus reusable fixtures; reconciliation work must cover matched and unmatched activity.
- Run the smallest relevant checks during development and the full four-command verification before a milestone or release handoff.
- Do not begin Milestone 4 or add Python, cloud, authentication, billing, telemetry ingestion, or new runtime adapters unless explicitly requested.
- Update `docs/PROJECT_CONTEXT.md` only when durable status, commands, decisions, or limitations change; do not turn it into a session transcript.
