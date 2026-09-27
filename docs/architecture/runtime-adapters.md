# Runtime adapters

AgentMap runtime sources implement a small vendor-neutral contract in `@visual-system/runtime-adapter`. The contract describes the source, declares capabilities, and returns normalized snapshots and deltas containing an execution graph, a `Run`, bounded raw observations, and diagnostics.

| Source      | Historical            | Live                        | Persistence          | Primary interface                                |
| ----------- | --------------------- | --------------------------- | -------------------- | ------------------------------------------------ |
| Demo        | built in              | replay only                 | source fixture       | deterministic schema fixture                     |
| Codex       | yes                   | yes                         | Codex-owned JSONL    | read-only discovery and incremental tail         |
| Claude Code | yes after observation | yes                         | user-data `runtime/` | supported hooks plus optional Claude OTel traces |
| Telemetry   | yes after ingestion   | completed spans arrive live | user-data `runtime/` | OTLP/HTTP JSON                                   |

Adapters do not parse inside React, graph, replay, or UI packages. Those packages consume only normalized entities, edges, events, runs, and diagnostics. Capabilities are descriptive rather than a forced interface: a source does not implement a fake method merely to satisfy a plugin framework.

Persisted adapters use deterministic run/session IDs and event IDs. Repeated exports upsert instead of creating duplicate nodes. The web application streams the same snapshot/delta shape used by the existing Codex live flow, so replay, Jump to Live, metrics, timeline, and reconciliation remain shared behavior.

Adding a future adapter requires: a source descriptor, defensive normalization into the shared schema, stable IDs, sanitized raw observations, and focused tests. It does not require UI-specific parsing or a new visualization application.
