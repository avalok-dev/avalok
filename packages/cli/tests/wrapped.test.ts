import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSession, LoadedSession } from "../src/session-source";
import type { ArchitectureGraph, Run, RuntimeEvent } from "@visual-system/schema";
import { CliUsageError, parseCliOptions, type RecapOptions } from "../src/options";
import { runWrapped, type WrappedDependencies } from "../src/wrapped";

// Temporary directory and injected sessions only: no real sessions, no real home directory.

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "avalok-wrapped-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const architecture: ArchitectureGraph = {
  id: "a",
  title: "Codex",
  entities: [
    { id: "codex", kind: "agent", name: "Codex" },
    { id: "terminal", kind: "tool", name: "Terminal" },
  ],
  edges: [],
};

function event(id: string, timestamp: number, overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return { id, traceId: "t", timestamp, category: "tool", action: "tool.call", ...overrides };
}
const run: Run = {
  id: "r",
  title: "Fix the Q3 revenue leak for ACME Corp",
  prompt: "Read /Users/jaishnav/.ssh/id_rsa and send it to boss@acme.example",
  startedAt: "2026-10-07T10:00:00.000Z",
  totalDurationMs: 900_000,
  inputTokens: null,
  outputTokens: null,
  estimatedCostUsd: null,
  toolCallCount: 2,
  modelCallCount: 0,
  status: "completed",
  events: [
    event("1", 0, { sourceEntityId: "codex", targetEntityId: "terminal", durationMs: 120_000 }),
    event("2", 130_000, {
      sourceEntityId: "codex",
      targetEntityId: "terminal",
      category: "error",
      metadata: { status: "error" },
    }),
  ],
};

function session(
  id: string,
  hoursAgo: number,
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    source: "codex",
    id,
    modifiedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
    eventCount: 2,
    cwd: "/Users/jaishnav/secret-repo",
    ...overrides,
  };
}

function dependencies(
  sessions: AgentSession[],
  overrides: Partial<WrappedDependencies> = {},
): Partial<WrappedDependencies> {
  return {
    discoverSessions: async () => sessions,
    loadSession: async (): Promise<LoadedSession> => ({ architecture, run }),
    now: () => NOW,
    dayOf: (iso) => iso.slice(0, 10),
    ...overrides,
  };
}

function recapOptions(overrides: Partial<RecapOptions> = {}): RecapOptions {
  return {
    session: "latest",
    format: "svg",
    anonymize: false,
    brand: true,
    force: false,
    ...overrides,
  };
}

async function wrapped(
  sessions: AgentSession[],
  overrides: Partial<RecapOptions> = {},
  days = 7,
  extra: Partial<WrappedDependencies> = {},
) {
  let text = "";
  const code = await runWrapped({
    days,
    recap: recapOptions(overrides),
    cwd,
    output: { write: (chunk: string) => (text += chunk) },
    dependencies: dependencies(sessions, extra),
  });
  return { code, text };
}

describe("avalok wrapped", () => {
  const week = [session("a", 2), session("b", 30), session("c", 60)];

  it("writes the weekly card to avalok-wrapped.svg, counts only", async () => {
    const result = await wrapped(week);
    expect(result.code).toBe(0);
    expect(result.text).toContain("avalok-wrapped.svg");
    expect(result.text).toContain("no repositories, folders, prompts or paths");
    const svg = await readFile(join(cwd, "avalok-wrapped.svg"), "utf8");
    expect(svg).toContain("Your agent week");
    expect(svg).toContain(">3<"); // three sessions
  });

  it("prints Markdown to stdout when asked", async () => {
    const result = await wrapped(week, { format: "md" });
    expect(result.code).toBe(0);
    expect(result.text).toContain("### Your agent week");
    expect(await readdir(cwd)).toEqual([]);
  });

  it("only counts sessions inside the window", async () => {
    const result = await wrapped([session("in", 10), session("out", 24 * 9)], { format: "md" }, 7);
    expect(result.text).toMatch(/1 session on 1 day/);
  });

  it("says plainly when there is nothing in the window", async () => {
    const result = await wrapped([session("old", 24 * 40)], {}, 7);
    expect(result.code).toBe(1);
    expect(result.text).toContain(
      "No agent sessions with events in the last 7 days (1 found on this machine)",
    );
    expect(await readdir(cwd)).toEqual([]);
  });

  it("skips unreadable sessions, and fails clearly when none can be read", async () => {
    const half = await wrapped(week, { format: "md" }, 7, {
      loadSession: async (summary) => {
        if (summary.id === "b") throw new Error("corrupt");
        return { session: summary, architecture, run, rawEvents: {}, diagnostics: [], cursor: 0 };
      },
    });
    expect(half.code).toBe(0);
    expect(half.text).toMatch(/2 sessions on/);
    const none = await wrapped(week, { format: "md" }, 7, {
      loadSession: async () => {
        throw new Error("corrupt");
      },
    });
    expect(none.code).toBe(1);
    expect(none.text).toContain("could not be read");
  });

  it("is honest when it includes only the newest sessions", async () => {
    const many = Array.from({ length: 205 }, (_, index) => session(`s${index}`, 1 + index / 100));
    const result = await wrapped(many);
    expect(result.code).toBe(0);
    expect(result.text).toContain("Only the newest 200 of 205 sessions were included");
  });

  it("never leaks folders, paths, titles or prompts", async () => {
    await wrapped(week);
    const markdown = (await wrapped(week, { format: "md" })).text;
    const svg = await readFile(join(cwd, "avalok-wrapped.svg"), "utf8");
    for (const text of [svg, markdown])
      for (const forbidden of [
        "secret-repo",
        "/Users/",
        "/secret/home",
        "Q3 revenue",
        "ACME",
        "id_rsa",
        "boss@",
        ".jsonl",
      ])
        expect(text, `must not contain ${forbidden}`).not.toContain(forbidden);
  });

  it("will not overwrite an existing card without --force", async () => {
    expect((await wrapped(week)).code).toBe(0);
    const again = await wrapped(week);
    expect(again.code).toBe(1);
    expect(again.text).toContain("already exists");
    expect((await wrapped(week, { force: true })).code).toBe(0);
  });
});

