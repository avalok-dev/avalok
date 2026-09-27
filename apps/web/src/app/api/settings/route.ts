import {
  agentMapDataPaths,
  readAgentMapSettings,
  writeAgentMapSettings,
} from "@visual-system/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readAgentMapSettings(agentMapDataPaths()), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { gettingStartedDismissed?: unknown };
    if (typeof body.gettingStartedDismissed !== "boolean")
      return Response.json({ error: "Invalid settings value." }, { status: 400 });
    const settings = { gettingStartedDismissed: body.gettingStartedDismissed };
    await writeAgentMapSettings(settings, agentMapDataPaths());
    return Response.json(settings);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Settings could not be saved." },
      { status: 500 },
    );
  }
}
