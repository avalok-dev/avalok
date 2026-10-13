import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { normalizeClaudeHook } from "../src";

describe("Claude Code hook adapter", () => {
  it("normalizes prompts, files, commands, MCP, errors, and responses", async () => {
    const records = JSON.parse(
      await readFile(new URL("./fixtures/hooks.json", import.meta.url), "utf8"),
    ) as unknown[];
    const snapshots = records.map((record) => normalizeClaudeHook(record));
    expect(snapshots.map((snapshot) => snapshot.run.events[0]?.category)).toEqual([
      "agent",
      "prompt",
      "file",
      "file",
      "tool",
      "error",
      "response",
    ]);
    expect(snapshots[2]?.run.events[0]?.metadata?.file).toBe("/workspace/example/README.md");
    expect(snapshots[3]?.run.events[0]?.metadata?.fileOperations).toEqual([
      { path: "/workspace/example/harmless-note.txt", operation: "create" },
    ]);
    expect(snapshots[4]?.run.events[0]?.metadata?.command).toBe("pwd");
    expect(JSON.stringify(snapshots[5]?.rawEvents)).not.toContain("fake-secret");
    expect(snapshots[6]?.run.status).toBe("completed");
  });

  it("rejects partial and malformed records defensively", () => {
    expect(() => normalizeClaudeHook(null)).toThrow("JSON object");
    expect(() => normalizeClaudeHook({ session_id: "only" })).toThrow("missing");
  });

  it("keeps unsupported hook events observable without crashing", () => {
    const snapshot = normalizeClaudeHook(
      { session_id: "s", hook_event_name: "FutureEvent" },
      1_000,
    );
    expect(snapshot.diagnostics[0]?.code).toBe("hook.unsupported");
    expect(snapshot.run.events).toHaveLength(1);
  });
});

describe("Claude Code test commands", () => {
  const bash = (command: string) =>
    normalizeClaudeHook({
      session_id: "s",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "t",
      tool_input: { command },
    }).run.events[0];

  it("routes test commands to the Tests entity", () => {
    for (const command of [
      "pnpm test",
      "npm run test -- --watch",
      "cd app && pytest -q",
      "go test ./...",
    ]) {
      expect(bash(command)).toMatchObject({ targetEntityId: "tests", action: "terminal.test" });
    }
  });

  it("leaves ordinary commands on the Terminal entity", () => {
    for (const command of ["pwd", "pnpm build", "git status"]) {
      expect(bash(command)).toMatchObject({
        targetEntityId: "terminal",
        action: "terminal.command",
      });
    }
  });
});
