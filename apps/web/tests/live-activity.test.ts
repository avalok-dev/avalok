import { describe, expect, it } from "vitest";
import type { Run, RuntimeEvent } from "@visual-system/schema";
import { deriveLiveActivity, formatElapsed } from "../src/lib/live-activity";

const t0 = Date.parse("2026-11-23T10:00:00.000Z");

function run(events: RuntimeEvent[]): Run {
  return {
    id: "run",
    title: "Test",
    prompt: "Test",
    startedAt: new Date(t0).toISOString(),
    totalDurationMs: 0,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    toolCallCount: 0,
    modelCallCount: 0,
    status: "running",
    events,
  };
}

// Claude events as the hook normalizer and merge produce them: absolute times in metadata.
function claude(
  id: string,
  category: RuntimeEvent["category"],
  action: string,
  startS: number,
  endS = startS,
  metadata: Record<string, unknown> = {},
): RuntimeEvent {
  return {
    id,
    traceId: "trace",
    timestamp: startS * 1000,
    ...(endS === startS ? {} : { durationMs: (endS - startS) * 1000 }),
    category,
    action,
    metadata: { absoluteStartMs: t0 + startS * 1000, absoluteEndMs: t0 + endS * 1000, ...metadata },
  };
}
const prompt = (startS: number) => claude(`prompt:${startS}`, "prompt", "prompt.received", startS);
const model = (startS: number) => claude(`model:${startS}`, "model", "model.response", startS);
const bashStarted = (startS: number) =>
  claude("tool:1", "tool", "terminal.command.started", startS, startS, {
    hookEvent: "PreToolUse",
    phase: "started",
    toolName: "Bash",
  });
const bashDone = (startS: number, endS: number) =>
  claude("tool:1", "tool", "terminal.command", startS, endS, {
    hookEvent: "PostToolUse",
    phase: "completed",
    toolName: "Bash",
  });
const stop = (startS: number) => claude(`stop:${startS}`, "response", "response.completed", startS);

// Codex events: only `timestamp`, relative to run.startedAt.
function codex(
  id: string,
  category: RuntimeEvent["category"],
  action: string,
  startS: number,
  durationS?: number,
  metadata?: Record<string, unknown>,
): RuntimeEvent {
  return {
    id,
    traceId: "trace",
    timestamp: startS * 1000,
    ...(durationS === undefined ? {} : { durationMs: durationS * 1000 }),
    category,
    action,
    ...(metadata ? { metadata } : {}),
  };
}

const at = (seconds: number) => t0 + seconds * 1000;

