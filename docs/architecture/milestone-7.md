# Milestone 7: public developer preview

> **Historical record.** Written while the product's working name was AgentMap (later Sarvadrik); the product is now **Avalok** (CLI `avalok`, environment variables `AVALOK_*`). Commands and names below are as they were at the time.

Milestone 7 turns the completed local AgentMap system into a developer-preview product without changing the static-analysis, runtime, reconciliation, or UI foundations delivered in Milestones 1-6. The product name remains provisional and no public package name, account, release, or irreversible branding dependency is created in this milestone.

## Staged delivery

### M7.1 — CLI and one-command local startup

Add a package-shaped CLI, safe repository targeting, deterministic local orchestration, loopback binding, readiness checks, calm startup output, browser opening, and coordinated shutdown. The implementation is documented in `milestone-7-1-cli.md`.

### M7.2 — first-run experience

Add first-run guidance, clearer automatic capability discovery, telemetry setup guidance, and a focused `doctor` workflow. Standardize user-data configuration if the preview reveals additional requirements. Do not add new runtime adapters as part of onboarding.

### M7.3 — distribution packaging

Produce the npm-ready package, compile or bundle the CLI and dashboard assets, remove the remaining source-workspace dependency, and verify a packed artifact on a clean machine. Also adds OTLP/HTTP protobuf ingestion and safe migration from the provisional M7.1 data location. Implemented; see `milestone-7-3.md`. The package identity is internal and reversible; the public name and release strategy remain M7.4 decisions.

### M7.4 — public-preview readiness

Complete the public README, privacy/security review, contributor documentation, and release checklist. This stage owns publication and release decisions; earlier stages do not publish anything.

## Boundaries

M7 does not add authentication, hosting, billing, analytics, live cloud access, live cluster access, cost ingestion, or architecture diffing. Static analysis remains local, deterministic, read-only, and independently useful.
