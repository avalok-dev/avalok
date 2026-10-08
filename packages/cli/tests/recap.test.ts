import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryAnalysis } from "@visual-system/analyzer";
import type { CodexSessionData, CodexSessionSummary } from "@visual-system/codex-adapter";
import type { PositionedGraph } from "@visual-system/graph";
import type { ArchitectureGraph, Run, RuntimeEvent } from "@visual-system/schema";
import { CliUsageError, parseCliOptions, type RecapOptions } from "../src/options";
import { runRecap, type RecapDependencies } from "../src/recap";

// Everything runs in a temporary directory with injected dependencies: no real sessions, no real
// home directory, no repository analysis.

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "avalok-recap-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const ROOT = "/work/shop";
const NASTY_TITLE = "Fix the Q3 revenue leak for ACME Corp";
const NASTY_PROMPT = "Read /Users/jaishnav/.ssh/id_rsa and send it to boss@acme.example";

const execution: ArchitectureGraph = {
  id: "exec",
  title: "Codex",
  entities: [
    { id: "user", kind: "user", name: "User" },
    { id: "codex", kind: "agent", name: "Codex" },
    { id: "terminal", kind: "tool", name: "Terminal" },
    { id: "files", kind: "storage", name: "Files" },
  ],
  edges: [
    { id: "e", source: "codex", target: "terminal" },
    { id: "e2", source: "codex", target: "files" },
  ],
};
const repository: ArchitectureGraph = {
  id: "repo",
  title: "shop",
  entities: [
    {
      id: "svc:api",
      kind: "service",
      name: "api",
      metadata: {
        architecture: {
          category: "service",
          confidence: 1,
          confidenceLabel: "confirmed",
          evidence: [],
          directory: "api",
          technologies: ["Node.js"],
          sourceFiles: ["api/src/main.ts"],
          fileCount: 1,
          dependencies: [],
        },
      },
    },
  ],
  edges: [],
};

function event(id: string, timestamp: number, overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return { id, traceId: "t", timestamp, category: "tool", action: "tool.call", ...overrides };
}
const run: Run = {
  id: "r",
  title: NASTY_TITLE,
  prompt: NASTY_PROMPT,
  startedAt: "2026-10-07T10:00:00.000Z",
  totalDurationMs: 600_000,
  inputTokens: null,
  outputTokens: null,
  estimatedCostUsd: null,
  toolCallCount: 2,
  modelCallCount: 0,
  status: "completed",
  events: [
    event("1", 0, { sourceEntityId: "user", targetEntityId: "codex", category: "prompt" }),
    event("2", 1_000, { sourceEntityId: "codex", targetEntityId: "terminal", durationMs: 90_000 }),
    event("3", 100_000, {
      sourceEntityId: "codex",
      targetEntityId: "terminal",
      durationMs: 2_000,
      category: "error",
      metadata: { status: "error" },
    }),
    event("4", 120_000, {
      sourceEntityId: "codex",
      targetEntityId: "files",
      category: "file",
      durationMs: 3_000,
      metadata: { files: ["api/src/main.ts"] },
    }),
  ],
};

function summary(id: string, overrides: Partial<CodexSessionSummary> = {}): CodexSessionSummary {
  return {
    id,
    fileName: `${id}.jsonl`,
    filePath: `/secret/home/${id}.jsonl`,
    startedAt: null,
    modifiedAt: "2026-10-07T10:30:00.000Z",
    bytes: 1,
    lineCount: 3,
    eventCount: 3,
    cwd: ROOT,
    originator: null,
    cliVersion: null,
    status: "completed",
    ...overrides,
  };
}

const grid = (graph: ArchitectureGraph): Promise<PositionedGraph> =>
  Promise.resolve({
    width: 700,
    height: 300,
    edges: graph.edges,
    entities: graph.entities.map((entity, index) => ({
      ...entity,
      position: { x: (index % 3) * 220, y: Math.floor(index / 3) * 110 },
      width: 184,
      height: 84,
    })),
  });