describe("live activity (Claude)", () => {
  it("shows the running tool and counts from its start", () => {
    const events = [prompt(0), model(5), bashStarted(5)];
    expect(deriveLiveActivity(run(events), at(5), at(12))).toEqual({
      state: "running",
      label: "Running Bash",
      sinceMs: at(5),
    });
  });

  it("keeps a slow tool running and hints at an approval prompt after 30 s", () => {
    const events = [prompt(0), model(5), bashStarted(5)];
    expect(deriveLiveActivity(run(events), at(5), at(34))?.label).toBe("Running Bash");
    expect(deriveLiveActivity(run(events), at(5), at(35))).toEqual({
      state: "running",
      label: "Running Bash · may need your approval",
      sinceMs: at(5),
    });
  });

  it("uses the session file time when it is newer than the last event", () => {
    const events = [prompt(0), bashStarted(5)];
    expect(deriveLiveActivity(run(events), at(20), at(40))?.state).toBe("running");
  });

  it("is thinking after a tool result, from the result's time", () => {
    const events = [prompt(0), model(5), bashDone(5, 9)];
    expect(deriveLiveActivity(run(events), at(9), at(20))).toEqual({
      state: "thinking",
      label: "Thinking",
      sinceMs: at(9),
    });
  });

  it("is thinking after a prompt, and streamed model output does not reset the clock", () => {
    expect(deriveLiveActivity(run([prompt(0)]), at(0), at(3))).toEqual({
      state: "thinking",
      label: "Thinking",
      sinceMs: at(0),
    });
    expect(deriveLiveActivity(run([prompt(0), model(4)]), at(4), at(6))?.sinceMs).toBe(at(0));
  });

  it("is waiting for you after the turn ends", () => {
    const events = [prompt(0), bashDone(1, 3), model(8), stop(8)];
    expect(deriveLiveActivity(run(events), at(8), at(10))).toEqual({
      state: "waiting",
      label: "Waiting for you",
      sinceMs: at(8),
    });
  });

  it("ignores a tool that never got a result once a new prompt follows", () => {
    const events = [prompt(0), bashStarted(1), prompt(60)];
    expect(deriveLiveActivity(run(events), at(60), at(62))?.state).toBe("thinking");
  });

  it("stays running or thinking through long work, and only stalls after 10 minutes", () => {
    const tool = [prompt(0), bashStarted(5)];
    expect(deriveLiveActivity(run(tool), at(5), at(300))?.state).toBe("running");
    expect(deriveLiveActivity(run(tool), at(5), at(604))?.state).toBe("running");
    expect(deriveLiveActivity(run(tool), at(5), at(605))).toEqual({
      state: "idle",
      label: "No new activity",
      sinceMs: at(5),
    });
    const thinking = [prompt(0)];
    expect(deriveLiveActivity(run(thinking), at(0), at(300))?.state).toBe("thinking");
    expect(deriveLiveActivity(run(thinking), at(0), at(600))?.state).toBe("idle");
  });

  it("keeps waiting for you after a finished turn, however long", () => {
    const events = [prompt(0), stop(8)];
    expect(deriveLiveActivity(run(events), at(8), at(8 + 3_600))?.state).toBe("waiting");
  });

  it("returns undefined for an ended session or an empty run", () => {
    const ended = [prompt(0), stop(5), claude("end", "response", "session.ended", 6)];
    expect(deriveLiveActivity(run(ended), at(6), at(7))).toBeUndefined();
    expect(deriveLiveActivity(run([]), undefined, at(7))).toBeUndefined();
  });
});

describe("live activity (Codex)", () => {
  it("is thinking after a completed command, timed from its end", () => {
    const events = [
      codex("start", "agent", "agent.start", 0),
      codex("prompt", "prompt", "prompt.received", 0),
      codex("cmd", "tool", "terminal.command", 2, 3, { status: "completed" }),
      codex("model:r1", "model", "model.response", 6),
    ];
    expect(deriveLiveActivity(run(events), undefined, at(10))).toEqual({
      state: "thinking",
      label: "Thinking",
      sinceMs: at(5),
    });
  });

  it("shows a function call with nothing after it as running", () => {
    const events = [
      codex("prompt", "prompt", "prompt.received", 0),
      codex("call", "tool", "tool.call", 2, undefined, { name: "exec_command" }),
      codex("model:r1", "model", "model.response", 2),
    ];
    expect(deriveLiveActivity(run(events), undefined, at(10))).toEqual({
      state: "running",
      label: "Running exec_command",
      sinceMs: at(2),
    });
    expect(deriveLiveActivity(run(events), undefined, at(40))?.label).toBe(
      "Running exec_command · may need your approval",
    );
  });

  it("is waiting for you after task_complete or an aborted turn", () => {
    const done = [
      codex("prompt", "prompt", "prompt.received", 0),
      codex("task:end", "response", "response.completed", 0, 20),
    ];
    expect(deriveLiveActivity(run(done), undefined, at(25))).toEqual({
      state: "waiting",
      label: "Waiting for you",
      sinceMs: at(20),
    });
    const aborted = [
      codex("prompt", "prompt", "prompt.received", 0),
      codex("task:end", "error", "agent.aborted", 0, 4),
    ];
    expect(deriveLiveActivity(run(aborted), undefined, at(5))?.state).toBe("waiting");
  });

  it("stalls after 10 minutes mid-turn", () => {
    const events = [codex("prompt", "prompt", "prompt.received", 0)];
    expect(deriveLiveActivity(run(events), undefined, at(120))?.state).toBe("thinking");
    expect(deriveLiveActivity(run(events), undefined, at(600))?.state).toBe("idle");
  });
});

describe("formatElapsed", () => {
  it("formats minutes and hours", () => {
    expect(formatElapsed(-5)).toBe("0:00");
    expect(formatElapsed(7_900)).toBe("0:07");
    expect(formatElapsed(754_000)).toBe("12:34");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });
});
