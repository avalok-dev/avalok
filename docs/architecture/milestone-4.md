# Milestone 4: universal local runtime observability

> **Historical record.** Written while the product's working name was AgentMap; the product is now **Sarvadrik** (CLI `sarvadrik`, environment variables `SARVADRIK_*`). Commands and names below are as they were at the time.

## Baseline and verified starting point

AgentMap enters this milestone with three working layers that must remain separate:

1. the static `ArchitectureGraph` produced by `@visual-system/analyzer`;
2. the normalized execution graph and `Run.events` produced by a runtime source;
3. the derived unified graph produced by `@visual-system/reconcile`.

Milestone 1 provides the Map, Live, Runs, canvas, inspector, timeline, replay, speed controls, metrics, generic schemas, and deterministic demo. Milestone 2 adds read-only Codex JSONL discovery, normalization, historical replay, incremental live tailing over SSE, diagnostics, and raw/normalized inspection. Milestone 3 adds bounded static JS/TS repository analysis, evidence and confidence, and deterministic runtime-to-architecture reconciliation.

The untouched baseline was verified on 2026-09-24 with Node `24.19.0` and pnpm `11.19.0`: lint, typecheck, all 29 tests, and the Next.js production build pass. Before implementation, the ordinary shell resolved Node `20.14.0` and Homebrew pnpm `11.24.0`; that combination was incompatible because pnpm 11.24 requires Node 22.13 or newer. The implementation aligns the nvm default and Corepack with the repository versions without removing other Node installations.

## Scope

This milestone adds three runtime inputs while preserving the existing product and visual language:

- OTLP/HTTP trace ingestion with OpenInference-aware normalization;
- Claude Code through supported OpenTelemetry and lifecycle-hook interfaces;
- a small runtime-adapter contract shared by Codex, Claude Code, and telemetry.

It does not add cloud services, accounts, authentication, billing, hosted traces, additional static-analysis languages, or a general plugin framework.

## Architecture

```text
Codex JSONL ---------> Codex adapter ---------+
Claude hooks --------> Claude adapter --------+--> runtime adapter result
OTLP/OpenInference --> Telemetry adapter ------+        |
                                                         v
                                                Run + execution graph
                                                         |
                          static architecture ------------+--> reconciliation
                                                         |
                                                         v
                                                existing replay and UI
```

### Runtime adapter contract

`@visual-system/runtime-adapter` will contain only stable, vendor-neutral interfaces:

- source identity and display metadata;
- declared capabilities such as historical, live, tokens, files, commands, MCP, raw events, and reconciliation;
- normalized snapshots and deltas;
- common diagnostics;
- centralized redaction and truncation policies.

The contract does not force unsupported methods. Codex keeps its current discovery and live implementation while declaring its capabilities. Telemetry provides persisted historical runs and live updates. Claude hooks provide live observations and persisted runs; Claude's supported OpenTelemetry exporter can additionally provide model/API span hierarchy.

### Local collector

A small Node HTTP process will listen on `127.0.0.1:4318` by default and expose:

- `POST /v1/traces` for OTLP/HTTP;
- a dedicated local Claude hook endpoint;
- a health/diagnostics endpoint.

The host and port are explicit environment configuration. Non-loopback binding requires an explicit opt-in. Request bodies are bounded before parsing, malformed input returns a protocol-appropriate error without terminating the process, and telemetry values are never executed.

The receiver is intentionally not a replacement for the OpenTelemetry Collector. It accepts the standard trace export envelope, normalizes the subset AgentMap uses, persists local run snapshots, and reports unsupported observations through diagnostics.

### Persistence and live delivery

Normalized runtime snapshots are stored below the gitignored local `.agentmap/runtime` directory. Writes use a per-run serialization queue and atomic replacement so concurrent export batches cannot corrupt a run. No database or cloud service is introduced.

The web application exposes source/run discovery and one SSE stream shape for persisted runtime adapters. The existing replay engine and live-delta upsert semantics remain the browser-side implementation. Codex keeps its proven file-tail route, but both transports produce the same normalized snapshot/delta shape.

