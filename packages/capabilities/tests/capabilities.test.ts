import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RepositoryAnalysis } from "@visual-system/analyzer";
import {
  sarvadrikDataPaths,
  buildCapabilityReport,
  checkDataDirectoryWritable,
  clearSarvadrikData,
  executableAvailable,
  executableCandidates,
  readSarvadrikSettings,
  repositoryCapabilities,
  writeSarvadrikSettings,
} from "../src";

function analysis(): RepositoryAnalysis {
  return {
    repository: { name: "capability-fixture", rootPath: "/tmp/capability-fixture" },
    summary: {
      languages: [
        { language: "typescript", files: 2, bytes: 20, percentage: 67, analysis: "supported" },
        { language: "go", files: 1, bytes: 10, percentage: 33, analysis: "inventory-only" },
      ],
      applications: 1,
      services: 2,
      databases: 1,
      externalIntegrations: 1,
      architectureConfidence: "high",
      filesAnalyzed: 3,
    },
    metrics: {
      filesDiscovered: 3,
      filesParsed: 3,
      filesIgnored: 0,
      filesOversized: 0,
      packagesDiscovered: 1,
      importEdges: 1,
      architectureEntities: 5,
      architectureEdges: 4,
      unresolvedImports: 0,
      warnings: 0,
      durationMs: 1,
      cacheHit: false,
      servicesDiscovered: 2,
      languagesDetected: 2,
      dockerfilesParsed: 1,
      composeServices: 2,
      terraformFiles: 1,
      kubernetesDocuments: 2,
      helmCharts: 1,
      infrastructureResources: 4,
    },
    technologies: ["AWS"],
    graph: { id: "fixture", title: "fixture", entities: [], edges: [] },
    files: [],
    diagnostics: [],
    stages: ["complete"],
    partial: false,
    partialReasons: [],
    version: "test",
    fingerprint: "fingerprint",
    analyzedAt: new Date(0).toISOString(),
  } as RepositoryAnalysis;
}

const pathsFor = (root: string) => ({
  root,
  runtime: join(root, "runtime"),
  settings: join(root, "settings.json"),
});

