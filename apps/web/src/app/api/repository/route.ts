import { access, readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { analyzeRepository } from "@visual-system/analyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function currentRepositoryRoot() {
  let directory = process.cwd();
  const filesystemRoot = parse(directory).root;
  while (directory !== filesystemRoot) {
    const workspaceFile = join(directory, "pnpm-workspace.yaml");
    const packageFile = join(directory, "package.json");
    if ((await exists(workspaceFile)) && (await exists(packageFile))) {
      try {
        const manifest = JSON.parse(await readFile(packageFile, "utf8")) as { name?: unknown };
        if (manifest.name === "ai-system-visualizer") return directory;
      } catch {
        // Continue upward if an unrelated package manifest is malformed.
      }
    }
    directory = dirname(directory);
  }
  throw new Error("Unable to locate the local AgentMap repository root.");
}

export async function GET(request: Request) {
  try {
    const root = await currentRepositoryRoot();
    const parameters = new URL(request.url).searchParams;
    const force = parameters.get("rescan") === "1";
    const fixture = parameters.get("fixture");
    const allowedFixtures: Record<string, string> = {
      fastapi: join(root, "packages/analyzer/tests/fixtures/python-fastapi"),
      polyglot: join(root, "examples/polyglot-ai-platform"),
      terraform: join(root, "packages/analyzer/tests/fixtures/terraform-aws"),
      kubernetes: join(root, "packages/analyzer/tests/fixtures/kubernetes-app"),
      helm: join(root, "packages/analyzer/tests/fixtures/helm-app"),
      infrastructure: join(root, "examples/infrastructure-ai-platform"),
    };
    if (fixture && !allowedFixtures[fixture])
      return Response.json({ error: "Unknown repository fixture." }, { status: 404 });
    const analysis = await analyzeRepository(fixture ? allowedFixtures[fixture]! : root, { force });
    return Response.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to analyze the repository." },
      { status: 500 },
    );
  }
}
