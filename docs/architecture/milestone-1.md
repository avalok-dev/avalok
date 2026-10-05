# Milestone 1 implementation plan

> **Historical record.** Written while the product's working name was AgentMap (later Sarvadrik); the product is now **Avalok** (CLI `avalok`, environment variables `AVALOK_*`). Commands and names below are as they were at the time.

## Goal

Ship a local-first visual prototype that presents one architecture graph in two synchronized views: a quiet static map and a replayable simulated runtime execution.

## Architecture

- `packages/schema`: vendor-neutral Zod schemas and inferred TypeScript types for entities, edges, events, spans, traces, runs, and static/runtime graphs.
- `packages/graph`: React-independent graph indexing, active/completed path derivation, static/runtime reconciliation contracts, and an ELK-backed layout abstraction.
- `packages/replay`: deterministic replay engine with play, pause, reset, seek, speed control, event ordering, and snapshot calculation.
- `packages/ui`: reusable visualization components, including React Flow nodes/edges, inspectors, timeline, controls, status, and metrics.
- `apps/web`: Next.js App Router application, demo fixtures, client visualization state, and composition of the product workspace.
- `examples/demo-agent`: fixture documentation showing the simulated system represented by the application.

## Delivery sequence

1. Establish the pnpm/Turborepo workspace and shared strict TypeScript, ESLint, Prettier, and Vitest configuration.
2. Implement and test schemas, graph operations, layout, and the framework-independent replay engine.
3. Build reusable UI primitives and the single-screen desktop-first visualization workspace.
4. Wire Map, Live, and Runs modes to one graph and one simulated run; synchronize graph animation, timeline, metrics, and inspectors.
5. Add concise architecture and open-core documentation.
6. Verify formatting, lint, type checking, unit tests, production build, and the running application in a browser.

## Scope boundaries

This milestone has no backend, authentication, persistence, repository scanner, telemetry ingestion, or model integration. Every runtime event is an explicit local fixture, and the UI describes it as simulated observable activity rather than hidden model reasoning.