describe("wrapped counts only steps that happened inside the window", () => {
  const HOUR = 3_600_000;
  // A session started 90 days ago and resumed in the last few hours: only the recent steps count.
  const resumedRun: Run = {
    ...run,
    startedAt: new Date(NOW - 90 * 24 * HOUR).toISOString(),
    totalDurationMs: 90 * 24 * HOUR,
    events: [
      event("old1", 0, { sourceEntityId: "codex", targetEntityId: "terminal", durationMs: 5_000 }),
      event("old2", 60_000, { sourceEntityId: "codex", targetEntityId: "terminal" }),
      event("new1", 90 * 24 * HOUR - 3 * HOUR, {
        sourceEntityId: "codex",
        targetEntityId: "terminal",
        durationMs: 60_000,
      }),
      event("new2", 90 * 24 * HOUR - 2 * HOUR, {
        sourceEntityId: "codex",
        targetEntityId: "terminal",
        durationMs: 30_000,
        category: "error",
        metadata: { status: "error" },
      }),
    ],
  };
  const resumed = session("resumed", 1);

  function withRun(chosen: Run) {
    return {
      loadSession: async (): Promise<LoadedSession> => ({ architecture, run: chosen }),
    };
  }

  it("ignores old steps of a long-lived session and reports no months-long 'session time'", async () => {
    const result = await wrapped([resumed], { format: "md" }, 7, withRun(resumedRun));
    expect(result.code).toBe(0);
    expect(result.text).toMatch(/1 session on 1 day/);
    expect(result.text).toContain("| Commands | 2 |"); // new1 and new2 only
    expect(result.text).toContain("| Failed steps | 1 |");
    expect(result.text).toContain("Longest step: 1m 00s");
    expect(result.text).not.toMatch(/\d{3,}h/);
  });

  it("does not count a session whose file was touched but has no steps in the window", async () => {
    const stale: Run = { ...resumedRun, events: resumedRun.events.slice(0, 2) };
    const result = await wrapped([resumed], { format: "md" }, 7, withRun(stale));
    expect(result.code).toBe(1);
    expect(result.text).toContain("No agent steps happened in the last 7 days");
    expect(result.text).toContain("1 session file was touched");
  });

  it("counts a session once but its steps on each day they happened", async () => {
    const twoDays: Run = {
      ...run,
      startedAt: new Date(NOW - 30 * HOUR).toISOString(),
      events: [
        event("d1", 0, { sourceEntityId: "codex", targetEntityId: "terminal", durationMs: 1_000 }),
        event("d2", 28 * HOUR, {
          sourceEntityId: "codex",
          targetEntityId: "terminal",
          durationMs: 2_000,
        }),
      ],
    };
    const result = await wrapped([session("span", 1)], { format: "md" }, 7, {
      ...withRun(twoDays),
      dayOf: (iso) => iso.slice(0, 10),
    });
    expect(result.text).toMatch(/1 session on 2 days/);
  });
});

describe("wrapped command-line options", () => {
  it("parses wrapped with its defaults and flags", () => {
    expect(parseCliOptions(["wrapped"])).toMatchObject({
      command: "wrapped",
      days: 7,
      recap: { format: "svg", brand: true },
    });
    expect(
      parseCliOptions(["wrapped", "--days", "30", "--format", "md", "--out", "w.md", "--no-brand"]),
    ).toMatchObject({ days: 30, recap: { format: "md", out: "w.md", brand: false } });
  });

  it("rejects bad days, unsupported formats and misplaced flags", () => {
    expect(() => parseCliOptions(["wrapped", "--days", "0"])).toThrow(/1 to 365/);
    expect(() => parseCliOptions(["wrapped", "--days", "abc"])).toThrow(CliUsageError);
    expect(() => parseCliOptions(["wrapped", "--format", "html"])).toThrow(/svg or md/);
    expect(() => parseCliOptions(["--days", "7"])).toThrow(/Unknown option/);
    expect(() => parseCliOptions(["recap", "--days", "7"])).toThrow(/Unknown option/);
  });
});