describe("capability semantics", () => {
  it("keeps supported, detected, inventory-only, and configured infrastructure distinct", () => {
    const capabilities = repositoryCapabilities(analysis());
    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "language:typescript",
          support: "supported",
          detected: true,
        }),
        expect.objectContaining({ id: "language:go", support: "inventory-only", detected: true }),
        expect.objectContaining({
          id: "kubernetes",
          detail: expect.stringContaining("no live cluster"),
        }),
        expect.objectContaining({ id: "aws", detail: expect.stringContaining("no AWS account") }),
      ]),
    );
  });

  it.each([
    [0, "waiting"],
    [5, "observed"],
  ] as const)(
    "reports %s spans as %s while the receiver remains listening",
    async (spans, observation) => {
      const root = await mkdtemp(join(tmpdir(), "sarvadrik-capabilities-"));
      const report = await buildCapabilityReport({
        analysis: analysis(),
        target: root,
        endpoint: "http://127.0.0.1:4318",
        dataPaths: pathsFor(root),
        environment: { HOME: root, PATH: "", AI_VISUALIZER_CODEX_HOME: join(root, "codex") },
        fetchHealth: async () => ({ status: "ok", diagnostics: { spansReceived: spans } }),
      });
      expect(report.sources.find((source) => source.id === "telemetry")).toMatchObject({
        connection: "listening",
        observation,
        count: spans,
      });
      expect(report.telemetry.endpoint).toBe("http://127.0.0.1:4318/v1/traces");
    },
  );

  it("distinguishes Codex sessions from Codex not detected", async () => {
    const root = await mkdtemp(join(tmpdir(), "sarvadrik-codex-state-"));
    const codexHome = join(root, "codex");
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await writeFile(
      join(codexHome, "sessions", "session.jsonl"),
      `${JSON.stringify({ type: "session_meta", payload: { id: "session", timestamp: "2026-01-01T00:00:00.000Z" } })}\n`,
    );
    const present = await buildCapabilityReport({
      analysis: analysis(),
      target: root,
      endpoint: "http://127.0.0.1:4318",
      dataPaths: pathsFor(root),
      environment: { HOME: root, PATH: "", AI_VISUALIZER_CODEX_HOME: codexHome },
      fetchHealth: async () => ({ status: "ok", diagnostics: { spansReceived: 0 } }),
    });
    expect(present.sources.find((source) => source.id === "codex")).toMatchObject({
      availability: "available",
      observation: "observed",
      count: 1,
    });

    const absentRoot = await mkdtemp(join(tmpdir(), "sarvadrik-codex-absent-"));
    const absent = await buildCapabilityReport({
      analysis: analysis(),
      target: absentRoot,
      endpoint: "http://127.0.0.1:4318",
      dataPaths: pathsFor(absentRoot),
      environment: {
        HOME: absentRoot,
        PATH: "",
        AI_VISUALIZER_CODEX_HOME: join(absentRoot, "missing"),
      },
      fetchHealth: async () => ({ status: "ok", diagnostics: { spansReceived: 0 } }),
    });
    expect(absent.sources.find((source) => source.id === "codex")).toMatchObject({
      availability: "not-detected",
      observation: "waiting",
      count: 0,
    });
  });

  it("distinguishes Claude hook readiness from available but unconfigured", async () => {
    const root = await mkdtemp(join(tmpdir(), "sarvadrik-claude-state-"));
    await mkdir(join(root, ".claude"));
    await writeFile(
      join(root, ".claude", "settings.json"),
      JSON.stringify({ hooks: [{ url: "http://127.0.0.1:4318/v1/claude/hooks" }] }),
    );
    const configured = await buildCapabilityReport({
      analysis: analysis(),
      target: root,
      endpoint: "http://127.0.0.1:4318",
      dataPaths: pathsFor(root),
      environment: { HOME: root, PATH: "" },
      fetchHealth: async () => ({ status: "ok", diagnostics: { spansReceived: 0 } }),
    });
    expect(configured.sources.find((source) => source.id === "claude")).toMatchObject({
      availability: "available",
      connection: "listening",
      observation: "waiting",
    });
    await writeFile(join(root, ".claude", "settings.json"), "{}\n");
    const unconfigured = await buildCapabilityReport({
      analysis: analysis(),
      target: root,
      endpoint: "http://127.0.0.1:4318",
      dataPaths: pathsFor(root),
      environment: { HOME: root, PATH: "" },
      fetchHealth: async () => ({ status: "ok", diagnostics: { spansReceived: 0 } }),
    });
    expect(unconfigured.sources.find((source) => source.id === "claude")).toMatchObject({
      availability: "available",
      connection: "not-configured",
    });
  });
});

