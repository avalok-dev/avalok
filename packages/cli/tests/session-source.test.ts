import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepositoryAnalysis } from "@visual-system/analyzer";
import { pickSessionForRepository } from "@visual-system/export";
import type { PositionedGraph } from "@visual-system/graph";
import type { ArchitectureGraph, Run, RuntimeEvent } from "@visual-system/schema";
import { LocalRuntimeStore } from "@visual-system/telemetry-adapter";
import type { RecapOptions } from "../src/options";
import { runRecap } from "../src/recap";
import {
  findSessionById,
  listAllSessions,
  loadAnySession,
  storedRunSessionSource,
  type AgentSession,
  type SessionSource,
} from "../src/session-source";
import { runWrapped } from "../src/wrapped";

// A real run store in a temporary directory, filled the way the collector fills it. No real home
// directory, no real Codex or Claude files.

type Snapshot = Parameters<LocalRuntimeStore["upsert"]>[0];

const ROOT = "/work/shop";
const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const SECRET_TITLE = "Rotate the ACME payroll keys";
const SECRET_PROMPT = "Read /Users/jaishnav/.ssh/id_rsa and mail it to boss@acme.example";

let directory: string;
let outputDirectory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "avalok-store-"));
  outputDirectory = await mkdtemp(join(tmpdir(), "avalok-out-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  await rm(outputDirectory, { recursive: true, force: true });
});

const architecture: ArchitectureGraph = {
  id: "exec",
  title: "Claude Code",
  entities: [
    { id: "user", kind: "user", name: "User" },
    { id: "claude", kind: "agent", name: "Claude Code" },
    { id: "terminal", kind: "tool", name: "Terminal" },
  ],
  edges: [{ id: "e", source: "claude", target: "terminal" }],
};

function event(id: string, timestamp: number, overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    id,
    traceId: "t",
    timestamp,
    category: "tool",
    action: "tool.call",
    sourceEntityId: "claude",
    targetEntityId: "terminal",
    ...overrides,
  };
}

function stored(
  source: "claude" | "telemetry",
  id: string,
  options: { cwd?: string; startedAt: string; steps?: number },
): Snapshot {
  const events = Array.from({ length: options.steps ?? 2 }, (_, index) =>
    event(`${id}-${index}`, index * 60_000, {
      durationMs: 30_000,
      metadata: { absoluteStartMs: Date.parse(options.startedAt) + index * 60_000 },
    }),
  );
  const run: Run = {
    id,
    title: SECRET_TITLE,
    prompt: SECRET_PROMPT,
    startedAt: options.startedAt,
    totalDurationMs: 120_000,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    toolCallCount: events.length,
    modelCallCount: 0,
    status: "completed",
    events,
  };
  return {
    source: {
      id: source,
      name: source,
      description: "",
      capabilities: {
        historical: true,
        live: true,
        tokens: false,
        cost: false,
        files: true,
        commands: true,
        mcp: false,
        models: false,
        rawEvents: false,
        architectureReconciliation: true,
      },
    },
    session: {
      id,
      source,
      title: SECRET_TITLE,
      startedAt: options.startedAt,
      modifiedAt: options.startedAt,
      status: "completed",
      eventCount: events.length,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    },
    architecture,
    run,
    rawEvents: {},
    diagnostics: [],
  };
}

async function fillStore() {
  const store = new LocalRuntimeStore(directory);
  await store.upsert(
    stored("claude", "claude-here", {
      cwd: ROOT,
      startedAt: "2026-10-07T10:00:00.000Z",
      steps: 3,
    }),
  );
  await store.upsert(
    stored("claude", "claude-elsewhere", { cwd: "/other", startedAt: "2026-10-07T11:00:00.000Z" }),
  );
  // An OpenTelemetry trace carries no folder; it is the newest of all.
  await store.upsert(stored("telemetry", "otlp-run", { startedAt: "2026-10-07T11:30:00.000Z" }));
  return store;
}

const codexSource = (sessions: AgentSession[]): SessionSource => ({
  handles: ["codex"],
  list: async () => sessions,
  find: async (id) => sessions.find((session) => session.id === id),
  load: async () => ({
    architecture: { ...architecture, entities: architecture.entities.slice(0, 3) },
    run: stored("claude", "codex-run", { startedAt: "2026-10-07T09:00:00.000Z" }).run,
  }),
});

