import { analyzeRepository } from "@visual-system/analyzer";
import { agentMapDataPaths, buildCapabilityReport } from "@visual-system/capabilities";
import { targetRepositoryRoot } from "@/lib/repository-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const target = await targetRepositoryRoot();
    const analysis = await analyzeRepository(target);
    const port = Number(process.env.AGENTMAP_OTLP_PORT || 4318);
    const endpoint = `http://127.0.0.1:${port}`;
    const report = await buildCapabilityReport({
      analysis,
      target,
      endpoint,
      dataPaths: agentMapDataPaths(),
      ...(process.env.AGENTMAP_VERSION ? { version: process.env.AGENTMAP_VERSION } : {}),
    });
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Capability checks failed." },
      { status: 500 },
    );
  }
}
