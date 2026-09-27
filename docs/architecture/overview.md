# Architecture overview

The product models architecture and execution as related but separate inputs.

`ArchitectureGraph` answers what exists. `Run.events` answers what happened. The graph package indexes the static structure and derives runtime emphasis from replay snapshots without changing the underlying architecture. This allows Map and Live to remain two views of the same system.

The dependency direction is intentionally one-way:

```text
schema <- graph
schema <- replay
schema + graph + replay <- ui <- web
```

The schema, graph, and replay packages contain no React code. `packages/ui` owns reusable presentation components, while `apps/web` owns fixture selection and screen composition.

Milestone 3 adds the two independent layers anticipated here:

```text
schema <- analyzer
schema <- codex-adapter
schema <- reconcile
```

The repository analyzer performs local static JS/TS analysis and produces evidence/confidence metadata. The reconciliation package deterministically associates runtime file paths with exact source locations and workspace ownership, producing a derived unified graph. Neither layer depends on React, and reconciliation remains outside UI components.

See [repository-analyzer.md](./repository-analyzer.md), [reconciliation.md](./reconciliation.md), and [milestone-3.md](./milestone-3.md).

Milestone 4 adds vendor-neutral local runtime ingestion while preserving those boundaries:

```text
schema <- runtime-adapter <- codex-adapter
                          <- claude-adapter
schema <- runtime-adapter <- telemetry-adapter <- collector
schema + analyzer + runtime events <- reconcile <- web
```

The local collector receives OTLP/HTTP JSON and Claude lifecycle hooks. The telemetry and Claude adapters normalize and persist vendor-neutral snapshots; the web application reuses the existing SSE, replay, graph, inspector, and reconciliation paths. OpenTelemetry-specific behavior does not enter graph, replay, or presentation packages.

See [runtime-adapters.md](./runtime-adapters.md), [opentelemetry.md](./opentelemetry.md), [claude-code.md](./claude-code.md), and [milestone-4.md](./milestone-4.md).

Milestone 5 generalizes repository analysis around stable service ownership. JS/TS and Python source adapters plus Dockerfile/Compose configuration adapters feed the same evidence, confidence, and `ArchitectureGraph` model. Runtime reconciliation stays language-neutral through source paths, service identity, routes, and integration metadata.

See [milestone-5.md](./milestone-5.md), [python-analysis.md](./python-analysis.md), [docker-analysis.md](./docker-analysis.md), and [service-inference.md](./service-inference.md).