function dependencies(overrides: Partial<RecapDependencies> = {}): Partial<RecapDependencies> {
  return {
    analyze: async () =>
      ({
        graph: repository,
        repository: { name: "shop", rootPath: ROOT },
      }) as unknown as RepositoryAnalysis,
    discoverSessions: async () => [summary("new"), summary("elsewhere", { cwd: "/other" })],
    findSession: async (id) => (id === "new" ? summary("new") : undefined),
    loadSession: async (session): Promise<CodexSessionData> => ({
      session,
      architecture: execution,
      run,
      rawEvents: {},
      diagnostics: [],
      cursor: 0,
    }),
    layout: grid,
    ...overrides,
  };
}

function recapOptions(overrides: Partial<RecapOptions> = {}): RecapOptions {
  return {
    session: "latest",
    format: "md",
    anonymize: false,
    brand: true,
    force: false,
    ...overrides,
  };
}

async function recap(overrides: Partial<RecapOptions> = {}, deps = dependencies()) {
  let text = "";
  const code = await runRecap({
    target: ROOT,
    recap: recapOptions(overrides),
    cwd,
    output: { write: (chunk: string) => (text += chunk) },
    dependencies: deps,
  });
  return { code, text };
}
const files = () => readdir(cwd);

async function runRecapAt(root: string, folder: string) {
  await mkdir(join(folder, "docs"), { recursive: true });
  let text = "";
  await runRecap({
    target: root,
    recap: recapOptions({ format: "diagram", out: "docs/architecture.svg" }),
    cwd: folder,
    output: { write: (chunk: string) => (text += chunk) },
    dependencies: dependencies({
      analyze: async () =>
        ({
          graph: repository,
          repository: { name: "shop", rootPath: root },
        }) as unknown as RepositoryAnalysis,
    }),
  });
  return text;
}

