# AI System Visualizer

AgentMap visualizes detected repository architecture alongside observable local execution from Codex, Claude Code, and OpenTelemetry/OpenInference. Repository analysis is local, static, deterministic, and read-only: it never executes target code, reads secret values, sends source to a network service, or uses an LLM.

Use the source selector to switch between the built-in demo, the current repository, and discovered local runtime runs. Analyze the repository first and then choose a runtime run to enable the unified execution overlay.

An open-source visual foundation for understanding the architecture and observable runtime behavior of AI applications.

Milestone 2 keeps the local demo and adds a dedicated, read-only adapter for replaying and live-tailing observable activity from local Codex JSONL sessions. It highlights model responses, commands, file changes, MCP calls, errors, and request/response movement without representing hidden model reasoning.

## What exists today

- Typed, vendor-neutral schemas for architecture and runtime data
- Pure graph indexing, path-state, reconciliation, and ELK layout logic
- A framework-independent replay engine with seek and speed controls
- A polished Next.js visualization with Map, Live, and Runs views
- One realistic simulated research-agent run
- Local Codex session discovery, historical replay, live tailing, diagnostics, and raw/normalized inspection
- Local, static JS/TS and Python repository analysis with evidence and confidence
- Static Dockerfile/Compose understanding and multi-service ownership
- Deterministic architecture/runtime reconciliation and a unified execution overlay
- Local OTLP/HTTP (protobuf and JSON) ingestion with OpenInference-aware normalization, replay, and live updates
- Claude Code observations through supported OpenTelemetry traces and opt-in lifecycle hooks
- Local persisted runtime runs with redaction, truncation, hierarchy, and diagnostics
- Static Terraform, Kubernetes, Helm, and AWS infrastructure intelligence
- Unified application → deployment → cloud relationships, layer filters, and infrastructure inspector detail
- Provenance-aware configured/observed/estimated resource metric and cost schemas

Accounts and cloud services do not exist. Runtime data remains local.

## Run locally

Requires Node.js 24.19 or newer in the Node 24 LTS line and pnpm 11.19.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Installable preview package (local only)

AgentMap can be built into a single npm package and installed without this repository or pnpm. Nothing is published; the tarball is for local testing.

```bash
pnpm dist:build
pnpm dist:pack                      # → artifacts/visual-system-agentmap-<version>.tgz
npm install -g ./artifacts/visual-system-agentmap-*.tgz
agentmap /path/to/repository
```

OTLP/HTTP traces (protobuf or JSON) are accepted at `http://127.0.0.1:4318/v1/traces`. See `docs/development/distribution.md`.

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
- `packages/runtime-adapter` — vendor-neutral source capabilities, deltas, and privacy policy
- `packages/telemetry-adapter` — OTLP/OpenInference normalization and local persistence
- `packages/claude-adapter` — supported Claude Code hook normalization
- `apps/collector` — loopback-only local OTLP/Claude receiver
- `packages/analyzer` — bounded static repository intelligence
- `packages/reconcile` — deterministic architecture/runtime reconciliation
- `examples/demo-agent` — simulated system description
- `examples/instrumented-ai-app` — deterministic OTLP/OpenInference end-to-end fixture
- `examples/polyglot-ai-platform` — Next.js, FastAPI, worker, PostgreSQL, Redis, and Python OTLP fixture
- `examples/infrastructure-ai-platform` — unified code, Terraform AWS, Helm, and Kubernetes golden fixture
- `docs/architecture` — design notes and boundaries

## Capability matrix

| Source                                             | Static architecture | Runtime                         |
| -------------------------------------------------- | ------------------- | ------------------------------- |
| JavaScript / TypeScript                            | Supported           | OpenTelemetry                   |
| Python                                             | Supported           | OpenTelemetry / OpenInference   |
| Codex                                              | Not applicable      | Historical + live               |
| Claude Code                                        | Not applicable      | Hooks + OpenTelemetry           |
| Dockerfile / Compose                               | Supported           | Not applicable                  |
| Go / Java / Kotlin / Rust / other common languages | Inventory only      | OpenTelemetry when instrumented |
| Terraform / Kubernetes / Helm                      | Supported (static)  | Deployment context              |

See [the architecture overview](docs/architecture/overview.md), [Milestone 6 design](docs/architecture/milestone-6.md), [Milestone 6 acceptance guide](docs/development/milestone-6-acceptance.md), [project context](docs/PROJECT_CONTEXT.md), and [open-core boundary](docs/architecture/open-core.md).

## License

The AgentMap open-source core is available under the [Apache License 2.0](LICENSE). Future enterprise-only modules should be kept separate and may use different terms.