### OTLP and OpenInference normalization

The telemetry adapter preserves trace ID, span ID, parent span ID, start/end time, duration, status, span attributes, resource attributes, service identity, and scope metadata when present.

OpenInference `openinference.span.kind` values map conservatively:

- `AGENT` and orchestration `CHAIN` to agent activity;
- `LLM` to model activity;
- `TOOL` to tool activity, with MCP only when explicit MCP evidence exists;
- `RETRIEVER`, `EMBEDDING`, and `RERANKER` to retrieval/model-adjacent activity without fabricating a database;
- `PROMPT` to prompt activity.

Generic OpenTelemetry uses standard span kind and semantic attributes. HTTP spans remain HTTP; database spans require `db.system` or equivalent database evidence; external service spans remain services/APIs. An arbitrary HTTP span is never promoted to an AI agent.

OTLP exporters normally deliver ended spans. Such spans are rendered as completed observations that arrive live; AgentMap does not claim it saw their start. Claude lifecycle hooks can represent start/completion boundaries where the hook event actually provides them.

### Claude Code

Claude Code `2.1.231` is installed in the implementation environment. Local transcript files exist, but their format is explicitly documented by Anthropic as internal and version-sensitive, so transcript parsing will not be the primary live contract.

The supported integration is:

- Claude Code OpenTelemetry traces, enabled explicitly, sent to the local OTLP endpoint for prompt-to-API/tool trace structure;
- project- or user-configured HTTP lifecycle hooks sent to the local Claude endpoint for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, and `SessionEnd` observations;
- sanitized fixtures for deterministic adapter tests.

Hooks are observational and return success without changing permissions, tool input/output, or agent decisions. Reasoning/thinking content is ignored. Installation is opt-in and documented; AgentMap does not silently rewrite the user's Claude settings.

### Reconciliation

Existing exact source-path and workspace ownership matches remain highest confidence. Milestone 4 adds deterministic evidence for:

- source file attributes and Claude file-tool paths;
- `service.name` to a uniquely identified application/service;
- HTTP route attributes to detected route entities;
- `db.system` to a detected database integration;
- explicit provider/integration identity.

Ambiguous or unmatched entities remain visible. Every accepted match retains match type, confidence, and evidence.

### Privacy and size policy

Redaction and truncation happen before persistence and before raw-view serialization. Key matching is case-insensitive and separator-insensitive for common secret names including authorization, API keys, tokens, cookies, passwords, secrets, client secrets, and database URLs/connection strings. Nested objects and arrays are traversed with depth and item limits.

Strings and collections use centralized bounds. Truncated values retain `{ truncated: true, originalSize, value }` metadata rather than silently appearing complete. Raw inspectors consume only the sanitized representation.

### Performance

- ingestion operates on export batches rather than one UI update per span;
- normalized entities and edges use deterministic IDs so repeated batches upsert;
- the browser receives bounded deltas and retains graph object identity when topology is unchanged;
- layout is recomputed only when entity/edge identity changes;
- tests include concurrent batches and a moderate thousands-of-spans case.

## Delivery sequence

1. Add the runtime contract and centralized privacy/size policy with tests.
2. Add OTLP decoding, normalization, persistence, collector, and diagnostics.
3. Add the instrumented deterministic example and end-to-end ingestion test.
4. Add Claude hook normalization, fixtures, setup documentation, and shared live delivery.
5. Extend deterministic reconciliation and inspector trace hierarchy.
6. Add source selection for Telemetry and Claude Code without redesigning the UI.
7. Align repository and CI Node/pnpm declarations; make any user-default change separately and report it explicitly.
8. Run full regression verification and document exact manual acceptance tests.

## Acceptance boundaries

Milestone 4 is complete only when Demo, Codex historical/live, repository analysis, reconciliation, replay, and the current UI remain functional; real local OTLP/HTTP produces replayable live runs; OpenInference and generic spans are classified conservatively; Claude Code works through documented local interfaces; secrets and oversized values are safe; and fresh-shell toolchain behavior is reproducible.
