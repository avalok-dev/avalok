# AI System Visualizer

AgentMap visualizes both detected repository architecture and observed local Codex execution. Repository analysis is local, static, deterministic, and read-only: it never executes target code, reads secret values, sends source to a network service, or uses an LLM.

Use the source selector to switch between the built-in demo, the current repository, and discovered local Codex sessions. Analyze the repository first and then choose a Codex session to enable the unified execution overlay.

An open-source visual foundation for understanding the architecture and observable runtime behavior of AI applications.

Milestone 2 keeps the local demo and adds a dedicated, read-only adapter for replaying and live-tailing observable activity from local Codex JSONL sessions. It highlights model responses, commands, file changes, MCP calls, errors, and request/response movement without representing hidden model reasoning.

## What exists today

- Typed, vendor-neutral schemas for architecture and runtime data
- Pure graph indexing, path-state, reconciliation, and ELK layout logic
- A framework-independent replay engine with seek and speed controls
- A polished Next.js visualization with Map, Live, and Runs views
- One realistic simulated research-agent run
- Local Codex session discovery, historical replay, live tailing, diagnostics, and raw/normalized inspection
- Local, static JS/TS repository analysis with evidence and confidence
- Deterministic architecture/runtime reconciliation and a unified execution overlay

Generic telemetry ingestion, persistence, accounts, and cloud services do not exist yet.

## Run locally

Requires Node.js 22.13 or newer and pnpm 11.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Workspace

- `apps/web` — demo application
- `packages/schema` — data model and validation
- `packages/graph` — graph and layout logic
- `packages/replay` — deterministic timeline engine
- `packages/ui` — reusable React visualization components
- `packages/codex-adapter` — read-only Codex JSONL discovery and normalization
- `packages/analyzer` — bounded static repository intelligence
- `packages/reconcile` — deterministic architecture/runtime reconciliation
- `examples/demo-agent` — simulated system description
- `docs/architecture` — design notes and boundaries

See [the architecture overview](docs/architecture/overview.md), [project context](docs/PROJECT_CONTEXT.md), and [open-core boundary](docs/architecture/open-core.md).

## License

The AgentMap open-source core is available under the [Apache License 2.0](LICENSE). Future enterprise-only modules should be kept separate and may use different terms.
