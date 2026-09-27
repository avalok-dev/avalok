import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import type {
  RuntimeSessionSummary,
  RuntimeSnapshot,
  RuntimeSourceKind,
} from "@visual-system/runtime-adapter";
import type { ArchitectureGraph, Run, RuntimeEvent } from "@visual-system/schema";

function repositoryRoot(start = process.cwd()) {
  let directory = start;
  const root = parse(directory).root;
  while (directory !== root) {
    if (
      existsSync(join(directory, "pnpm-workspace.yaml")) &&
      existsSync(join(directory, "package.json"))
    )
      return directory;
    directory = dirname(directory);
  }
  return start;
}

export function defaultRuntimeDataDirectory() {
  return process.env.AGENTMAP_DATA_DIR || join(repositoryRoot(), ".agentmap", "runtime");
}

const snapshotKey = (source: RuntimeSourceKind, id: string) =>
  createHash("sha256").update(`${source}\0${id}`).digest("hex");

const absoluteStart = (event: RuntimeEvent, fallback: number) =>
  typeof event.metadata?.absoluteStartMs === "number"
    ? event.metadata.absoluteStartMs
    : fallback + event.timestamp;

function mergeGraphs(previous: ArchitectureGraph, current: ArchitectureGraph): ArchitectureGraph {
  return {
    ...current,
    entities: [
      ...new Map(
        [...previous.entities, ...current.entities].map((item) => [item.id, item]),
      ).values(),
    ],
    edges: [
      ...new Map([...previous.edges, ...current.edges].map((item) => [item.id, item])).values(),
    ],
  };
}

export function mergeRuntimeSnapshots(
  previous: RuntimeSnapshot,
  current: RuntimeSnapshot,
): RuntimeSnapshot {
  const previousStart = Date.parse(previous.run.startedAt);
  const currentStart = Date.parse(current.run.startedAt);
  const eventsById = new Map(
    [...previous.run.events, ...current.run.events].map((event) => [event.id, event]),
  );
  const origin = Math.min(
    ...[...eventsById.values()].map((event) =>
      absoluteStart(event, event.id in current.rawEvents ? currentStart : previousStart),
    ),
  );
  const events = [...eventsById.values()]
    .map((event) => ({
      ...event,
      timestamp: Math.max(0, absoluteStart(event, previousStart) - origin),
    }))
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
  const end = Math.max(
    origin,
    ...events.map((event) => {
      const absolute =
        typeof event.metadata?.absoluteEndMs === "number"
          ? event.metadata.absoluteEndMs
          : origin + event.timestamp + (event.durationMs ?? 0);
      return absolute;
    }),
  );
  const input = events.reduce(
    (total, event) =>
      total + (typeof event.metadata?.inputTokens === "number" ? event.metadata.inputTokens : 0),
    0,
  );
  const output = events.reduce(
    (total, event) =>
      total + (typeof event.metadata?.outputTokens === "number" ? event.metadata.outputTokens : 0),
    0,
  );
  const run: Run = {
    ...previous.run,
    ...current.run,
    startedAt: new Date(origin).toISOString(),
    endedAt: current.run.status === "running" ? undefined : new Date(end).toISOString(),
    totalDurationMs: Math.max(0, end - origin),
    inputTokens: input > 0 ? input : null,
    outputTokens: output > 0 ? output : null,
    toolCallCount: events.filter((event) =>
      ["tool", "mcp", "retrieval", "database", "web", "file"].includes(event.category),
    ).length,
    modelCallCount: events.filter((event) => event.category === "model").length,
    status: events.some((event) => event.category === "error") ? "error" : current.run.status,
    events,
  };
  return {
    ...current,
    architecture: mergeGraphs(previous.architecture, current.architecture),
    run,
    session: {
      ...previous.session,
      ...current.session,
      startedAt: run.startedAt,
      modifiedAt: new Date().toISOString(),
      status: run.status === "running" || run.status === "queued" ? "active" : run.status,
      eventCount: events.length,
    },
    rawEvents: { ...previous.rawEvents, ...current.rawEvents },
    diagnostics: [...previous.diagnostics, ...current.diagnostics].slice(-200),
  };
}

export class LocalRuntimeStore {
  private queue = Promise.resolve();
  readonly directory: string;

  constructor(directory = defaultRuntimeDataDirectory()) {
    this.directory = directory;
  }

  private path(source: RuntimeSourceKind, id: string) {
    return join(this.directory, `${source}-${snapshotKey(source, id)}.json`);
  }

  async load(source: RuntimeSourceKind, id: string) {
    try {
      return JSON.parse(await readFile(this.path(source, id), "utf8")) as RuntimeSnapshot;
    } catch {
      return undefined;
    }
  }

  async upsert(incoming: RuntimeSnapshot): Promise<RuntimeSnapshot> {
    let result = incoming;
    this.queue = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const existing = await this.load(incoming.source.id, incoming.session.id);
      result = existing ? mergeRuntimeSnapshots(existing, incoming) : incoming;
      const target = this.path(result.source.id, result.session.id);
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(result)}\n`, { mode: 0o600 });
      await rename(temporary, target);
    });
    await this.queue;
    return result;
  }

  async list(source?: RuntimeSourceKind): Promise<RuntimeSessionSummary[]> {
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch {
      return [];
    }
    const summaries: RuntimeSessionSummary[] = [];
    for (const file of files) {
      if (!file.endsWith(".json") || (source && !file.startsWith(`${source}-`))) continue;
      try {
        const snapshot = JSON.parse(
          await readFile(join(this.directory, file), "utf8"),
        ) as RuntimeSnapshot;
        if (!source || snapshot.source.id === source) summaries.push(snapshot.session);
      } catch {
        // A corrupt local file is skipped; collector diagnostics report write failures.
      }
    }
    return summaries.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  }
}
