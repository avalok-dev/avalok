import { describe, expect, it } from "vitest";
import { ArchitectureGraphSchema, ResourceMetricSchema, RunSchema } from "../src/index";

describe("schema validation", () => {
  it("accepts a connected architecture", () => {
    const result = ArchitectureGraphSchema.safeParse({
      id: "demo",
      title: "Demo",
      entities: [
        { id: "user", kind: "user", name: "User" },
        { id: "agent", kind: "agent", name: "Agent" },
      ],
      edges: [{ id: "user-agent", source: "user", target: "agent" }],
    });

    expect(result.success).toBe(true);
  });

  it("rejects dangling edges", () => {
    const result = ArchitectureGraphSchema.safeParse({
      id: "demo",
      title: "Demo",
      entities: [{ id: "user", kind: "user", name: "User" }],
      edges: [{ id: "missing", source: "user", target: "unknown" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects unordered run events", () => {
    const result = RunSchema.safeParse({
      id: "run",
      title: "Run",
      prompt: "Hello",
      startedAt: "2026-01-01T00:00:00.000Z",
      totalDurationMs: 100,
      inputTokens: 1,
      outputTokens: 1,
      estimatedCostUsd: 0,
      toolCallCount: 0,
      modelCallCount: 0,
      status: "completed",
      events: [
        { id: "b", traceId: "t", timestamp: 20, category: "model", action: "model.call" },
        { id: "a", traceId: "t", timestamp: 10, category: "prompt", action: "prompt.received" },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("distinguishes configured, observed, and estimated resource metrics", () => {
    expect(
      ResourceMetricSchema.parse({
        name: "replicas",
        status: "configured",
        source: "deployment.yaml · spec.replicas",
        unit: "count",
        value: 3,
      }),
    ).toMatchObject({ status: "configured", value: 3 });
    expect(
      ResourceMetricSchema.safeParse({
        name: "cpu-utilization",
        status: "actual",
        source: "unknown",
        value: 0.5,
      }).success,
    ).toBe(false);
  });
});