describe("stored run source", () => {
  it("lists Claude Code and OpenTelemetry runs with their folder, and loads them", async () => {
    const source = storedRunSessionSource(await fillStore());
    const sessions = await source.list();
    expect(sessions.map((session) => [session.source, session.id, session.cwd])).toEqual(
      expect.arrayContaining([
        ["claude", "claude-here", ROOT],
        ["claude", "claude-elsewhere", "/other"],
        ["telemetry", "otlp-run", null],
      ]),
    );
    const loaded = await loadAnySession(
      [source],
      sessions.find((s) => s.id === "claude-here")!,
    );
    expect(loaded.run.events).toHaveLength(3);
    expect(loaded.architecture.entities.map((entity) => entity.id)).toContain("claude");
  });

  it("says so when a listed run disappears before it is loaded", async () => {
    const source = storedRunSessionSource(await fillStore());
    await expect(
      loadAnySession([source], {
        source: "claude",
        id: "gone",
        cwd: null,
        modifiedAt: "x",
        eventCount: 1,
      }),
    ).rejects.toThrow("no longer available");
  });

  it("an empty or missing store is just no sessions", async () => {
    const missing = storedRunSessionSource(new LocalRuntimeStore(join(directory, "nothing")));
    expect(await missing.list()).toEqual([]);
  });
});

describe("Claude Code transcripts as a source", () => {
  it("lists and loads Claude Code's own session files when given their directory", async () => {
    const projects = join(directory, "claude-projects");
    await mkdir(join(projects, "-work-shop"), { recursive: true });
    const records = [
      {
        type: "user",
        sessionId: "from-file",
        cwd: ROOT,
        timestamp: "2026-10-07T11:00:00.000Z",
        promptId: "p",
        message: { role: "user", content: "add a cart" },
      },
      {
        type: "assistant",
        sessionId: "from-file",
        timestamp: "2026-10-07T11:00:03.000Z",
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Done" }],
        },
      },
    ];
    await writeFile(
      join(projects, "-work-shop", "from-file.jsonl"),
      records.map((record) => `${JSON.stringify(record)}\n`).join(""),
    );
    const store = await fillStore();
    const without = await storedRunSessionSource(store).list();
    expect(without.some((session) => session.id === "from-file")).toBe(false);
    const source = storedRunSessionSource(store, projects);
    const found = (await source.list()).find((session) => session.id === "from-file");
    expect(found).toMatchObject({ source: "claude", cwd: ROOT });
    const loaded = await source.load(found!);
    expect(loaded.run.events.map((event) => event.action)).toEqual([
      "prompt.received",
      "response.completed",
    ]);
  });
});

describe("combined sessions", () => {
  it("merges every source newest first and skips a source that fails", async () => {
    const codex: AgentSession = {
      source: "codex",
      id: "codex-newest",
      cwd: ROOT,
      modifiedAt: "2026-10-07T11:45:00.000Z",
      eventCount: null,
    };
    const broken: SessionSource = {
      handles: ["codex"],
      list: async () => Promise.reject(new Error("unreadable")),
      find: async () => undefined,
      load: async () => Promise.reject(new Error("unreadable")),
    };
    const sources = [codexSource([codex]), broken, storedRunSessionSource(await fillStore())];
    const all = await listAllSessions(sources);
    expect(all.map((session) => session.id)).toEqual([
      "codex-newest",
      "otlp-run",
      "claude-elsewhere",
      "claude-here",
    ]);
  });

  it("finds an id in any source, and a source prefix breaks a tie", async () => {
    const sources = [
      codexSource([
        {
          source: "codex",
          id: "shared",
          cwd: ROOT,
          modifiedAt: "2026-10-07T08:00:00.000Z",
          eventCount: 1,
        },
      ]),
      storedRunSessionSource(
        await (async () => {
          const store = await fillStore();
          await store.upsert(
            stored("claude", "shared", { cwd: ROOT, startedAt: "2026-10-07T10:30:00.000Z" }),
          );
          return store;
        })(),
      ),
    ];
    expect((await findSessionById(sources, "shared"))?.source).toBe("claude");
    expect((await findSessionById(sources, "codex:shared"))?.source).toBe("codex");
    expect(await findSessionById(sources, "claude:otlp-run")).toBeUndefined();
    expect((await findSessionById(sources, "otlp-run"))?.source).toBe("telemetry");
    expect(await findSessionById(sources, "nope")).toBeUndefined();
  });

  it("the CLI and the dashboard pick the same latest session", async () => {
    // Both call pickSessionForRepository on the combined list; the OpenTelemetry trace has no
    // folder, so it is never chosen even though it is the newest.
    const all = await listAllSessions([storedRunSessionSource(await fillStore())]);
    expect(pickSessionForRepository(ROOT, all)?.id).toBe("claude-here");
    expect(pickSessionForRepository("/nowhere", all)).toBeUndefined();
  });
});

