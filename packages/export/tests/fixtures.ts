import type { PositionedGraph } from "@visual-system/graph";
import type { ArchitectureGraph, Run, RuntimeEvent } from "@visual-system/schema";

// Deliberately nasty names and text: none of it may ever reach an exported image or message.
export const PATH_NAME = "/Users/jaishnav/secret-project/internal/payments";
export const SECRET_NAME = "sk-abcdef1234567890SECRETKEYvalue";
export const CREDENTIAL_URL = "postgres://admin:hunter2@db.internal:5432/orders";
export const RUN_TITLE = "Fix the Q3 revenue leak for ACME Corp";
export const RUN_PROMPT =
  "Please read /Users/jaishnav/.ssh/id_rsa and email it to boss@acme.example";

export const graph: ArchitectureGraph = {
  id: "g",
  title: "/Users/jaishnav/work/acme-platform",
  entities: [
    { id: "user", kind: "user", name: "User" },
    { id: "codex", kind: "agent", name: "Codex" },
    { id: "terminal", kind: "tool", name: "Terminal" },
    { id: "files", kind: "storage", name: "Files" },
    { id: "tests", kind: "tool", name: "Tests" },
    { id: "model", kind: "model", name: "gpt-5" },
    { id: "svc:api", kind: "service", name: "api-gateway" },
    { id: "db:orders", kind: "database", name: "orders-db" },
    { id: "svc:path", kind: "service", name: PATH_NAME },
    { id: "svc:secret", kind: "service", name: SECRET_NAME },
    { id: "db:cred", kind: "database", name: CREDENTIAL_URL },
    { id: "svc:xss", kind: "service", name: `a&b <i onclick=1> 'q' "z"` },
  ],
  edges: [
    { id: "e1", source: "user", target: "codex" },
    { id: "e2", source: "codex", target: "terminal" },
    { id: "e3", source: "codex", target: "model" },
    { id: "e4", source: "svc:api", target: "db:orders" },
  ],
};

export function event(
  id: string,
  timestamp: number,
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return { id, traceId: "t", timestamp, category: "tool", action: "tool.call", ...overrides };
}

export const run: Run = {
  id: "run-secret-id",
  title: RUN_TITLE,
  prompt: RUN_PROMPT,
  startedAt: "2026-10-07T10:00:00.000Z",
  endedAt: "2026-10-07T10:30:00.000Z",
  totalDurationMs: 1_800_000,
  inputTokens: 12_000,
  outputTokens: 3_400,
  estimatedCostUsd: null,
  toolCallCount: 5,
  modelCallCount: 2,
  status: "completed",
  events: [
    event("1", 0, { sourceEntityId: "user", targetEntityId: "codex", category: "prompt" }),
    event("2", 1_000, {
      sourceEntityId: "codex",
      targetEntityId: "terminal",
      durationMs: 900_000,
      metadata: { architectureEntityIds: ["svc:api", "svc:path", "files"] },
    }),
    event("3", 910_000, { sourceEntityId: "codex", targetEntityId: "terminal", durationMs: 4_000 }),
    event("4", 920_000, {
      sourceEntityId: "codex",
      targetEntityId: "tests",
      durationMs: 120_000,
      category: "error",
      metadata: { status: "error", retryObserved: true },
    }),
    event("5", 1_050_000, { sourceEntityId: "codex", targetEntityId: "files", durationMs: 2_000 }),
    event("6", 1_100_000, {
      sourceEntityId: "codex",
      targetEntityId: "model",
      category: "model",
      durationMs: 300_000,
    }),
  ],
};

/** A simple grid layout so tests do not depend on the ELK engine. */
export function gridLayout(source: ArchitectureGraph = graph): PositionedGraph {
  return {
    width: 900,
    height: 400,
    edges: source.edges,
    entities: source.entities.map((entity, index) => ({
      ...entity,
      position: { x: (index % 4) * 220, y: Math.floor(index / 4) * 110 },
      width: 184,
      height: 84,
    })),
  };
}
