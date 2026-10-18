import { discoverClaudeTranscripts } from "@visual-system/claude-adapter/transcript";
import { LocalRuntimeStore } from "@visual-system/telemetry-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stored, transcripts] = await Promise.all([
      new LocalRuntimeStore().list(),
      // Claude Code's own session files, read-only. No hooks or setup needed.
      discoverClaudeTranscripts().catch(() => []),
    ]);
    const known = new Set(stored.map((run) => `${run.source}:${run.id}`));
    const runs = [
      ...stored,
      ...transcripts
        .filter((session) => !known.has(`claude:${session.id}`))
        // The transcript path stays on the server.
        .map((session) =>
          Object.fromEntries(Object.entries(session).filter(([key]) => key !== "filePath")),
        ),
    ].sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
    return Response.json({ runs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to discover runtime runs." },
      { status: 500 },
    );
  }
}
