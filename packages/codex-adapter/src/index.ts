import { stat } from "node:fs/promises";
import { CodexNormalizer } from "./normalizer";
import { IncrementalJsonlReader } from "./jsonl";
import { defaultCodexSessionsDirectory, resolveSessionById } from "./discovery";
import type { CodexSessionData, CodexSessionSummary } from "./types";

export * from "./types";
export * from "./jsonl";
export { CodexNormalizer } from "./normalizer";
export {
  defaultCodexSessionsDirectory,
  discoverCodexSessions,
  resolveSessionById,
} from "./discovery";

export async function loadCodexSession(session: CodexSessionSummary): Promise<CodexSessionData> {
  const reader = new IncrementalJsonlReader();
  const batch = await reader.read(session.filePath);
  const normalizer = new CodexNormalizer(session);
  normalizer.addDiagnostics(batch.diagnostics);
  normalizer.ingest(batch.records);
  const result = normalizer.result();
  return {
    session: {
      ...session,
      lineCount: batch.records.length + batch.diagnostics.length,
      eventCount: result.run.events.length,
      status: result.run.status === "running" ? "active" : "completed",
    },
    architecture: result.architecture,
    run: result.run,
    rawEvents: result.rawEvents,
    diagnostics: result.diagnostics,
    cursor: batch.cursor,
  };
}

export async function loadCodexSessionById(
  sessionId: string,
  directory = defaultCodexSessionsDirectory(),
) {
  const session = await resolveSessionById(sessionId, directory);
  if (!session) return undefined;
  return loadCodexSession(session);
}

export async function refreshSessionSummary(session: CodexSessionSummary) {
  const fileStat = await stat(session.filePath);
  return { ...session, bytes: fileStat.size, modifiedAt: fileStat.mtime.toISOString() };
}
