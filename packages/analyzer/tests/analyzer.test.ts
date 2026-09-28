import { access, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  analyzeCompose,
  analyzeDockerfiles,
  analyzeRepository,
  clearAnalysisCache,
  defaultAnalysisLimits,
  inventoryRepository,
} from "../src/index";

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
    // Whole-repository analysis while every package's suite runs in parallel: ~12s on 2-core
    // CI runners (under 1s alone), so give it headroom rather than a flaky limit.
  }, 60_000);

  it("detects a Next.js route and evidence-backed integrations", async () => {
    const analysis = await analyzeRepository(fixture("next-app"), { force: true });
    const names = analysis.graph.entities.map((entity) => entity.name);
    expect(names).toEqual(expect.arrayContaining(["Web Application", "OpenAI", "PostgreSQL"]));
    const web = analysis.graph.entities.find((entity) => entity.name === "Web Application");
    expect(web?.metadata?.architecture).toMatchObject({
      routes: [expect.objectContaining({ path: "/api/chat", methods: ["POST"] })],
    });
    expect(analysis.metrics.packagesDiscovered).toBe(1);
    expect(analysis.metrics.unresolvedImports).toBe(0);
  });

  it("parses Python imports, relative imports, FastAPI routes, environment names, and integrations", async () => {
    const analysis = await analyzeRepository(fixture("python-fastapi"), { force: true });
    const names = analysis.graph.entities.map((entity) => entity.name);
    expect(names).toEqual(expect.arrayContaining(["Backend API", "OpenAI", "PostgreSQL"]));
    const service = analysis.graph.entities.find((entity) => entity.name === "Backend API");
    expect(service?.provider).toBe("FastAPI");
    expect(service?.metadata?.architecture).toMatchObject({
      languages: ["python"],
      ports: [8000],
      routes: expect.arrayContaining([
        expect.objectContaining({ path: "/health", methods: ["GET"] }),
        expect.objectContaining({ path: "/chat", methods: ["POST"] }),
      ]),
    });
    expect(analysis.files.find((file) => file.path === "app/main.py")?.imports).toEqual(
      expect.arrayContaining(["fastapi", "openai", ".routes", ".db"]),
    );
    expect(analysis.metrics.unresolvedImports).toBe(0);
    expect(JSON.stringify(analysis)).toContain("OPENAI_API_KEY");
    expect(JSON.stringify(analysis)).toContain("DATABASE_URL");
    expect(JSON.stringify(analysis)).not.toContain("fixture-secret");
  });

  it("detects Anthropic usage and a meaningful literal external HTTP service", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentmap-python-integrations-"));
    await writeFile(
      join(root, "pyproject.toml"),
      [
        "[project]",
        'name = "integration-service"',
        'dependencies = ["anthropic>=1", "requests>=2"]',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(root, "main.py"),
      [
        "import anthropic",
        "import requests",
        "client = anthropic.Anthropic()",
        'response = requests.get("https://status.example.com/health")',
        "",
      ].join("\n"),
      "utf8",
    );
    const analysis = await analyzeRepository(root, { force: true });
    expect(analysis.graph.entities.map((entity) => entity.name)).toEqual(
      expect.arrayContaining(["Anthropic", "status.example.com"]),
    );
    expect(
      analysis.graph.entities.find((entity) => entity.name === "Anthropic")?.metadata?.architecture,
    ).toMatchObject({ confidenceLabel: expect.stringMatching(/medium|high|confirmed/) });
  });

  it("parses Dockerfile and Compose deployment evidence without retaining values", async () => {
    const { inventory } = await inventoryRepository(
      fixture("polyglot-platform"),
      defaultAnalysisLimits,
    );
    const diagnostics: import("../src/index").AnalysisDiagnostic[] = [];
    const dockerfiles = await analyzeDockerfiles(inventory, diagnostics);
    const compose = await analyzeCompose(inventory, diagnostics);
    expect(dockerfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "backend/Dockerfile",
          exposedPorts: [8000],
          command: expect.arrayContaining(["uvicorn", "app.main:app"]),
        }),
      ]),
    );
    expect(compose[0]?.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "api",
          buildContext: "backend",
          dependsOn: ["postgres", "redis"],
          environmentVariables: ["DATABASE_URL", "OPENAI_API_KEY"],
        }),
      ]),
    );
    expect(JSON.stringify({ dockerfiles, compose })).not.toContain("never-display");
    expect(diagnostics).toEqual([]);
  });

  it("recognizes Flask without treating its routes as top-level graph nodes", async () => {
    const analysis = await analyzeRepository(fixture("flask-app"), { force: true });
    const service = analysis.graph.entities.find((entity) => entity.provider === "Flask");
    expect(service?.name).toBe("Flask API");
    expect(service?.metadata?.architecture).toMatchObject({
      routes: [expect.objectContaining({ path: "/health", methods: ["GET"] })],
    });
    expect(analysis.graph.entities.some((entity) => entity.name === "/health")).toBe(false);
  });

  it("recognizes a basic Django project", async () => {
    const analysis = await analyzeRepository(fixture("django-app"), { force: true });
    expect(analysis.graph.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Django Application", provider: "Django" }),
      ]),
    );
    expect(analysis.files.find((file) => file.path === "project/urls.py")?.imports).toContain(
      "django.urls",
    );
  });

  it("understands a plain src-layout Python package and relative imports", async () => {
    const analysis = await analyzeRepository(fixture("python-package"), { force: true });
    expect(analysis.summary.languages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ language: "python", analysis: "supported" }),
      ]),
    );
    expect(analysis.files.find((file) => file.path.endsWith("__init__.py"))?.imports).toContain(
      ".maths",
    );
    expect(analysis.metrics.unresolvedImports).toBe(0);
  });

  it("builds a stable high-level polyglot Compose architecture without exposing values", async () => {
    const root = fixture("polyglot-platform");
    const first = await analyzeRepository(root, { force: true });
    const second = await analyzeRepository(root, { force: true });
    const names = first.graph.entities.map((entity) => entity.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Frontend",
        "Backend API",
        "Worker",
        "OpenAI",
        "PostgreSQL",
        "Redis",
      ]),
    );
    expect(names).not.toContain("api:8000");
    expect(first.graph.entities.length).toBeLessThanOrEqual(30);
    expect(first.graph.entities.map((entity) => entity.id)).toEqual(
      second.graph.entities.map((entity) => entity.id),
    );
    const frontend = first.graph.entities.find((entity) => entity.name === "Frontend")!;
    const backend = first.graph.entities.find((entity) => entity.name === "Backend API")!;
    const postgres = first.graph.entities.find((entity) => entity.name === "PostgreSQL")!;
    expect(first.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: frontend.id, target: backend.id, label: "calls" }),
        expect.objectContaining({ source: backend.id, target: postgres.id, label: "depends on" }),
      ]),
    );
    expect(first.metrics.composeServices).toBe(5);
    expect(first.metrics.servicesDiscovered).toBe(3);
    expect(JSON.stringify(first)).not.toContain("fixture-secret-never-display");
    expect(JSON.stringify(first)).not.toContain("never-display@postgres");
  });

  it("returns diagnostics for malformed Python and Compose instead of crashing", async () => {
    const analysis = await analyzeRepository(fixture("malformed"), { force: true });
    expect(analysis.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "manifest.invalid-pyproject",
        "manifest.requirements-invalid",
        "source.python-syntax",
        "compose.invalid",
      ]),
    );
  });

  it("reports unsupported languages honestly as inventory-only", async () => {
    const analysis = await analyzeRepository(fixture("unsupported-go"), { force: true });
    expect(analysis.summary.languages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ language: "go", analysis: "inventory-only" }),
      ]),
    );
    expect(analysis.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "language.inventory-only" })]),
    );
  });

  it("ignores Python environments and external symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentmap-python-safety-"));
    await writeFile(join(root, "requirements.txt"), "fastapi\n", "utf8");
    await writeFile(
      join(root, "main.py"),
      "from fastapi import FastAPI\napp = FastAPI()\n",
      "utf8",
    );
    await mkdir(join(root, ".venv", "site-packages"), { recursive: true });
    await writeFile(
      join(root, ".venv", "site-packages", "secret.py"),
      "TOKEN = 'hidden'\n",
      "utf8",
    );
    await symlink("/etc", join(root, "external"));
    const analysis = await analyzeRepository(root, { force: true });
    expect(analysis.files.some((file) => file.path.includes(".venv"))).toBe(false);
    expect(analysis.files.some((file) => file.path.startsWith("external/"))).toBe(false);
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

  it("keeps the architecture cache warm for documentation-only edits", async () => {
    clearAnalysisCache();
    const root = await mkdtemp(join(tmpdir(), "agentmap-doc-cache-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "doc-cache", type: "module" }),
      "utf8",
    );
    await writeFile(join(root, "index.ts"), "export const answer = 42;\n", "utf8");
    await writeFile(join(root, "README.md"), "# Before\n", "utf8");
    await analyzeRepository(root);
    await writeFile(join(root, "README.md"), "# After\n\nDocumentation changed.\n", "utf8");
    const cached = await analyzeRepository(root);
    expect(cached.metrics.cacheHit).toBe(true);
  });
});
