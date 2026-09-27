import { describe, expect, it } from "vitest";
import { deltaBetween, runtimeSources, sanitizeValue, type RuntimeSnapshot } from "../src";

describe("runtime privacy policy", () => {
  it("redacts common secret keys recursively", () => {
    const result = sanitizeValue({
      Authorization: "Bearer fake-secret",
      nested: { api_key: "fake-key", ordinary: "visible" },
      setCookie: "session=fake",
    });
    expect(result.value).toEqual({
      Authorization: "[REDACTED]",
      nested: { api_key: "[REDACTED]", ordinary: "visible" },
      setCookie: "[REDACTED]",
    });
    expect(result.stats.redactedFields).toBe(3);
  });

  it("retains explicit truncation metadata", () => {
    const result = sanitizeValue(
      { output: "123456", items: [1, 2, 3] },
      { maxStringLength: 3, maxArrayLength: 2, maxObjectKeys: 4, maxDepth: 2 },
    );
    expect(result.value).toEqual({
      output: { value: "123…", truncated: true, originalSize: 6 },
      items: { value: [1, 2], truncated: true, originalSize: 3 },
    });
    expect(result.stats.truncatedFields).toBe(2);
  });
});

describe("runtime live deltas", () => {
  it("emits changed events as well as new events", () => {
    const snapshot = (phase: string): RuntimeSnapshot => ({
      source: runtimeSources.claude,
      session: {
        id: "session",
        source: "claude",
        title: "Claude",
        startedAt: "2026-01-01T00:00:00.000Z",
        modifiedAt: `2026-01-01T00:00:0${phase === "started" ? "1" : "2"}.000Z`,
        status: "active",
        eventCount: 1,
      },
      architecture: {
        id: "claude:session",
        title: "Claude",
        entities: [{ id: "claude", kind: "agent", name: "Claude" }],
        edges: [],
      },
      run: {
        id: "session",
        title: "Claude",
        prompt: "test",
        startedAt: "2026-01-01T00:00:00.000Z",
        totalDurationMs: 1,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
        toolCallCount: 1,
        modelCallCount: 0,
        status: "running",
        events: [
          {
            id: "tool:1",
            traceId: "session",
            timestamp: 0,
            category: "tool",
            action: `tool.call.${phase}`,
            metadata: { phase },
          },
        ],
      },
      rawEvents: { "tool:1": { phase } },
      diagnostics: [],
    });
    const delta = deltaBetween(snapshot("started"), snapshot("completed"));
    expect(delta.events).toHaveLength(1);
    expect(delta.events[0]?.metadata?.phase).toBe("completed");
    expect(delta.rawEvents["tool:1"]).toEqual({ phase: "completed" });
  });
});
