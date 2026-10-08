import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@visual-system/schema";
import { deriveDwellState, slowStepMs } from "../src/dwell";

function event(overrides: Partial<RuntimeEvent> & { id: string; timestamp: number }): RuntimeEvent {
  return {
    traceId: "t",
    category: "tool",
    action: "tool.call",
    ...overrides,
  } as RuntimeEvent;
}

const longTool = event({
  id: "tool",
  timestamp: 1_000,
  durationMs: 12_000,
  sourceEntityId: "agent",
  targetEntityId: "tool",
});

describe("deriveDwellState", () => {
  it("glows nothing before an event starts", () => {
    expect(deriveDwellState([longTool], 999).size).toBe(0);
  });

  it("keeps the working entity at full strength for the whole span, so slow steps look slow", () => {
    for (const t of [1_000, 5_000, 12_999, 13_000]) {
      const glow = deriveDwellState([longTool], t).get("tool");
      expect(glow).toMatchObject({ intensity: 1, role: "dwell", inFlight: true, slow: true });
    }
  });

  it("lights the caller more lightly than the entity doing the work", () => {
    const state = deriveDwellState([longTool], 6_000);
    expect(state.get("agent")).toMatchObject({ role: "caller", inFlight: true });
    expect(state.get("agent")!.intensity).toBeLessThan(state.get("tool")!.intensity);
  });

  it("fades out after the step ends and then disappears", () => {
    const halfway = deriveDwellState([longTool], 13_350).get("tool")!;
    expect(halfway.inFlight).toBe(false);
    expect(halfway.intensity).toBeGreaterThan(0.3);
    expect(halfway.intensity).toBeLessThan(0.7);
    expect(deriveDwellState([longTool], 14_000).has("tool")).toBe(false);
  });

  it("shows an event with no duration only as a brief pulse, never an invented dwell", () => {
    const instant = event({ id: "i", timestamp: 500, sourceEntityId: "a", targetEntityId: "b" });
    expect(deriveDwellState([instant], 600).get("b")).toMatchObject({ role: "dwell", slow: false });
    expect(deriveDwellState([instant], 600).get("b")!.intensity).toBeLessThan(1);
    expect(deriveDwellState([instant], 500 + 220 + 250 + 1).size).toBe(0);
  });

  it("marks steps at or over the slow threshold, and only those", () => {
    const fast = event({ id: "f", timestamp: 0, durationMs: slowStepMs - 1, targetEntityId: "x" });
    const slow = event({ id: "s", timestamp: 0, durationMs: slowStepMs, targetEntityId: "y" });
    const state = deriveDwellState([fast, slow], 100);
    expect(state.get("x")!.slow).toBe(false);
    expect(state.get("y")!.slow).toBe(true);
  });

  it("uses the only entity of an event as the working entity", () => {
    const solo = event({ id: "o", timestamp: 0, durationMs: 2_000, sourceEntityId: "model" });
    expect(deriveDwellState([solo], 1_000).get("model")).toMatchObject({ role: "dwell" });
  });

  it("lets reconciled architecture entities glow as the place the work happened", () => {
    const reconciled = event({
      id: "r",
      timestamp: 0,
      durationMs: 3_000,
      sourceEntityId: "codex",
      targetEntityId: "terminal",
      metadata: { architectureEntityIds: ["service:api", 7 as unknown as string] },
    });
    const state = deriveDwellState([reconciled], 1_000);
    expect(state.get("service:api")).toMatchObject({ role: "dwell", intensity: 1 });
    expect(state.size).toBe(3); // codex (caller), terminal and service:api; the non-string id is ignored
  });

  it("keeps the strongest glow when events overlap, and dwell beats caller", () => {
    const a = event({
      id: "a",
      timestamp: 0,
      durationMs: 5_000,
      sourceEntityId: "x",
      targetEntityId: "y",
    });
    const b = event({
      id: "b",
      timestamp: 1_000,
      durationMs: 5_000,
      sourceEntityId: "z",
      targetEntityId: "x",
    });
    const state = deriveDwellState([a, b], 2_000);
    expect(state.get("x")).toMatchObject({ role: "dwell", intensity: 1 }); // caller of a, dwell of b
  });

  it("is a pure function of the timestamp, so seeking in any order agrees", () => {
    const events = [
      longTool,
      event({ id: "m", timestamp: 4_000, durationMs: 500, targetEntityId: "model" }),
    ];
    const forward = [0, 2_000, 4_100, 9_000, 14_000].map((t) => [...deriveDwellState(events, t)]);
    const backward = [14_000, 9_000, 4_100, 2_000, 0]
      .map((t) => [...deriveDwellState(events, t)])
      .reverse();
    expect(backward).toEqual(forward);
  });

  it("ignores event order in the input", () => {
    const events = [
      event({ id: "late", timestamp: 8_000, durationMs: 4_000, targetEntityId: "b" }),
      event({ id: "early", timestamp: 0, durationMs: 4_000, targetEntityId: "a" }),
    ];
    expect([...deriveDwellState(events, 2_000).keys()]).toEqual(["a"]);
    expect([...deriveDwellState(events, 9_000).keys()]).toEqual(["b"]);
  });
});
