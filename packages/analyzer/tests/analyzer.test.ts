import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { analyzeRepository, clearAnalysisCache } from "../src/index";

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

describe("repository analyzer", () => {
  it("discovers the AgentMap workspace without repository-specific analyzer rules", async () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    const analysis = await analyzeRepository(root, { force: true });
    const names = analysis.graph.entities.map((entity) => entity.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Web Application",
        "Graph Engine",
        "Replay Engine",
        "Schema",
        "UI Components",
        "Codex Adapter",
        "Repository Analyzer",
        "Reconciliation",
      ]),
    );
    expect(analysis.metrics.packagesDiscovered).toBeGreaterThanOrEqual(8);
    if (process.env.REPORT_ANALYSIS === "1") {
      console.info(
        JSON.stringify(
          {
            metrics: analysis.metrics,
            entities: names,
            technologies: analysis.technologies,
            diagnostics: analysis.diagnostics,
          },
          null,
          2,
        ),
      );
    }
  });

  it("detects a Next.js route and evidence-backed integrations", async () => {
    const analysis = await analyzeRepository(fixture("next-app"), { force: true });
    const names = analysis.graph.entities.map((entity) => entity.name);
    expect(names).toEqual(
      expect.arrayContaining(["Web Application", "/api/chat", "OpenAI", "PostgreSQL"]),
    );
    const route = analysis.graph.entities.find((entity) => entity.name === "/api/chat");
    expect(route?.metadata?.architecture).toMatchObject({ confidenceLabel: "confirmed" });
    expect(JSON.stringify(route?.metadata?.architecture)).toContain("route convention");
    expect(analysis.metrics.packagesDiscovered).toBe(1);
    expect(analysis.metrics.unresolvedImports).toBe(0);
  });

  it("builds a useful graph for a generic TypeScript package", async () => {
    const analysis = await analyzeRepository(fixture("typescript-package"), { force: true });
    expect(analysis.graph.entities).toHaveLength(1);
    expect(analysis.graph.entities[0]?.name).toBe("Core");
    expect(analysis.metrics.importEdges).toBe(1);
    expect(analysis.files.find((file) => file.path === "src/index.ts")?.exports).toContain("add");
  });

  it("returns partial results when limits are reached", async () => {
    const analysis = await analyzeRepository(fixture("next-app"), {
      force: true,
      limits: { maxFiles: 2 },
    });
    expect(analysis.partial).toBe(true);
    expect(analysis.partialReasons[0]).toContain("File limit reached");
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "limit.files")).toBe(true);
  });

  it("uses an inventory fingerprint cache without executing scripts, writing, or networking", async () => {
    clearAnalysisCache();
    const root = fixture("typescript-package");
    const beforeFiles = await readdir(root);
    const beforePackage = await readFile(`${root}/package.json`, "utf8");
    const network = vi.fn(() => Promise.reject(new Error("network must not be used")));
    vi.stubGlobal("fetch", network);
    await analyzeRepository(root);
    const cached = await analyzeRepository(root);
    expect(cached.metrics.cacheHit).toBe(true);
    expect(network).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(beforeFiles);
    expect(await readFile(`${root}/package.json`, "utf8")).toBe(beforePackage);
    await expect(access(`${root}/SHOULD_NOT_EXIST`)).rejects.toThrow();
  });
});