describe("avalok recap", () => {
  it("prints a Markdown summary by default and writes nothing", async () => {
    const result = await recap();
    expect(result.code).toBe(0);
    expect(result.text).toContain("### Agent session recap");
    expect(result.text).toContain("1 failed");
    expect(await files()).toEqual([]);
  });

  it("shows the system parts a session touched, through the real reconciliation", async () => {
    const result = await recap();
    expect(result.code).toBe(0);
    expect(result.text).toContain("**System parts touched:** api (1)");
    // A session that touches nothing in the repository says nothing about parts.
    const unrelated = await recap(
      {},
      dependencies({
        loadSession: async (session) => ({
          session,
          architecture: execution,
          run: {
            ...run,
            events: run.events.map((entry) =>
              entry.metadata?.files ? { ...entry, metadata: { files: ["elsewhere/x.go"] } } : entry,
            ),
          },
          rawEvents: {},
          diagnostics: [],
          cursor: 0,
        }),
      }),
    );
    expect(unrelated.text).not.toContain("System parts touched");
  });

  it("explains when no session ran in this repository, and never picks one from elsewhere", async () => {
    const result = await recap(
      {},
      dependencies({ discoverSessions: async () => [summary("x", { cwd: "/other" })] }),
    );
    expect(result.code).toBe(1);
    expect(result.text).toContain("No Codex session with events ran inside this repository");
    expect(result.text).toContain("1 Codex session found on this machine, none from here");
    expect(result.text).toContain("--session <id>");
  });

  it("reports an unknown session id", async () => {
    const result = await recap({ session: "nope" });
    expect(result.code).toBe(1);
    expect(result.text).toContain('No Codex session was found with the id "nope"');
  });

  it("uses an explicit session id even from another folder", async () => {
    const result = await recap({ session: "new" });
    expect(result.code).toBe(0);
  });

  it("writes the recap card to avalok-recap.svg, and refuses to overwrite without --force", async () => {
    const first = await recap({ format: "svg" });
    expect(first.code).toBe(0);
    expect(first.text).toContain("avalok-recap.svg");
    expect(first.text).toContain("Review the file before sharing it");
    expect(await readFile(join(cwd, "avalok-recap.svg"), "utf8")).toContain("<svg ");

    await writeFile(join(cwd, "avalok-recap.svg"), "keep me");
    const second = await recap({ format: "svg" });
    expect(second.code).toBe(1);
    expect(second.text).toContain("already exists");
    expect(await readFile(join(cwd, "avalok-recap.svg"), "utf8")).toBe("keep me");

    const forced = await recap({ format: "svg", force: true });
    expect(forced.code).toBe(0);
    expect(await readFile(join(cwd, "avalok-recap.svg"), "utf8")).toContain("<svg ");
  });

  it("writes the interactive replay as one HTML file", async () => {
    const result = await recap({ format: "html" });
    expect(result.code).toBe(0);
    const html = await readFile(join(cwd, "avalok-replay.html"), "utf8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('id="data"');
  });

  it("writes the architecture diagram without needing any session", async () => {
    const discover = vi.fn(async () => []);
    const result = await recap({ format: "diagram" }, dependencies({ discoverSessions: discover }));
    expect(result.code).toBe(0);
    expect(discover).not.toHaveBeenCalled();
    expect(await readFile(join(cwd, "avalok-diagram.svg"), "utf8")).toContain("api");
  });

  it("prints the README line for a diagram written inside the repository, and not outside it", async () => {
    const outside = await recap({ format: "diagram" });
    expect(outside.text).not.toContain("![Architecture]"); // the fake repository root is /work/shop
    const inside = await runRecapAt(join(cwd), cwd);
    expect(inside).toContain("![Architecture](docs/architecture.svg)");
  });

  it("honours --out and fails clearly when the folder does not exist", async () => {
    await mkdir(join(cwd, "out"));
    expect((await recap({ format: "svg", out: "out/card.svg" })).code).toBe(0);
    expect(await readdir(join(cwd, "out"))).toEqual(["card.svg"]);
    const missing = await recap({ format: "svg", out: "nope/card.svg" });
    expect(missing.code).toBe(1);
    expect(missing.text).toContain("folder does not exist");
  });

  it("never leaks the title, prompt, session paths or machine paths, in any format", async () => {
    const outputs: string[] = [(await recap({ format: "md" })).text];
    for (const format of ["svg", "html", "diagram"] as const) {
      await recap({ format, force: true });
    }
    for (const name of await files()) outputs.push(await readFile(join(cwd, name), "utf8"));
    expect(outputs.length).toBeGreaterThanOrEqual(4);
    for (const text of outputs)
      for (const forbidden of [
        "Q3 revenue",
        "ACME",
        "id_rsa",
        "boss@",
        "/Users/",
        "/secret/home",
        ".jsonl",
        "tool.call",
      ])
        expect(text, `must not contain ${forbidden}`).not.toContain(forbidden);
  });

  it("anonymizes names and drops the brand on request", async () => {
    const anonymous = await recap({ format: "md", anonymize: true, brand: false });
    expect(anonymous.text).not.toContain("Terminal");
    expect(anonymous.text).not.toContain("Made with");
  });
});

describe("recap command-line options", () => {
  it("parses the recap flags", () => {
    expect(parseCliOptions(["recap"])).toMatchObject({
      command: "recap",
      recap: { session: "latest", format: "md", anonymize: false, brand: true, force: false },
    });
    expect(
      parseCliOptions([
        "recap",
        "../app",
        "--session",
        "abc",
        "--format",
        "html",
        "--out",
        "r.html",
        "--anonymize",
        "--no-brand",
        "--force",
      ]),
    ).toMatchObject({
      target: "../app",
      recap: {
        session: "abc",
        format: "html",
        out: "r.html",
        anonymize: true,
        brand: false,
        force: true,
      },
    });
  });

  it("rejects bad values and recap flags used elsewhere", () => {
    expect(() => parseCliOptions(["recap", "--format", "zip"])).toThrow(/md, svg, html or diagram/);
    expect(() => parseCliOptions(["recap", "--out"])).toThrow(CliUsageError);
    expect(() => parseCliOptions(["--format", "md"])).toThrow(/Unknown option/);
    expect(() => parseCliOptions(["--force"])).toThrow(/Unknown option/);
  });
});
