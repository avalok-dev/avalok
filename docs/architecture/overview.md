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