describe("Sarvadrik-owned data", () => {
  it("uses platform-appropriate roots", () => {
    expect(sarvadrikDataPaths({}, "darwin", "/Users/test").root).toBe(
      "/Users/test/Library/Application Support/Sarvadrik",
    );
    expect(sarvadrikDataPaths({}, "linux", "/home/test").root).toBe(
      "/home/test/.local/share/sarvadrik",
    );
    expect(sarvadrikDataPaths({ LOCALAPPDATA: "C:\\Local" }, "win32", "C:\\Users\\test")).toEqual({
      root: "C:\\Local\\Sarvadrik",
      runtime: "C:\\Local\\Sarvadrik\\runtime",
      settings: "C:\\Local\\Sarvadrik\\settings.json",
    });
    expect(sarvadrikDataPaths({}, "win32", "C:\\Users\\Test User").root).toBe(
      "C:\\Users\\Test User\\AppData\\Local\\Sarvadrik",
    );
    expect(sarvadrikDataPaths({ XDG_DATA_HOME: "/xdg/data" }, "linux", "/home/test").root).toBe(
      "/xdg/data/sarvadrik",
    );
    // Relative XDG paths are invalid per the XDG Base Directory specification.
    expect(sarvadrikDataPaths({ XDG_DATA_HOME: "relative" }, "linux", "/home/test").root).toBe(
      "/home/test/.local/share/sarvadrik",
    );
    expect(sarvadrikDataPaths({}, "darwin", "/Users/Test User").runtime).toBe(
      "/Users/Test User/Library/Application Support/Sarvadrik/runtime",
    );
  });

  it("persists the first-run preference outside the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "sarvadrik-settings-"));
    await writeSarvadrikSettings({ gettingStartedDismissed: true }, pathsFor(root));
    expect(await readSarvadrikSettings(pathsFor(root))).toEqual({ gettingStartedDismissed: true });
    await writeSarvadrikSettings({ gettingStartedDismissed: false }, pathsFor(root));
    expect(await readSarvadrikSettings(pathsFor(root))).toEqual({ gettingStartedDismissed: false });
  });

  it("clears only runtime and settings, leaving external targets untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "sarvadrik-clear-"));
    const external = await mkdtemp(join(tmpdir(), "sarvadrik-external-"));
    const paths = pathsFor(root);
    await mkdir(paths.runtime);
    await writeFile(join(paths.runtime, "run.json"), "{}\n");
    await writeFile(paths.settings, "{}\n");
    await writeFile(join(external, "codex-session.jsonl"), "keep\n");
    await symlink(external, join(root, "external-codex"));
    await clearSarvadrikData(paths);
    expect(await readFile(join(external, "codex-session.jsonl"), "utf8")).toBe("keep\n");
  });

  it("reports an invalid data root as unwritable", async () => {
    const root = await mkdtemp(join(tmpdir(), "sarvadrik-unwritable-"));
    const file = join(root, "file");
    await writeFile(file, "not a directory");
    expect(await checkDataDirectoryWritable(pathsFor(file))).toBe(false);
  });

  it("refuses broad home-directory clearing", async () => {
    await expect(clearSarvadrikData(pathsFor(homedir()))).rejects.toThrow("Refusing");
  });
});

describe("cross-platform executable discovery", () => {
  it("applies Windows PATH and PATHEXT rules without a shell", () => {
    expect(
      executableCandidates(
        "claude",
        {
          Path: "C:\\Program Files\\nodejs;C:\\Users\\Test User\\AppData\\Roaming\\npm",
          PATHEXT: ".EXE;.CMD",
        },
        "win32",
      ),
    ).toEqual([
      "C:\\Program Files\\nodejs\\claude",
      "C:\\Program Files\\nodejs\\claude.EXE",
      "C:\\Program Files\\nodejs\\claude.CMD",
      "C:\\Users\\Test User\\AppData\\Roaming\\npm\\claude",
      "C:\\Users\\Test User\\AppData\\Roaming\\npm\\claude.EXE",
      "C:\\Users\\Test User\\AppData\\Roaming\\npm\\claude.CMD",
    ]);
  });

  it("uses colon-separated POSIX PATH entries and finds executables in spaced directories", async () => {
    expect(executableCandidates("codex", { PATH: "/usr/bin::/opt/My Tools/bin" }, "linux")).toEqual(
      ["/usr/bin/codex", "/opt/My Tools/bin/codex"],
    );
    if (process.platform === "win32") return;
    const directory = await mkdtemp(join(tmpdir(), "sarvadrik path lookup "));
    await writeFile(join(directory, "codex"), "#!/bin/sh\n", { mode: 0o755 });
    expect(await executableAvailable("codex", { PATH: directory })).toBe(true);
    expect(await executableAvailable("missing", { PATH: directory })).toBe(false);
  });
});
