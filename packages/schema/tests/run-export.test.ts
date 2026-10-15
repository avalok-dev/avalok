import { describe, expect, it } from "vitest";
import type { ArchitectureGraph, Run } from "../src/index";
import { prepareRunExportV1, RunExportV1Schema } from "../src/index";

const secret = "private-token-keep-out";
const architecture: ArchitectureGraph = {
  id: `graph-${secret}`,
  title: `Project ${secret}`,
  entities: [
    {
      id: `/home/alice/${secret}`,
      kind: "agent",
      name: `Agent ${secret}`,
      metadata: { password: secret },
    },
    { id: `model-${secret}`, kind: "model", name: `Model ${secret}` },
  ],
  edges: [{ id: `edge-${secret}`, source: `/home/alice/${secret}`, target: `model-${secret}` }],
};
const run: Run = {
  id: `run-${secret}`,
  title: `Title ${secret}`,
  prompt: `Prompt ${secret}`,
  startedAt: "2026-10-03T00:00:00.000Z",
  totalDurationMs: 30,
  inputTokens: 12,
  outputTokens: null,
  estimatedCostUsd: null,
  toolCallCount: 0,
  modelCallCount: 1,
  status: "completed",
  events: [
    {
      id: `event-${secret}`,
      traceId: `trace-${secret}`,
      spanId: `span-${secret}`,
      timestamp: 5,
      durationMs: 10,
      category: "model",
      action: `Action ${secret}`,
      sourceEntityId: `/home/alice/${secret}`,
      targetEntityId: `model-${secret}`,
      metadata: { authorization: secret, status: "error", retryObserved: true },
    },
    {
      id: `second-${secret}`,
      traceId: `trace-${secret}`,
      timestamp: 20,
      category: "response",
      action: `Response ${secret}`,
      sourceEntityId: `model-${secret}`,
      metadata: { body: secret },
    },
  ],
};

describe("versioned run export", () => {
  it("retains useful event structure without content, original IDs, names, paths, or metadata", () => {
    const payload = prepareRunExportV1(run, architecture, "telemetry");
    expect(payload).toEqual({
      format: "avalok.run-export",
      version: 1,
      source: "telemetry",
      run: {
        status: "completed",
        totalDurationMs: 30,
        inputTokens: 12,
        outputTokens: null,
        toolCallCount: 0,
        modelCallCount: 1,
      },
      entities: [
        { id: 1, kind: "agent" },
        { id: 2, kind: "model" },
      ],
      events: [
        {
          sequence: 1,
          trace: 1,
          timestampMs: 5,
          durationMs: 10,
          category: "model",
          sourceEntity: 1,
          targetEntity: 2,
          failed: true,
          retryObserved: true,
        },
        {
          sequence: 2,
          trace: 1,
          timestampMs: 20,
          category: "response",
          sourceEntity: 2,
          failed: false,
          retryObserved: false,
        },
      ],
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("/home/alice");
    expect(serialized).not.toContain("2026-10-03");
    expect(RunExportV1Schema.safeParse(payload).success).toBe(true);
  });

  it("omits references to unknown entities and does not mutate the local run", () => {
    const original = structuredClone(run);
    const payload = prepareRunExportV1(
      {
        ...run,
        events: [{ ...run.events[0]!, sourceEntityId: "unknown", targetEntityId: "unknown" }],
      },
      architecture,
      "codex",
    );
    expect(payload.entities).toEqual([]);
    expect(payload.events[0]).not.toHaveProperty("sourceEntity");
    expect(payload.events[0]).not.toHaveProperty("targetEntity");
    expect(run).toEqual(original);
  });

  it("rejects unversioned, extra, and content-bearing fields at every level", () => {
    const payload = prepareRunExportV1(run, architecture, "demo");
    expect(RunExportV1Schema.safeParse({ ...payload, version: 2 }).success).toBe(false);
    expect(RunExportV1Schema.safeParse({ ...payload, prompt: secret }).success).toBe(false);
    expect(
      RunExportV1Schema.safeParse({ ...payload, run: { ...payload.run, title: secret } }).success,
    ).toBe(false);
    expect(
      RunExportV1Schema.safeParse({
        ...payload,
        events: [{ ...payload.events[0], metadata: { body: secret } }],
      }).success,
    ).toBe(false);
    expect(
      RunExportV1Schema.safeParse({
        ...payload,
        events: [{ ...payload.events[0], sourceEntity: 99 }, payload.events[1]],
      }).success,
    ).toBe(false);
    expect(
      RunExportV1Schema.safeParse({
        ...payload,
        events: [{ ...payload.events[0], sequence: 2 }, payload.events[1]],
      }).success,
    ).toBe(false);
  });
});
