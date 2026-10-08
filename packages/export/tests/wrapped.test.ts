import { describe, expect, it } from "vitest";
import {
  periodLabel,
  renderWrappedMarkdown,
  renderWrappedSvg,
  shortDay,
  summarizeWrapped,
  type SessionRecap,
  type WrappedInput,
} from "../src";

function recap(overrides: Partial<SessionRecap> = {}): SessionRecap {
  return {
    status: "completed",
    durationMs: 600_000,
    steps: 100,
    stepTimeMs: 320_000,
    longestStepMs: 120_000,
    toolCalls: 60,
    modelCalls: 30,
    failures: 2,
    retries: 0,
    slowSteps: 1,
    commands: 40,
    fileOperations: 10,
    testRuns: 3,
    inputTokens: null,
    outputTokens: null,
    whereTimeWent: [
      {
        id: "terminal",
        label: "Terminal",
        kind: "tool",
        steps: 40,
        timeMs: 300_000,
        slowSteps: 1,
        failures: 2,
      },
      {
        id: "m",
        label: "/Users/jaishnav/secret/internal-mcp",
        kind: "mcp_server",
        steps: 5,
        timeMs: 20_000,
        slowSteps: 0,
        failures: 0,
      },
    ],
    architectureTouched: [],
    unavailable: [],
    ...overrides,
  };
}

const inputs: WrappedInput[] = [
  { sessionId: "a", day: "2026-10-05", recap: recap() },
  {
    sessionId: "b",
    day: "2026-10-05",
    recap: recap({ steps: 250, stepTimeMs: 3_600_000, longestStepMs: 900_000, commands: 90 }),
  },
  // Session "a" continues on a later day: one session, two active days.
  { sessionId: "a", day: "2026-10-07", recap: recap({ steps: 50, failures: 0, slowSteps: 0 }) },
];

describe("summarizeWrapped", () => {
  const stats = summarizeWrapped(inputs);

  it("adds up what was observed", () => {
    expect(stats).toMatchObject({
      sessions: 2,
      activeDays: 2,
      firstDay: "2026-10-05",
      lastDay: "2026-10-07",
      steps: 400,
      commands: 170,
      fileOperations: 30,
      testRuns: 9,
      failures: 4,
      slowSteps: 2,
      longestStepMs: 900_000,
      stepTimeMs: 4_240_000,
    });
  });

  it("finds the busiest day by steps", () => {
    expect(stats.busiestDay).toEqual({ day: "2026-10-05", sessions: 2, steps: 350 });
    expect(stats.sessions).toBe(2); // a session spanning two days is counted once
  });

  it("aggregates where the time went and passes tool names through the privacy filter", () => {
    expect(stats.tools[0]).toMatchObject({ label: "Terminal", timeMs: 900_000 });
    expect(stats.tools.map((tool) => tool.label)).toContain("internal-mcp");
    expect(JSON.stringify(stats)).not.toContain("/Users/");
  });

  it("handles an empty week without inventing anything", () => {
    const empty = summarizeWrapped([]);
    expect(empty).toMatchObject({ sessions: 0, busiestDay: null, firstDay: null, tools: [] });
    expect(periodLabel(empty)).toBe("No sessions");
    expect(renderWrappedSvg(empty)).toContain("<svg ");
  });
});

describe("wrapped output", () => {
  const stats = summarizeWrapped(inputs);

  it("formats days and periods", () => {
    expect(shortDay("2026-10-07")).toBe("Oct 7");
    expect(periodLabel(stats)).toBe("Oct 5 – Oct 7");
    expect(periodLabel(summarizeWrapped([inputs[0]!]))).toBe("Oct 5");
  });

  it("is counts and timings only: no folders, paths, prompts or titles", () => {
    for (const text of [renderWrappedSvg(stats), renderWrappedMarkdown(stats)]) {
      expect(text).not.toContain("/Users/");
      expect(text).not.toContain("jaishnav");
      expect(text).not.toContain("secret");
    }
    expect(renderWrappedSvg(stats)).not.toMatch(/<script|href=|<image/i);
    expect(renderWrappedSvg(stats)).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);
  });

  it("reads correctly for one session and for many", () => {
    const one = renderWrappedSvg(summarizeWrapped([inputs[0]!]));
    expect(one).toContain(">session<");
    expect(renderWrappedSvg(stats)).toContain(">sessions<");
  });

  it("shows the brand by default and omits it on request", () => {
    expect(renderWrappedSvg(stats)).toContain("Made with Avalok");
    expect(renderWrappedSvg(stats, { brand: false })).not.toContain("Made with Avalok");
    expect(renderWrappedMarkdown(stats, { brand: false })).not.toContain("Avalok](");
  });

  it("golden card and summary", async () => {
    await expect(renderWrappedSvg(stats)).toMatchFileSnapshot("./snapshots/wrapped.svg");
    await expect(renderWrappedMarkdown(stats)).toMatchFileSnapshot("./snapshots/wrapped.md");
  });
});