const grid = (graph: ArchitectureGraph): Promise<PositionedGraph> =>
  Promise.resolve({
    width: 700,
    height: 300,
    edges: graph.edges,
    entities: graph.entities.map((entity, index) => ({
      ...entity,
      position: { x: index * 220, y: 0 },
      width: 184,
      height: 84,
    })),
  });

const analysis = {
  graph: { id: "repo", title: "shop", entities: [], edges: [] },
  repository: { name: "shop", rootPath: ROOT },
} as unknown as RepositoryAnalysis;

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

async function recap(overrides: Partial<RecapOptions>, sources: SessionSource[]) {
  let text = "";
  const code = await runRecap({
    target: ROOT,
    recap: recapOptions(overrides),
    cwd: outputDirectory,
    output: { write: (chunk: string) => (text += chunk) },
    dependencies: {
      analyze: async () => analysis,
      discoverSessions: () => listAllSessions(sources),
      findSession: (id) => findSessionById(sources, id),
      loadSession: (session) => loadAnySession(sources, session),
      layout: grid,
    },
  });
  return { code, text };
}

describe("recap from stored runs", () => {
  it("recaps the newest Claude Code run from this repository, not the newer trace without a folder", async () => {
    const sources = [codexSource([]), storedRunSessionSource(await fillStore())];
    const result = await recap({}, sources);
    expect(result.code).toBe(0);
    expect(result.text).toContain("Avalok");
    // The chosen run has three steps; the newer trace and the other folder's run have two.
    expect(result.text).toContain("3 steps observed");
  });

  it("recaps an OpenTelemetry trace only when it is named", async () => {
    const sources = [storedRunSessionSource(await fillStore())];
    expect((await recap({ session: "otlp-run" }, sources)).code).toBe(0);
    expect((await recap({ session: "claude:otlp-run" }, sources)).code).toBe(1);
  });

  it("explains that traces without a folder need --session", async () => {
    const store = new LocalRuntimeStore(directory);
    await store.upsert(stored("telemetry", "only-otlp", { startedAt: "2026-10-07T11:30:00.000Z" }));
    const result = await recap({}, [storedRunSessionSource(store)]);
    expect(result.code).toBe(1);
    expect(result.text).toContain("did not record a folder");
    expect(result.text).toContain("--session <id>");
  });

  it("leaks no title, prompt, home path or machine path through any format", async () => {
    const sources = [storedRunSessionSource(await fillStore())];
    for (const format of ["md", "svg", "html", "diagram"] as const) {
      const result = await recap({ format, out: join(outputDirectory, `out-${format}`) }, sources);
      expect(result.code).toBe(0);
      const written =
        format === "md"
          ? result.text
          : `${result.text}${await readFile(join(outputDirectory, `out-${format}`), "utf8")}`;
      for (const secret of [
        SECRET_TITLE,
        "ACME",
        "id_rsa",
        "/Users/jaishnav",
        "boss@acme",
        directory,
      ])
        expect(written, `${format} contains ${secret}`).not.toContain(secret);
    }
  });

  it("reports a stored run that cannot be read instead of crashing", async () => {
    const store = await fillStore();
    const source = storedRunSessionSource(store);
    const broken: SessionSource = {
      ...source,
      load: async () => Promise.reject(new Error("The stored run is no longer available.")),
    };
    const result = await recap({}, [broken]);
    expect(result.code).toBe(1);
    expect(result.text).toContain("Claude Code session could not be read");
  });
});

describe("wrapped from stored runs", () => {
  it("counts Claude Code and OpenTelemetry runs next to Codex sessions, once each", async () => {
    const store = await fillStore();
    const sources = [
      codexSource([
        {
          source: "codex",
          id: "claude-here", // same id as a stored run: still two different sessions
          cwd: ROOT,
          modifiedAt: "2026-10-07T09:30:00.000Z",
          eventCount: 1,
        },
      ]),
      storedRunSessionSource(store),
    ];
    let text = "";
    const code = await runWrapped({
      days: 7,
      recap: recapOptions({ format: "md" }),
      cwd: outputDirectory,
      output: { write: (chunk: string) => (text += chunk) },
      dependencies: {
        discoverSessions: () => listAllSessions(sources),
        loadSession: (session) => loadAnySession(sources, session),
        now: () => NOW,
        dayOf: (iso) => iso.slice(0, 10),
      },
    });
    expect(code).toBe(0);
    // codex (2 steps) + claude-here (3) + claude-elsewhere (2) + otlp-run (2)
    expect(text).toContain("4 sessions on 1 day");
    expect(text).toContain("Busiest day: Oct 7 (9 steps)");
    for (const secret of [SECRET_TITLE, "ACME", "id_rsa", "/Users/jaishnav", ROOT, "/other"])
      expect(text, `wrapped contains ${secret}`).not.toContain(secret);
  });
});
