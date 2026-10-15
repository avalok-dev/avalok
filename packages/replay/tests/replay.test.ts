import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@visual-system/schema";
import { ReplayEngine } from "../src/index";

const events: RuntimeEvent[] = [
  { id: "late", traceId: "t", timestamp: 600, durationMs: 100, category: "model", action: "call" },
  {
    id: "early",
    traceId: "t",
    timestamp: 100,
    durationMs: 200,
    category: "http",
    action: "request",
  },
  {
    id: "middle",
    traceId: "t",
    timestamp: 400,
    durationMs: 100,
    category: "agent",
    action: "start",
  },
];

describe("ReplayEngine", () => {
  it("sorts events without mutating input", () => {
    const engine = new ReplayEngine(events, { durationMs: 1_000 });
    expect(engine.seek(450).currentEvent?.id).toBe("middle");
    expect(events[0]?.id).toBe("late");
  });

  it("advances only while playing", () => {
    const engine = new ReplayEngine(events, { durationMs: 1_000 });
    expect(engine.advance(100).currentTimestamp).toBe(0);
    engine.play();
    expect(engine.advance(100).currentTimestamp).toBe(100);
    engine.pause();
    expect(engine.advance(100).currentTimestamp).toBe(100);
  });

  it("seeks and clamps to the run duration", () => {
    const engine = new ReplayEngine(events, { durationMs: 1_000 });
    expect(engine.seek(350).currentTimestamp).toBe(350);
    expect(engine.seek(2_000).currentTimestamp).toBe(1_000);
    expect(engine.seek(-1).currentTimestamp).toBe(0);
  });

  it("applies playback speed", () => {
    const engine = new ReplayEngine(events, { durationMs: 1_000 });
    engine.setSpeed(4);
    engine.play();
    expect(engine.advance(100).currentTimestamp).toBe(400);
  });

  it("reports completed events at the selected time", () => {
    const engine = new ReplayEngine(events, { durationMs: 1_000, minimumActiveMs: 0 });
    const snapshot = engine.seek(550);
    expect(snapshot.completedEvents.map((event) => event.id)).toEqual(["early", "middle"]);
    expect(snapshot.currentEvent?.id).toBe("middle");
  });
});
