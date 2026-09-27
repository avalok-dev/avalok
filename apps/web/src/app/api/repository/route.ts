import { analyzeRepository } from "@visual-system/analyzer";
import {
  isSampleRepository,
  sampleRepositoryPath,
  targetRepositoryRoot,
} from "@/lib/repository-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    const force = parameters.get("rescan") === "1";
    const fixture = parameters.get("fixture");
    if (fixture !== null && !isSampleRepository(fixture))
      return Response.json({ error: "Unknown repository fixture." }, { status: 404 });
    const target = fixture ? await sampleRepositoryPath(fixture) : await targetRepositoryRoot();
    const analysis = await analyzeRepository(target, { force });
    return Response.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to analyze the repository." },
      { status: 500 },
    );
  }
}
