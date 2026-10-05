import type { Run, RuntimeEvent } from "@visual-system/schema";

export interface RunInsight {
  id: string;
  severity: "warning" | "info";
  title: string;
  detail: string;
}

const observedCategory = (event: RuntimeEvent) =>
  event.metadata?.observedCategory ?? event.category;
const isFailure = (event: RuntimeEvent) =>
  event.category === "error" || event.metadata?.status === "error";

/** Deterministic, local observations about one run. No network calls or inferred costs. */
export function deriveRunInsights(run: Run): RunInsight[] {
  const events = [...new Map(run.events.map((event) => [event.id, event])).values()];
  const insights: RunInsight[] = [];
  const failures = events.filter(isFailure);
  if (failures.length) {
    insights.push({
      id: "failures",
      severity: "warning",
      title: `${failures.length} failed ${failures.length === 1 ? "step" : "steps"}`,
      detail: "Open the timeline or select an affected node to inspect the recorded error.",
    });
  }

  const slow = events.filter(
    (event) => event.durationMs !== undefined && event.durationMs >= 10_000,
  );
  if (slow.length) {
    insights.push({
      id: "slow-steps",
      severity: "warning",
      title: `${slow.length} slow ${slow.length === 1 ? "step" : "steps"} (10 s or more)`,
      detail:
        "This is a local review threshold, not a configured alert or production notification.",
    });
  }

  const memory = events.filter(
    (event) => observedCategory(event) === "memory" || observedCategory(event) === "retrieval",
  );
  if (memory.length) {
    const memoryFailures = memory.filter(isFailure).length;
    const durations = memory
      .map((event) => event.durationMs)
      .filter((duration): duration is number => duration !== undefined);
    const average = durations.length
      ? `${Math.round(durations.reduce((total, duration) => total + duration, 0) / durations.length)} ms average`
      : "latency unavailable";
    insights.push({
      id: "memory-retrieval",
      severity: memoryFailures ? "warning" : "info",
      title: `Memory and retrieval: ${memory.length} ${memory.length === 1 ? "call" : "calls"}`,
      detail: `${memoryFailures} failed · ${average} (${durations.length} timed)`,
    });
  }

  const retries = events.filter((event) => event.metadata?.retryObserved === true).length;
  if (retries) {
    insights.push({
      id: "retries",
      severity: "info",
      title: `${retries} observed ${retries === 1 ? "retry" : "retries"}`,
      detail: "Retries are counted only when the trace explicitly records a retry attempt.",
    });
  }
  return insights;
}
