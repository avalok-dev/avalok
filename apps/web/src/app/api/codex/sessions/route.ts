import { discoverCodexSessions } from "@visual-system/codex-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = await discoverCodexSessions();
    return Response.json({
      sessions: sessions.map((session) =>
        Object.fromEntries(Object.entries(session).filter(([key]) => key !== "filePath")),
      ),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to discover Codex sessions." },
      { status: 500 },
    );
  }
}
