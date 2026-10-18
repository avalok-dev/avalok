import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { RuntimeSessionSummary, RuntimeSnapshot } from "@visual-system/runtime-adapter";
import { mergeRuntimeSnapshots } from "@visual-system/telemetry-adapter";
import { normalizeClaudeHook } from "./index.ts";

// Zero-setup Claude Code discovery. Claude Code already writes every session to
// `~/.claude/projects/<project>/<session-id>.jsonl`. Like the Codex adapter, this reads those files
// read-only: nothing is installed, nothing is written to Claude's directory, and no hook is needed.
// Each transcript record is translated into the same hook-shaped record the hook receiver
// accepts, so both paths produce identical events and a session observed both ways merges cleanly.

export interface ClaudeTranscriptSummary extends Omit<RuntimeSessionSummary, "eventCount"> {
  source: "claude";
  /** Unknown until the file is read; `null` is never mistaken for an empty session. */
  eventCount: number | null;
  /** The first thing the user asked, shortened, so sessions can be told apart in a list. */
  preview?: string;
  /** Absolute path of the transcript. Never sent to the browser. */
  filePath: string;
}

type Json = Record<string, unknown>;
const objectValue = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
const stringValue = (value: unknown) => (typeof value === "string" ? value : undefined);

// `home` is a parameter so Next's build-time file tracer cannot resolve this to the build
// machine's real `~/.claude` (same rule as the Codex adapter).
export function defaultClaudeProjectsDirectory(environment = process.env, home = homedir()) {
  const configured = environment.CLAUDE_CONFIG_DIR;
  return join(configured && configured.length > 0 ? configured : join(home, ".claude"), "projects");
}

/** A session is "active" when its transcript changed in the last two minutes. */
const activeWindowMs = 2 * 60_000;
/** Transcripts can start with very large records (pasted images); cap the metadata search. */
const metadataScanBytes = 4 * 1024 * 1024;
const maxTranscripts = 200;

async function readMetadata(filePath: string) {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(metadataScanBytes);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    let cwd: string | undefined;
    let sessionId: string | undefined;
    let startedAt: string | undefined;
    let preview: string | undefined;
    for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n").slice(0, 60)) {
      if (!line.startsWith("{")) continue;
      try {
        const record = JSON.parse(line) as Json;
        sessionId ??= stringValue(record.sessionId);
        startedAt ??= stringValue(record.timestamp);
        cwd ??= stringValue(record.cwd);
        if (!preview && record.type === "user" && record.isMeta !== true) {
          const text = textOf(objectValue(record.message)?.content).trim();
          if (text && !text.startsWith("<")) preview = text.replace(/\s+/g, " ").slice(0, 90);
        }
        if (cwd && sessionId && preview) break;
      } catch {
        // A line cut by the scan limit; later lines may still parse.
      }
    }
    return { cwd, sessionId, startedAt, preview };
  } finally {
    await file.close();
  }
}

export async function discoverClaudeTranscripts(
  directory = defaultClaudeProjectsDirectory(),
  now = Date.now(),
): Promise<ClaudeTranscriptSummary[]> {
  let projects: string[];
  try {
    projects = await readdir(directory);
  } catch {
    return [];
  }
  const files: { path: string; modifiedMs: number; birthMs: number }[] = [];
  await Promise.all(
    projects.map(async (project) => {
      let entries: string[];
      try {
        entries = await readdir(join(directory, project));
      } catch {
        return;
      }
      await Promise.all(
        entries
          .filter((name) => name.endsWith(".jsonl"))
          .map(async (name) => {
            const path = join(directory, project, name);
            try {
              const info = await stat(path);
              if (info.isFile() && info.size > 0)
                files.push({ path, modifiedMs: info.mtimeMs, birthMs: info.birthtimeMs });
            } catch {
              // Skipped; a vanishing file is not an error.
            }
          }),
      );
    }),
  );
  files.sort((left, right) => right.modifiedMs - left.modifiedMs);
  const summaries = await Promise.all(
    files.slice(0, maxTranscripts).map(async (file): Promise<ClaudeTranscriptSummary | null> => {
      try {
        const metadata = await readMetadata(file.path);
        const id = metadata.sessionId ?? basename(file.path, ".jsonl");
        const label = metadata.cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Claude Code";
        return {
          id,
          source: "claude",
          title: `${label} · Claude Code`,
          startedAt: metadata.startedAt ?? new Date(file.birthMs).toISOString(),
          modifiedAt: new Date(file.modifiedMs).toISOString(),
          status: now - file.modifiedMs < activeWindowMs ? "active" : "completed",
          eventCount: null,
          ...(metadata.preview ? { preview: metadata.preview } : {}),
          ...(metadata.cwd ? { cwd: metadata.cwd } : {}),
          filePath: file.path,
        };
      } catch {
        return null;
      }
    }),
  );
  return summaries.filter((summary): summary is ClaudeTranscriptSummary => summary !== null);
}

export async function resolveClaudeTranscript(
  id: string,
  directory = defaultClaudeProjectsDirectory(),
) {
  return (await discoverClaudeTranscripts(directory)).find((summary) => summary.id === id);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const item = objectValue(block);
      return item?.type === "text" ? (stringValue(item.text) ?? "") : "";
    })
    .filter(Boolean)
    .join("\n");
}

interface PendingTool {
  name: string;
  input: Json | undefined;
  startedMs: number;
}

/** Incrementally turns appended transcript lines into one merged runtime snapshot. */
export class ClaudeTranscriptTail {
  private offset = 0;
  private remainder = Buffer.alloc(0);
  private readonly tools = new Map<string, PendingTool>();
  private promptId: string | undefined;
  private snapshot: RuntimeSnapshot | undefined;

