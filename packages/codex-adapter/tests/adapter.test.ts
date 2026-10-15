import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CodexNormalizer,
  IncrementalJsonlReader,
  discoverCodexSessions,
  loadCodexSession,
  type CodexSessionSummary,
  type JsonlRecord,
} from "../src/index";

const temporaryDirectories: string[] = [];

async function fixtureDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "codex-adapter-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const summary = (filePath: string): CodexSessionSummary => ({
  id: "session-1",
  fileName: "session.jsonl",
  filePath,
  startedAt: "2026-01-01T00:00:00.000Z",
  modifiedAt: "2026-01-01T00:00:02.000Z",
  bytes: 0,
  lineCount: null,
  eventCount: null,
  cwd: "/work/example",
  originator: "codex_cli",
  cliVersion: "1.0.0",
  status: "unknown",
});

const record = (value: JsonlRecord, line = 1) => ({ record: value, line });

describe("Codex session discovery", () => {
  it("finds nested JSONL sessions and reads actual metadata", async () => {
    const root = await fixtureDirectory();
    const nested = join(root, "2026", "01", "01");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(nested, "rollout-test.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: {
          id: "real-id",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: "/work/example",
          originator: "codex_cli",
          cli_version: "1.2.3",
        },
      })}\n`,
    );

    const sessions = await discoverCodexSessions(root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: "real-id", cwd: "/work/example" });
  });
});

describe("JSONL parsing", () => {
  it("keeps partial lines until a newline arrives", () => {
    const reader = new IncrementalJsonlReader();
    expect(reader.consume('{"type":"event_').records).toHaveLength(0);
    const batch = reader.consume('msg"}\n');
    expect(batch.records[0]?.record.type).toBe("event_msg");
    expect(batch.diagnostics).toHaveLength(0);
  });

  it("advances an incremental cursor without rereading prior records", async () => {
    const root = await fixtureDirectory();
    const path = join(root, "session.jsonl");
    await writeFile(path, '{"type":"one"}\n');
    const reader = new IncrementalJsonlReader();
    const first = await reader.read(path);
    await writeFile(path, '{"type":"one"}\n{"type":"two"}\n');
    const second = await reader.read(path);
    expect(first.records.map(({ record: item }) => item.type)).toEqual(["one"]);
    expect(second.records.map(({ record: item }) => item.type)).toEqual(["two"]);
    expect(second.cursor).toBeGreaterThan(first.cursor);
  });

  it("reports malformed records and continues", () => {
    const reader = new IncrementalJsonlReader();
    const batch = reader.consume('{broken}\n{"type":"ok"}\n');
    expect(batch.records).toHaveLength(1);
    expect(batch.diagnostics[0]?.code).toBe("jsonl.malformed");
  });
});

describe("Codex normalization", () => {
  it("normalizes commands, file changes, errors, MCP tools, and cumulative tokens", () => {
    const normalizer = new CodexNormalizer(summary("/tmp/session.jsonl"));
    normalizer.ingest([
      record({
        type: "turn_context",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: { model: "gpt-test" },
      }),
      record(
        {
          type: "event_msg",
          timestamp: "2026-01-01T00:00:00.100Z",
          payload: {
            type: "item_completed",
            item: { type: "UserMessage", id: "u1", content: [{ text: "Build it" }] },
          },
        },
        2,
      ),
      record(
        {
          type: "event_msg",
          timestamp: "2026-01-01T00:00:01.000Z",
          payload: {
            type: "item_completed",
            item: {
              type: "CommandExecution",
              id: "c1",
              command: ["zsh", "-lc", "pnpm test"],
              status: "failed",
              exit_code: 1,
              duration: { secs: 0, nanos: 500_000_000 },
            },
          },
        },
        3,
      ),
      record(
        {
          type: "event_msg",
          timestamp: "2026-01-01T00:00:01.200Z",
          payload: {
            type: "item_completed",
            item: { type: "FileChange", id: "f1", status: "completed", changes: { "/a.ts": {} } },
          },
        },
        4,
      ),
      record(
        {
          type: "event_msg",
          timestamp: "2026-01-01T00:00:01.500Z",
          payload: {
            type: "item_completed",
            item: {
              type: "McpToolCall",
              id: "m1",
              server: "github",
              tool: "read",
              status: "completed",
              arguments: {},
            },
          },
        },
        5,
      ),
      record(
        {
          type: "token_usage_record",
          timestamp: "2026-01-01T00:00:02.000Z",
          payload: {
            response_id: "r1",
            thread_token_usage: { input_tokens: 12, output_tokens: 7 },
          },
        },
        6,
      ),
    ]);

    const result = normalizer.result();
    expect(result.run).toMatchObject({
      inputTokens: 12,
      outputTokens: 7,
      toolCallCount: 3,
      modelCallCount: 1,
    });
    expect(result.run.events.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "prompt.received",
        "terminal.test",
        "files.changed",
        "mcp.tool_call",
        "model.response",
      ]),
    );
    expect(result.run.events.find((event) => event.id === "c1")).toMatchObject({
      category: "error",
      durationMs: 500,
    });
    expect(result.run.events.find((event) => event.id === "f1")?.metadata).toMatchObject({
      fileOperations: [{ path: "/a.ts", operation: "edit" }],
    });
    expect(result.architecture.entities.map((entity) => entity.id)).toEqual(
      expect.arrayContaining(["user", "codex", "tests", "files", "mcp:github", "model"]),
    );
  });

  it("uses stable IDs and deduplicates repeated completed items", () => {
    const normalizer = new CodexNormalizer(summary("/tmp/session.jsonl"));
    const item = record({
      type: "event_msg",
      timestamp: "2026-01-01T00:00:01.000Z",
      payload: {
        type: "item_completed",
        item: { type: "FileChange", id: "same", status: "completed", changes: {} },
      },
    });
    normalizer.ingest([item, item]);
    const result = normalizer.result();
    expect(result.run.events.filter((event) => event.id === "same")).toHaveLength(1);
    expect(new Set(result.architecture.entities.map((entity) => entity.id)).size).toBe(
      result.architecture.entities.length,
    );
  });

  it("normalizes the message-only event variant without exposing reasoning", () => {
    const normalizer = new CodexNormalizer(summary("/tmp/session.jsonl"));
    normalizer.ingest([
      record({
        type: "event_msg",
        ordinal: 1,
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: { type: "user_message", message: "Inspect this project" },
      }),
      record({
        type: "event_msg",
        ordinal: 2,
        timestamp: "2026-01-01T00:00:00.100Z",
        payload: { type: "agent_reasoning", message: "private reasoning" },
      }),
      record({
        type: "event_msg",
        ordinal: 3,
        timestamp: "2026-01-01T00:00:00.200Z",
        payload: { type: "agent_message", message: "Visible answer", phase: "final_answer" },
      }),
    ]);
    const result = normalizer.result();
    expect(result.run.prompt).toBe("Inspect this project");
    expect(result.run.events.map((event) => event.action)).toEqual([
      "prompt.received",
      "response.message",
    ]);
    expect(JSON.stringify(result.rawEvents)).not.toContain("private reasoning");
  });

  it("reports unsupported record types without failing", () => {
    const normalizer = new CodexNormalizer(summary("/tmp/session.jsonl"));
    normalizer.ingest([record({ type: "future_record", timestamp: "2026-01-01T00:00:00.000Z" })]);
    expect(normalizer.result().diagnostics[0]?.code).toBe("record.unsupported");
  });
});

describe("read-only local behavior", () => {
  it("loads a session without network access or changing its bytes", async () => {
    const root = await fixtureDirectory();
    const path = join(root, "session.jsonl");
    const body = `${JSON.stringify({ type: "session_meta", timestamp: "2026-01-01T00:00:00.000Z", payload: { id: "session-1" } })}\n`;
    await writeFile(path, body);
    const network = vi.fn(() => Promise.reject(new Error("network must not be used")));
    vi.stubGlobal("fetch", network);
    const before = await readFile(path, "utf8");
    await loadCodexSession(summary(path));
    const after = await readFile(path, "utf8");
    expect(network).not.toHaveBeenCalled();
    expect(after).toBe(before);
  });
});
