import {
  loadClaudeTranscript,
  resolveClaudeTranscript,
} from "@visual-system/claude-adapter/transcript";
import type { RuntimeSourceKind } from "@visual-system/runtime-adapter";
import { LocalRuntimeStore } from "@visual-system/telemetry-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validSource = (value: string): value is RuntimeSourceKind =>
  value === "claude" || value === "telemetry";

export async function GET(
  _request: Request,
  context: { params: Promise<{ source: string; id: string }> },
) {
  const { source, id } = await context.params;
  if (!validSource(source)) return Response.json({ error: "Unsupported source." }, { status: 404 });
  // A Claude Code transcript is the complete record; hooks may have started midway.
  const transcript = source === "claude" ? await resolveClaudeTranscript(id) : undefined;
  const snapshot = transcript
    ? await loadClaudeTranscript(transcript)
    : await new LocalRuntimeStore().load(source, id);
  if (!snapshot) return Response.json({ error: "Runtime run not found." }, { status: 404 });
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