  constructor(
    private readonly summary: ClaudeTranscriptSummary,
    private readonly sessionId = summary.id,
  ) {}

  /** The hook-shaped records for one transcript record (zero or more). */
  translate(record: Json): Json[] {
    const base = {
      session_id: this.sessionId,
      ...(this.summary.cwd ? { cwd: this.summary.cwd } : {}),
      receivedAt: stringValue(record.timestamp),
    };
    const timestamp = Date.parse(stringValue(record.timestamp) ?? "") || Date.now();
    if (record.isSidechain === true) return [];
    const message = objectValue(record.message);
    const content = message?.content;
    const blocks = Array.isArray(content) ? content.map(objectValue) : [];

    if (record.type === "assistant") {
      const out: Json[] = [];
      for (const block of blocks) {
        if (block?.type !== "tool_use") continue;
        const id = stringValue(block.id);
        const name = stringValue(block.name);
        if (!id || !name) continue;
        const input = objectValue(block.input);
        this.tools.set(id, { name, input, startedMs: timestamp });
        out.push({
          ...base,
          hook_event_name: "PreToolUse",
          prompt_id: this.promptId,
          tool_name: name,
          tool_input: input,
          tool_use_id: id,
        });
      }
      if (message?.stop_reason === "end_turn")
        out.push({
          ...base,
          hook_event_name: "Stop",
          prompt_id: this.promptId,
          last_assistant_message: textOf(content),
        });
      return out;
    }

    if (record.type !== "user" || record.isMeta === true) return [];
    const results = blocks.filter((block) => block?.type === "tool_result");
    if (results.length > 0) {
      return results.flatMap((block): Json[] => {
        const id = stringValue(block?.tool_use_id);
        if (!id) return [];
        const pending = this.tools.get(id);
        const failed = block?.is_error === true;
        return [
          {
            ...base,
            hook_event_name: failed ? "PostToolUseFailure" : "PostToolUse",
            prompt_id: this.promptId,
            tool_name: pending?.name ?? "Unknown tool",
            tool_input: pending?.input,
            tool_use_id: id,
            ...(pending ? { duration_ms: Math.max(0, timestamp - pending.startedMs) } : {}),
            ...(failed ? { error: textOf(block?.content).slice(0, 500) } : {}),
          },
        ];
      });
    }
    const prompt = textOf(content).trim();
    if (!prompt || prompt.startsWith("<")) return [];
    this.promptId = stringValue(record.promptId) ?? String(timestamp);
    return [{ ...base, hook_event_name: "UserPromptSubmit", prompt_id: this.promptId, prompt }];
  }

  /** Reads what was appended since the last call. Returns the merged snapshot so far. */
  async poll(): Promise<RuntimeSnapshot | undefined> {
    const file = await open(this.summary.filePath, "r");
    try {
      const { size } = await file.stat();
      if (size < this.offset) {
        // The file was replaced or truncated: start over.
        this.offset = 0;
        this.remainder = Buffer.alloc(0);
        this.tools.clear();
        this.snapshot = undefined;
      }
      if (size > this.offset) {
        const chunk = Buffer.alloc(size - this.offset);
        const { bytesRead } = await file.read(chunk, 0, chunk.length, this.offset);
        this.offset += bytesRead;
        this.ingest(chunk.subarray(0, bytesRead));
      }
    } finally {
      await file.close();
    }
    // A session that has started but not yet said anything still opens, as an empty run.
    this.snapshot ??= this.withSummary(
      normalizeClaudeHook({
        session_id: this.sessionId,
        hook_event_name: "SessionStart",
        ...(this.summary.cwd ? { cwd: this.summary.cwd } : {}),
        receivedAt: this.summary.startedAt,
      }),
    );
    return this.snapshot;
  }

  private withSummary(snapshot: RuntimeSnapshot): RuntimeSnapshot {
    return {
      ...snapshot,
      session: {
        ...snapshot.session,
        id: this.summary.id,
        title: this.summary.title,
        modifiedAt: this.summary.modifiedAt,
        eventCount: snapshot.run.events.length,
        ...(this.summary.cwd ? { cwd: this.summary.cwd } : {}),
      },
    };
  }

  private ingest(chunk: Buffer) {
    const combined = Buffer.concat([this.remainder, chunk]);
    const snapshots: RuntimeSnapshot[] = [];
    let start = 0;
    for (let index = 0; index < combined.length; index += 1) {
      if (combined[index] !== 10) continue;
      const text = combined.subarray(start, index).toString("utf8").trim();
      start = index + 1;
      if (!text.startsWith("{")) continue;
      let record: Json;
      try {
        record = JSON.parse(text) as Json;
      } catch {
        continue;
      }
      for (const hook of this.translate(record)) {
        try {
          snapshots.push(normalizeClaudeHook(hook));
        } catch {
          // An unexpected record shape is skipped, never fatal.
        }
      }
    }
    this.remainder = combined.subarray(start);
    const added = mergePairwise(snapshots);
    if (!added) return;
    this.snapshot = this.withSummary(
      this.snapshot && this.snapshot.run.events.some((event) => event.action !== "SessionStart")
        ? mergeRuntimeSnapshots(this.snapshot, added)
        : added,
    );
  }
}

/** Balanced merge keeps the cost near n log n instead of n squared for long sessions. */
function mergePairwise(snapshots: RuntimeSnapshot[]): RuntimeSnapshot | undefined {
  let level = snapshots;
  while (level.length > 1) {
    const next: RuntimeSnapshot[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1];
      next.push(right ? mergeRuntimeSnapshots(left, right) : left);
    }
    level = next;
  }
  return level[0];
}

export async function loadClaudeTranscript(summary: ClaudeTranscriptSummary) {
  return new ClaudeTranscriptTail(summary).poll();
}
