import { describe, expect, it } from "vitest";
import type { Run } from "@visual-system/schema";
import { deriveRunInsights } from "../src/lib/run-insights";

const base: Run = {
  id: "run",
  title: "Test",
  prompt: "Test",
  startedAt: "2026-10-03T00:00:00.000Z",
  totalDurationMs: 15_000,
  inputTokens: null,
  outputTokens: null,
  estimatedCostUsd: null,
  toolCallCount: 0,
  modelCallCount: 0,
  status: "completed",
  events: [],
};

describe("local run findings", () => {
  it("reports observed memory failures, timed calls, and slow steps without double counting an event", () => {
    const insights = deriveRunInsights({
      ...base,
      events: [
        {
          id: "memory",
          traceId: "trace",
          timestamp: 0,
          durationMs: 12_000,
          category: "error",
          action: "retrieval.error",
          metadata: { observedCategory: "retrieval", status: "error", retryObserved: true },
        },
        {
          id: "memory",
          traceId: "trace",
          timestamp: 0,
          durationMs: 12_000,
          category: "error",
          action: "retrieval.error",
          metadata: { observedCategory: "retrieval", status: "error", retryObserved: true },
        },
        {
          id: "memory-2",
          traceId: "trace",
          timestamp: 100,
          category: "memory",
          action: "memory.read",
        },
      ],
    });
    expect(insights.map((insight) => insight.id)).toEqual([
      "failures",
      "slow-steps",
      "memory-retrieval",
      "retries",
    ]);
    expect(insights.find((insight) => insight.id === "memory-retrieval")?.detail).toBe(
      "1 failed · 12000 ms average (1 timed)",
    );
  });

  it("does not invent warnings or latency for an untimed successful run", () => {
    expect(
      deriveRunInsights({
        ...base,
        events: [
          {
            id: "call",
            traceId: "trace",
            timestamp: 0,
            category: "retrieval",
            action: "retrieval.query",
          },
        ],
      }),
    ).toEqual([
      {
        id: "memory-retrieval",
        severity: "info",
        title: "Memory and retrieval: 1 call",
        detail: "0 failed · latency unavailable (0 timed)",
      },
    ]);
  });
});
