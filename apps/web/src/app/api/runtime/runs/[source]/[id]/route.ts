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
  const snapshot = await new LocalRuntimeStore().load(source, id);
  if (!snapshot) return Response.json({ error: "Runtime run not found." }, { status: 404 });
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
