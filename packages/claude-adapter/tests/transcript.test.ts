import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClaudeTranscriptTail,
  defaultClaudeProjectsDirectory,
  discoverClaudeTranscripts,
  resolveClaudeTranscript,
} from "../src/transcript";

const line = (record: unknown) => `${JSON.stringify(record)}\n`;
const at = (second: number) => `2026-10-18T04:00:${String(second).padStart(2, "0")}.000Z`;

const prompt = {
  type: "user",
  sessionId: "sess-1",
  cwd: "/work/app",
  timestamp: at(0),
  promptId: "p1",
  message: { role: "user", content: "fix the bug" },
};
const toolUse = {
  type: "assistant",
  sessionId: "sess-1",
  timestamp: at(2),
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "pnpm test" } }],
  },
};
const toolResult = {
  type: "user",
  sessionId: "sess-1",
  timestamp: at(5),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
};
const answer = {
  type: "assistant",
  sessionId: "sess-1",
  timestamp: at(6),
  message: {
    role: "assistant",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Done." }],
  },
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "avalok-claude-"));
  await mkdir(join(root, "-work-app"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("Claude Code transcripts", () => {
  it("honours CLAUDE_CONFIG_DIR", () => {
    expect(defaultClaudeProjectsDirectory({ CLAUDE_CONFIG_DIR: "/c" }, "/home/x")).toBe(
      "/c/projects",
    );
    expect(defaultClaudeProjectsDirectory({}, "/home/x")).toBe("/home/x/.claude/projects");
  });

  it("discovers sessions without any setup, newest first, with their folder", async () => {
    await writeFile(
      join(root, "-work-app", "sess-1.jsonl"),
      line({ type: "queue-operation", sessionId: "sess-1" }) + line(prompt),
    );
    await writeFile(join(root, "-work-app", "empty.jsonl"), "");
    const sessions = await discoverClaudeTranscripts(root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: "sess-1", source: "claude", cwd: "/work/app" });
    expect(await resolveClaudeTranscript("missing", root)).toBeUndefined();
  });

  it("returns nothing when Claude Code has never run", async () => {
    expect(await discoverClaudeTranscripts(join(root, "nope"))).toEqual([]);
  });

  it("turns prompts, tool calls and answers into the same events hooks produce", async () => {
    const file = join(root, "-work-app", "sess-1.jsonl");
    await writeFile(file, [prompt, toolUse, toolResult, answer].map(line).join(""));
    const [summary] = await discoverClaudeTranscripts(root);
    const snapshot = await new ClaudeTranscriptTail(summary!).poll();
    const actions = snapshot!.run.events.map((event) => event.action);
    expect(actions).toEqual(["prompt.received", "terminal.test", "response.completed"]);
    expect(snapshot!.run.status).toBe("completed");
    expect(snapshot!.session.cwd).toBe("/work/app");
  });

  it("marks failed tools and follows appended lines incrementally", async () => {
    const file = join(root, "-work-app", "sess-1.jsonl");
    await writeFile(file, line(prompt) + line(toolUse));
    const [summary] = await discoverClaudeTranscripts(root);
    const tail = new ClaudeTranscriptTail(summary!);
    const first = await tail.poll();
    expect(first!.run.status).toBe("running");
    expect(await tail.poll()).toBe(first);
    await appendFile(
      file,
      line({
        ...toolResult,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "boom" }],
        },
      }),
    );
    const second = await tail.poll();
    expect(second).not.toBe(first);
    expect(second!.run.events.some((event) => event.category === "error")).toBe(true);
  });

  it("ignores half-written lines until they complete", async () => {
    const file = join(root, "-work-app", "sess-1.jsonl");
    const whole = line(prompt);
    await writeFile(file, whole.slice(0, 40));
    const [summary] = await discoverClaudeTranscripts(root);
    const tail = new ClaudeTranscriptTail(summary!);
    const empty = await tail.poll();
    expect(empty!.run.events.map((event) => event.action)).toEqual(["SessionStart"]);
    await appendFile(file, whole.slice(40));
    expect((await tail.poll())!.run.events.map((event) => event.action)).toEqual([
      "prompt.received",
    ]);
  });
});

describe("session preview", () => {
  it("shows what the user first asked, shortened, and skips injected context", async () => {
    await writeFile(
      join(root, "-work-app", "sess-1.jsonl"),
      line({
        type: "user",
        sessionId: "sess-1",
        cwd: "/work/app",
        isMeta: true,
        message: { role: "user", content: "meta" },
      }) +
        line({
          type: "user",
          sessionId: "sess-1",
          message: { role: "user", content: "<system-reminder>x</system-reminder>" },
        }) +
        line({
          ...prompt,
          message: {
            role: "user",
            content: [{ type: "text", text: "fix\nthe   bug ".repeat(30) }],
          },
        }),
    );
    const [summary] = await discoverClaudeTranscripts(root);
    expect(summary!.preview!.startsWith("fix the bug fix the bug")).toBe(true);
    expect(summary!.preview!.length).toBeLessThanOrEqual(90);
  });
});
