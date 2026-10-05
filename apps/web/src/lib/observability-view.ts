import {
  aggregateRunObservability,
  type ActivityStatistics,
} from "@visual-system/telemetry-adapter/observability";
import type { ArchitectureGraph, GraphEdge, RuntimeEvent } from "@visual-system/schema";
import type { VisualizationDataset } from "@/store/visualization-store";

export interface ObservedStatisticsRow {
  id: string;
  label: string;
  statistics: ActivityStatistics;
}

export interface ObservabilityView {
  run: ActivityStatistics;
  nodes: ObservedStatisticsRow[];
  edges: ObservedStatisticsRow[];
  nodeById: Record<string, ActivityStatistics>;
  edgeById: Record<string, ActivityStatistics>;
  imported: boolean;
}

export type ConnectionObservation =
  { status: "observed"; statistics: ActivityStatistics } | { status: "unobserved" | "ambiguous" };

/** Canvas IDs are graph identities; observability uses directed runtime entity pairs. */
export function selectConnectionObservation(
  edge: GraphEdge,
  graph: ArchitectureGraph,
  events: readonly RuntimeEvent[],
  observability: ObservabilityView | undefined,
): ConnectionObservation {
  const samePair = graph.edges.filter(
    (candidate) => candidate.source === edge.source && candidate.target === edge.target,
  );
  if (samePair.length !== 1) return { status: "ambiguous" };

  const key = `edge:${edge.source}:${edge.target}`;
  const statistics = observability?.edgeById[key];
  if (!statistics) return { status: "unobserved" };

  // Stage 1 keys use colons. Distinct pairs can share a key when IDs contain colons.
  if (
    events.some(
      (event) =>
        event.sourceEntityId &&
        event.targetEntityId &&
        `edge:${event.sourceEntityId}:${event.targetEntityId}` === key &&
        (event.sourceEntityId !== edge.source || event.targetEntityId !== edge.target),
    )
  )
    return { status: "ambiguous" };

  return { status: "observed", statistics };
}

/** Select only the currently loaded telemetry run, including one reconciled with a repository. */
export function selectTelemetryObservability(
  dataset: VisualizationDataset,
): ObservabilityView | undefined {
  if (dataset.source !== "telemetry" && dataset.session?.source !== "telemetry") return undefined;
  if (!dataset.run.events.length) return undefined;
  const statistics = aggregateRunObservability(dataset.run);
  const graph = dataset.reconciliation?.graph ?? dataset.architecture;
  const names = new Map(graph.entities.map((entity) => [entity.id, entity.name]));
  const edgeNames = new Map(
    dataset.run.events
      .filter((event) => event.sourceEntityId && event.targetEntityId)
      .map((event) => [
        `edge:${event.sourceEntityId}:${event.targetEntityId}`,
        `${names.get(event.sourceEntityId!) ?? event.sourceEntityId} → ${names.get(event.targetEntityId!) ?? event.targetEntityId}`,
      ]),
  );
  const sort = (a: ObservedStatisticsRow, b: ObservedStatisticsRow) =>
    b.statistics.callCount - a.statistics.callCount || a.label.localeCompare(b.label);
  return {
    run: statistics.run,
    nodes: Object.entries(statistics.nodes)
      .map(([id, statistics]) => ({ id, label: names.get(id) ?? id, statistics }))
      .sort(sort),
    edges: Object.entries(statistics.edges)
      .map(([id, statistics]) => ({ id, label: edgeNames.get(id) ?? id, statistics }))
      .sort(sort),
    nodeById: statistics.nodes,
    edgeById: statistics.edges,
    imported: dataset.run.events.some((event) => event.metadata?.imported === true),
  };
}
