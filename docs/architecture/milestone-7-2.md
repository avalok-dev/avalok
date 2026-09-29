# Milestone 7.2 — first-run UX and local operability

> **Historical record.** Written while the product's working name was AgentMap; the product is now **Sarvadrik** (CLI `sarvadrik`, environment variables `SARVADRIK_*`). Commands and names below are as they were at the time.

Milestone 7.2 productizes the local M7.1 startup path without changing analyzers or adding cloud services.

## First run

CLI-launched dashboards analyze the target immediately and, until dismissed, open a compact Getting Started overlay. It summarizes only real analyzer and adapter data: repository counts, detected languages, supported versus inventory-only analysis, configured infrastructure, local runtime availability, listener state, and observed activity. Setup remains available from the top bar. Dismissal is stored in AgentMap's user-data settings, never in the target repository.

The Map remains directly accessible. Live and Runs explain why they are empty and offer telemetry setup. The source selector shows Codex, Claude Code, and telemetry status independently.

## Capability semantics

`@visual-system/capabilities` is the shared UI/doctor source of truth. Its axes deliberately do not collapse into one badge:

- `support`: `supported` or `inventory-only` describes what AgentMap implements.
- `detected`: describes repository evidence.
- `availability`: `available`, `not-detected`, or `error` describes a local runtime source.
- `connection`: `ready`, `listening`, `not-configured`, or `unavailable` describes integration readiness.
- `observation`: `waiting` or `observed` describes whether activity exists.

Thus a healthy OTLP receiver with zero spans is **listening / waiting**, not unavailable. Terraform, Kubernetes, Helm, and inferred AWS are **configured architecture**. AgentMap does not claim a live cloud account or cluster connection.

## Local flow

The capability route combines cached repository analysis, read-only Codex discovery, read-only Claude availability/config inspection, persisted local runtime summaries, and collector health. The deterministic test-trace route asks the loopback collector to ingest five OTLP/HTTP JSON spans. The service, run, entities, scope, and span names all say Synthetic Fixture/Test.

Privacy language is bounded to AgentMap: AgentMap does not upload the repository, local agent sessions, or telemetry to an AgentMap cloud service. This makes no claim about third-party developer tools.

## Scope boundary

M7.2 does not add Go/Java analysis, protobuf or gRPC ingestion, live AWS/Kubernetes access, packaging, publishing, analytics, accounts, or release work. Those remain outside this milestone.
