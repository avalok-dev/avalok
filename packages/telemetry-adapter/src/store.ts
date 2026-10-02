import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import type {
  RuntimeSessionSummary,
  RuntimeSnapshot,
  RuntimeSourceKind,
} from "@visual-system/runtime-adapter";
import type { ArchitectureGraph, Run, RuntimeEvent } from "@visual-system/schema";
import { aggregateRunObservability } from "./observability.ts";

export interface PlatformDirectoryNames {
  /** `%LOCALAPPDATA%\<windows>` */
  windows: string;
  /** `~/Library/Application Support/<darwin>` */
  darwin: string;
  /** `$XDG_DATA_HOME/<linux>` or `~/.local/share/<linux>` */
  linux: string;
}

export const sarvadrikDirectoryNames: PlatformDirectoryNames = {
  windows: "Sarvadrik",
  darwin: "Sarvadrik",
  linux: "sarvadrik",
};

/** Where development builds named AgentMap (M7.2–M7.4A) kept data; a migration source only. */
export const legacyAgentMapDirectoryNames: PlatformDirectoryNames = {
  windows: "AgentMap",
  darwin: "AgentMap",
  linux: "agentmap",
};

/**
 * The platform user-data directory for `names`, using the target platform's path semantics so
 * the rules are exact (and unit-testable) regardless of the host running them.
 */
export function platformDataRoot(
  names: PlatformDirectoryNames,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
) {
  if (platform === "win32") {
    const local = environment.LOCALAPPDATA;
    return win32.join(
      local && win32.isAbsolute(local) ? local : win32.join(home, "AppData", "Local"),
      names.windows,
    );
  }
  if (platform === "darwin")
    return posix.join(home, "Library", "Application Support", names.darwin);
  // XDG Base Directory: a relative XDG_DATA_HOME is invalid and must be ignored.
  const xdg = environment.XDG_DATA_HOME;
  return posix.join(
    xdg && posix.isAbsolute(xdg) ? xdg : posix.join(home, ".local", "share"),
    names.linux,
  );
}

export function defaultSarvadrikDataRoot(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
) {
  const configured = environment.SARVADRIK_DATA_ROOT ?? environment.SARVADRIK_DATA_DIR;
  if (configured) return resolve(configured);
  return platformDataRoot(sarvadrikDirectoryNames, environment, platform, home);
}

export function defaultRuntimeDataDirectory(environment: NodeJS.ProcessEnv = process.env) {
  return join(defaultSarvadrikDataRoot(environment), "runtime");
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
  const eventsById = new Map(previous.run.events.map((event) => [event.id, event]));
  for (const event of current.run.events) {
    const old = eventsById.get(event.id);
    const oldEnd = old?.metadata?.absoluteEndMs;
    const newEnd = event.metadata?.absoluteEndMs;
    const preferOldStatus = old?.metadata?.status === "error" && event.metadata?.status !== "error";
    eventsById.set(
      event.id,
      old
        ? {
            ...old,
            ...event,
            category: preferOldStatus ? old.category : event.category,
            action: preferOldStatus ? old.action : event.action,
            durationMs:
              typeof oldEnd === "number" && typeof newEnd === "number" && oldEnd > newEnd
                ? old.durationMs
                : event.durationMs,
            sourceEntityId: event.sourceEntityId ?? old.sourceEntityId,
            metadata: {
              ...old.metadata,
              ...event.metadata,
              ...(["inputTokens", "outputTokens"] as const).reduce<Record<string, number>>(
                (kept, key) => {
                  const prior = old.metadata?.[key];
                  const latest = event.metadata?.[key];
                  if (typeof prior === "number" && typeof latest === "number" && prior > latest)
                    kept[key] = prior;
                  return kept;
                },
                {},
              ),
              ...(preferOldStatus ? { status: "error" } : {}),
              ...(typeof oldEnd === "number" && typeof newEnd === "number" && oldEnd > newEnd
                ? { absoluteEndMs: oldEnd }
                : {}),
            },
          }
        : event,
    );
  }
  // Imported child spans can precede their parents in a partial export.
  const parentTargets = new Map(
    [...eventsById.values()]
      .filter((event) => event.spanId && event.targetEntityId)
      .map((event) => [event.spanId!, event.targetEntityId!]),
  );
  for (const [id, event] of eventsById) {
    if (event.metadata?.imported !== true || !event.parentSpanId) continue;
    const sourceEntityId = parentTargets.get(event.parentSpanId);
    if (sourceEntityId && sourceEntityId !== event.sourceEntityId)
      eventsById.set(id, { ...event, sourceEntityId });
  }
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
  const observed = aggregateRunObservability({ ...current.run, events });
  const run: Run = {
    ...previous.run,
    ...current.run,
    startedAt: new Date(origin).toISOString(),
    endedAt: current.run.status === "running" ? undefined : new Date(end).toISOString(),
    totalDurationMs: Math.max(0, end - origin),
    inputTokens: events.some((event) => event.metadata?.imported === true)
      ? observed.run.inputTokens
      : input > 0
        ? input
        : null,
    outputTokens: events.some((event) => event.metadata?.imported === true)
      ? observed.run.outputTokens
      : output > 0
        ? output
        : null,
    toolCallCount: events.filter((event) =>
      ["tool", "mcp", "retrieval", "database", "web", "file"].includes(event.category),
    ).length,
    modelCallCount: events.filter((event) => event.category === "model").length,
    status: events.some((event) => event.category === "error") ? "error" : current.run.status,
    events,
  };
  const architecture = mergeGraphs(previous.architecture, current.architecture);
  for (const event of events) {
    if (
      event.metadata?.imported !== true ||
      !event.sourceEntityId ||
      !event.targetEntityId ||
      event.sourceEntityId === event.targetEntityId
    )
      continue;
    const id = `edge:${event.sourceEntityId}:${event.targetEntityId}`;
    if (!architecture.edges.some((edge) => edge.id === id))
      architecture.edges.push({
        id,
        source: event.sourceEntityId,
        target: event.targetEntityId,
        kind: "runtime",
        label: String(event.metadata?.observedCategory ?? event.category),
      });
  }
  return {
    ...current,
    architecture,
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
    diagnostics: [
      ...new Map(
        [...previous.diagnostics, ...current.diagnostics].map((item) => [
          JSON.stringify(item),
          item,
        ]),
      ).values(),
    ].slice(-200),
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
      if (existing) {
        const comparable = {
          ...result,
          session: { ...result.session, modifiedAt: existing.session.modifiedAt },
        };
        if (JSON.stringify(comparable) === JSON.stringify(existing)) {
          result = existing;
          return;
        }
      }
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
