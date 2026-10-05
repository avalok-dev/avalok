import type { RuntimeEvent, Run } from "@visual-system/schema";

export interface ActivityStatistics {
  callCount: number;
  failures: number;
  failureRate: number | null;
  totalDurationMs: number;
  latencySampleCount: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  observedRetries: number;
  repeatedAttempts: number;
}

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const category = (event: RuntimeEvent) => event.metadata?.observedCategory ?? event.category;

/** Each direction is attributed once: an agent's own summary wins over its child generations. */
function usageOwners(events: readonly RuntimeEvent[], field: "inputTokens" | "outputTokens") {
  const bySpan = new Map(events.filter((e) => e.spanId).map((e) => [e.spanId!, e]));
  const owner = (event: RuntimeEvent): RuntimeEvent | undefined => {
    let parent = event.parentSpanId;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      const ancestor = bySpan.get(parent);
      if (!ancestor) break;
      if (category(ancestor) === "agent") return ancestor;
      parent = ancestor.parentSpanId;
    }
    return undefined;
  };
  const selected = new Set<string>();
  for (const event of events) {
    if (count(event.metadata?.[field]) === undefined) continue;
    if (category(event) === "agent") {
      selected.add(event.id);
      continue;
    }
    if (category(event) !== "model") continue;
    const agent = owner(event);
    if (!agent || count(agent.metadata?.[field]) === undefined) selected.add(event.id);
  }
  return selected;
}

function percentile(sorted: readonly number[], fraction: number) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

function summarize(
  events: readonly RuntimeEvent[],
  inputOwners: Set<string>,
  outputOwners: Set<string>,
): ActivityStatistics {
  const durations = events
    .map((event) => event.durationMs)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  const failures = events.filter(
    (event) => event.category === "error" || event.metadata?.status === "error",
  ).length;
  const tokens = (field: "inputTokens" | "outputTokens", owners: Set<string>) => {
    const values = events
      .filter((event) => owners.has(event.id))
      .map((event) => count(event.metadata?.[field]))
      .filter((value): value is number => value !== undefined);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const attempts = new Map<string, number>();
  let repeatedAttempts = 0;
  for (const event of events) {
    const key = `${event.sourceEntityId ?? ""}\0${event.targetEntityId ?? ""}\0${event.parentSpanId ?? ""}`;
    const previous = attempts.get(key) ?? 0;
    if (previous) repeatedAttempts += 1;
    attempts.set(key, previous + 1);
  }
  return {
    callCount: events.length,
    failures,
    failureRate: events.length ? failures / events.length : null,
    totalDurationMs: durations.reduce((sum, value) => sum + value, 0),
    latencySampleCount: durations.length,
    p50LatencyMs: percentile(durations, 0.5),
    p95LatencyMs: percentile(durations, 0.95),
    inputTokens: tokens("inputTokens", inputOwners),
    outputTokens: tokens("outputTokens", outputOwners),
    observedRetries: events.filter((event) => event.metadata?.retryObserved === true).length,
    repeatedAttempts,
  };
}

export function aggregateRunObservability(run: Run) {
  const events = [...new Map(run.events.map((event) => [event.id, event])).values()];
  const inputs = usageOwners(events, "inputTokens");
  const outputs = usageOwners(events, "outputTokens");
  const nodes: Record<string, ActivityStatistics> = {};
  const edges: Record<string, ActivityStatistics> = {};
  for (const id of new Set(
    events.map((event) => event.targetEntityId).filter((id): id is string => !!id),
  ))
    nodes[id] = summarize(
      events.filter((event) => event.targetEntityId === id),
      inputs,
      outputs,
    );
  for (const key of new Set(
    events
      .filter((event) => event.sourceEntityId && event.targetEntityId)
      .map((event) => `edge:${event.sourceEntityId}:${event.targetEntityId}`),
  ))
    edges[key] = summarize(
      events.filter((event) => `edge:${event.sourceEntityId}:${event.targetEntityId}` === key),
      inputs,
      outputs,
    );
  return { run: summarize(events, inputs, outputs), nodes, edges };
}
