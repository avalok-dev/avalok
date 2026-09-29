import {
  sarvadrikDataPaths,
  readSarvadrikSettings,
  writeSarvadrikSettings,
} from "@visual-system/capabilities";
import { readJsonBody, RequestBodyError } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readSarvadrikSettings(sarvadrikDataPaths()), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request, 16 * 1024)) as {
      gettingStartedDismissed?: unknown;
    } | null;
    if (typeof body?.gettingStartedDismissed !== "boolean")
      return Response.json({ error: "Invalid settings value." }, { status: 400 });
    const settings = { gettingStartedDismissed: body.gettingStartedDismissed };
    await writeSarvadrikSettings(settings, sarvadrikDataPaths());
    return Response.json(settings);
  } catch (error) {
    if (error instanceof RequestBodyError)
      return Response.json({ error: error.message }, { status: error.status });
    return Response.json(
      { error: error instanceof Error ? error.message : "Settings could not be saved." },
      { status: 500 },
    );
  }
}
