import { slowStepMs } from "@visual-system/graph";
import type { ArchitectureGraph, Entity, Run, RuntimeEvent } from "@visual-system/schema";
import { entityLabels } from "./labels";

export interface RecapEntity {
  id: string;
  /** Display label (already privacy-safe, or anonymized). */
  label: string;
  kind: Entity["kind"];
  steps: number;
  /** Sum of the recorded durations of steps that worked on this entity. */
  timeMs: number;
  slowSteps: number;
  failures: number;
}

/**
 * What an agent session did, computed only from observed events. Anything that was not observed
 * is null or absent, never estimated. Contains no prompt text, run title, paths, or raw ids.
 */
export interface SessionRecap {
  status: Run["status"];
  durationMs: number;
  steps: number;
  toolCalls: number;
  modelCalls: number;
  failures: number;
  retries: number;
  slowSteps: number;
  /** Sum of the recorded durations of all steps (time spent in steps, not wall-clock time). */
  stepTimeMs: number;
  /** The longest single recorded step. */
  longestStepMs: number;
  /** Counts for the well-known Codex entities; 0 when the source does not report them. */
  commands: number;
  fileOperations: number;
  testRuns: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Where the recorded step time went, most first (at most `topCount`). */
  whereTimeWent: RecapEntity[];
  /** Architecture entities that observed steps were matched to (repository sessions). */
  architectureTouched: RecapEntity[];
  /** Plain-language notes on what could not be observed. */
  unavailable: string[];
}

export interface RecapOptions {
  anonymize?: boolean;
  topCount?: number;
}

const applicationKinds = new Set<Entity["kind"]>([
  "service",
  "frontend",
  "api",
  "database",
  "vector_database",
  "queue",
  "storage",
  "function",
  "workload",
  "container",
  "gateway",
  "load_balancer",
  "cluster",
  "cloud",
]);

function isFailure(event: RuntimeEvent) {
  return event.category === "error" || event.metadata?.status === "error";
}

function reconciledIds(event: RuntimeEvent) {
  const ids = event.metadata?.architectureEntityIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export function summarizeSession(
  run: Run,
  graph: ArchitectureGraph,
  options: RecapOptions = {},
): SessionRecap {
  const topCount = options.topCount ?? 5;
  const entityById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const labels = entityLabels(graph.entities, options.anonymize ?? false);

  const stats = new Map<string, RecapEntity>();
  const touch = (id: string, event: RuntimeEvent, failed: boolean, slow: boolean) => {
    const entity = entityById.get(id);
    if (!entity || entity.kind === "user") return;
    const entry = stats.get(id) ?? {
      id,
      label: labels.get(id) ?? entity.name,
      kind: entity.kind,
      steps: 0,
      timeMs: 0,
      slowSteps: 0,
      failures: 0,
    };
    entry.steps += 1;
    entry.timeMs += event.durationMs ?? 0;
    if (slow) entry.slowSteps += 1;
    if (failed) entry.failures += 1;
    stats.set(id, entry);
  };

  let failures = 0;
  let retries = 0;
  let slowSteps = 0;
  let stepTimeMs = 0;
  let longestStepMs = 0;
  let commands = 0;
  let fileOperations = 0;
  let testRuns = 0;
  const architecture = new Map<string, RecapEntity>();

  for (const event of run.events) {
    const failed = isFailure(event);
    const slow = (event.durationMs ?? 0) >= slowStepMs;
    if (failed) failures += 1;
    if (event.metadata?.retryObserved === true) retries += 1;
    if (slow) slowSteps += 1;
    stepTimeMs += event.durationMs ?? 0;
    longestStepMs = Math.max(longestStepMs, event.durationMs ?? 0);
    if (event.targetEntityId === "terminal") commands += 1;
    if (event.targetEntityId === "files") fileOperations += 1;
    if (event.targetEntityId === "tests") testRuns += 1;

    const working = new Set<string>();
    const dwell = event.targetEntityId ?? event.sourceEntityId;
    if (dwell) working.add(dwell);
    for (const id of reconciledIds(event)) {
      working.add(id);
      const entity = entityById.get(id);
      if (entity && applicationKinds.has(entity.kind)) {
        const entry = architecture.get(id) ?? {
          id,
          label: labels.get(id) ?? entity.name,
          kind: entity.kind,
          steps: 0,
          timeMs: 0,
          slowSteps: 0,
          failures: 0,
        };
        entry.steps += 1;
        entry.timeMs += event.durationMs ?? 0;
        if (slow) entry.slowSteps += 1;
        if (failed) entry.failures += 1;
        architecture.set(id, entry);
      }
    }
    for (const id of working) touch(id, event, failed, slow);
  }

  const byTime = (a: RecapEntity, b: RecapEntity) =>
    b.timeMs - a.timeMs || b.steps - a.steps || a.label.localeCompare(b.label);

  const unavailable: string[] = [];
  if (run.inputTokens === null && run.outputTokens === null) unavailable.push("token counts");
  if (run.estimatedCostUsd === null) unavailable.push("cost");
  if (!run.events.some((event) => (event.durationMs ?? 0) > 0)) unavailable.push("step durations");

  return {
    status: run.status,
    durationMs: run.totalDurationMs,
    steps: run.events.length,
    toolCalls: run.toolCallCount,
    modelCalls: run.modelCallCount,
    failures,
    retries,
    slowSteps,
    stepTimeMs,
    longestStepMs,
    commands,
    fileOperations,
    testRuns,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    whereTimeWent: [...stats.values()]
      .filter((entry) => entry.timeMs > 0)
      .sort(byTime)
      .slice(0, topCount),
    architectureTouched: [...architecture.values()].sort(byTime).slice(0, topCount),
    unavailable,
  };
}

/** `1 command`, `2 commands`. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatCount(value: number) {
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 10_000
      ? `${Math.round(value / 1000)}k`
      : value >= 1000
        ? `${(value / 1000).toFixed(1)}k`
        : String(value);
}
