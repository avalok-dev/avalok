import { LocalRuntimeStore } from "@visual-system/telemetry-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runs = await new LocalRuntimeStore().list();
    return Response.json({ runs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to discover runtime runs." },
      { status: 500 },
    );
  }
}
