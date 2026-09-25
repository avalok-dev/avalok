# AgentMap project context

This is concise durable context for new coding tasks. `AGENTS.md` contains mandatory rules; this file records current product state and decisions.

## Current state

- **Milestone 1:** polished architecture canvas, Map/Live/Runs, generic schemas, graph/replay engines, inspector, timeline, and deterministic demo.
- **Milestone 2:** read-only local Codex JSONL discovery, normalization, historical replay, live tailing, files/terminal/MCP/model activity, metrics, source/session selection, diagnostics, and raw/normalized event inspection.
- **Milestone 3:** local static JS/TS repository analysis, evidence/confidence, architecture inference, repository map, deterministic architecture/runtime reconciliation, and execution overlay.
- Milestones 1-3 are complete. Do not recreate them. No Milestone 4 scope has been approved.

## Package map

| Area                     | Responsibility                                                       |
| ------------------------ | -------------------------------------------------------------------- |
| `apps/web`               | Next.js UI, local server routes, source selection, state composition |
| `packages/schema`        | Vendor-neutral architecture/runtime schemas                          |
| `packages/graph`         | Indexing, ELK layout, replay-derived graph state                     |
| `packages/replay`        | Deterministic timeline, seek, speed, snapshots                       |
| `packages/ui`            | Reusable React canvas, inspector, timeline, controls                 |
| `packages/codex-adapter` | Read-only Codex session discovery and event normalization            |
| `packages/analyzer`      | Bounded static repository inventory, parsing, detection, inference   |
| `packages/reconcile`     | Deterministic runtime-to-architecture matching and unified graph     |
| `examples/demo-agent`    | Stable simulated demonstration fixture                               |

Dependency direction stays toward reusable data packages; analysis and reconciliation do not belong in React components.

## Core decisions

- TypeScript Compiler API parses TS/JS/TSX/JSX in syntax-only mode. JSON/configuration is read as data; target code is never evaluated.
- Default map abstraction is system/package level. Files are inspector detail, not thousands of canvas nodes.
- Architecture entities and important edges retain bounded evidence and deterministic confidence.
- Reconciliation order: exact relative path, normalized absolute path, longest workspace ownership, then known route/integration identity.
- The Unified Graph is derived. It never mutates the static graph; Terminal, model, MCP, Files, Tests, and other useful unmatched runtime entities remain visible.
- The browser may analyze only the server-selected current repository. It must not accept an unchecked arbitrary filesystem path.
- Repository analysis stays local: no LLM, cloud, telemetry, or source upload.

## Verified baseline (2026-09-24)

- Runtime: Node `24.19.0`, pnpm `11.19.0` using the path documented in root `AGENTS.md`.
- `lint`, `typecheck`, all 29 unit tests, and production build pass.
- Development server, Demo mode, repository map/rescan, local Codex replay/live flow, evidence inspector, and execution toggle were browser-verified.
- Current repository analysis: 101 files discovered, 83 parsed, 20 ignored, 9 packages, 112 import edges, 13 architecture entities, 19 architecture edges, 0 unresolved imports, 0 warnings, approximately 0.18 seconds uncached.
- Expected entities: Web Application, Demo Agent, Repository Analyzer, Codex Adapter, Graph Engine, Reconciliation, Replay Engine, Schema, UI Components, and four local API routes.

Exact counts may change as the repository changes; tests should assert meaningful facts rather than incidental totals.

## Known limits

- Static language scope is JS/TS/JSX/TSX/JSON; no Python yet.
- Import/route/URL inference is intentionally static and cannot resolve every computed value.
- Cache is process-local; rescan is explicit; no continuous repository watcher.
- Current-repository selection only; no GitHub cloning or arbitrary local-path browser input.
- Web/UI behavior has unit coverage through underlying packages plus browser verification, but no dedicated component suite yet.
- Next.js build emits a non-blocking warning that its optional ESLint plugin is not detected in the shared configuration; lint still passes.

## Source-of-truth documents

- `docs/architecture/overview.md`
- `docs/architecture/milestone-3.md`
- `docs/architecture/repository-analyzer.md`
- `docs/architecture/reconciliation.md`
- `docs/architecture/codex-adapter.md`

Potential Milestone 4 direction discussed but not approved: OpenTelemetry/OpenInference runtime trace ingestion using the existing reconciliation layer.
