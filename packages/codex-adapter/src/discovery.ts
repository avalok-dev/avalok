import { opendir, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { CodexSessionSummary, JsonlRecord } from "./types";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown) => (typeof value === "string" ? value : null);

async function collectJsonlFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    let entries;
    try {
      entries = await opendir(current);
    } catch {
      continue;
    }
    for await (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  }
  return files;
}

async function readMetadata(filePath: string) {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(128 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n").slice(0, 20);
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as JsonlRecord;
        if (record.type !== "session_meta" || !isObject(record.payload)) continue;
        return record.payload;
      } catch {
        // Discovery remains tolerant; full loading reports malformed records.
      }
    }
    return undefined;
  } finally {
    await file.close();
  }
}

// `home` is a parameter so Next's build-time file tracer cannot resolve this to the build
// machine's real `~/.codex` (see clearSarvadrikData in @visual-system/capabilities).
export function defaultCodexSessionsDirectory(environment = process.env, home = homedir()) {
  const codexHome =
    environment.AI_VISUALIZER_CODEX_HOME || environment.CODEX_HOME || join(home, ".codex");
  return join(codexHome, "sessions");
}

export async function discoverCodexSessions(
  directory = defaultCodexSessionsDirectory(),
): Promise<CodexSessionSummary[]> {
  const files = await collectJsonlFiles(directory);
  const summaries = await Promise.all(
    files.map(async (filePath): Promise<CodexSessionSummary | null> => {
      try {
        const [fileStat, metadata] = await Promise.all([stat(filePath), readMetadata(filePath)]);
        const fileName = basename(filePath);
        const fallbackId =
          fileName.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i)?.[1] ??
          fileName.replace(/\.jsonl$/, "");
        // `session_id` is shared by continued and forked files. `id` identifies
        // the concrete JSONL file and is therefore the safe selector key.
        const id = stringValue(metadata?.id) ?? stringValue(metadata?.session_id) ?? fallbackId;
        const startedAt = stringValue(metadata?.timestamp);
        return {
          id,
          fileName,
          filePath,
          startedAt,
          modifiedAt: fileStat.mtime.toISOString(),
          bytes: fileStat.size,
          lineCount: null,
          eventCount: null,
          cwd: stringValue(metadata?.cwd),
          originator: stringValue(metadata?.originator),
          cliVersion: stringValue(metadata?.cli_version),
          status: "unknown",
        };
      } catch {
        return null;
      }
    }),
  );
  return summaries
    .filter((summary): summary is CodexSessionSummary => summary !== null)
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

export async function resolveSessionById(
  sessionId: string,
  directory = defaultCodexSessionsDirectory(),
) {
  const sessions = await discoverCodexSessions(directory);
  return sessions.find((session) => session.id === sessionId);
}
