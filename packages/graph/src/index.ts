import type { ElkNode } from "elkjs/lib/elk-api";
import type { ArchitectureGraph, Entity, GraphEdge, RuntimeEvent } from "@visual-system/schema";

export { deriveDwellState, slowStepMs, type DwellGlow, type DwellOptions } from "./dwell";

export interface GraphIndex {
  entities: ReadonlyMap<string, Entity>;
  edges: ReadonlyMap<string, GraphEdge>;
  outgoing: ReadonlyMap<string, readonly GraphEdge[]>;
  incoming: ReadonlyMap<string, readonly GraphEdge[]>;
  edgeByPair: ReadonlyMap<string, GraphEdge>;
}

export interface GraphRuntimeState {
  activeEntityIds: ReadonlySet<string>;
  activeEdgeIds: ReadonlySet<string>;
  completedEntityIds: ReadonlySet<string>;
  completedEdgeIds: ReadonlySet<string>;
}

export interface PositionedEntity extends Entity {
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface PositionedGraph {
  entities: PositionedEntity[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

export interface GraphLayoutEngine {
  layout(graph: ArchitectureGraph): Promise<PositionedGraph>;
}

export interface ReconciliationCandidate {
  architectureEntityId: string;
  runtimeEntityId: string;
  confidence: number;
  reason: string;
}

export interface GraphReconciler {
  reconcile(
    architecture: ArchitectureGraph,
    runtimeEntityIds: readonly string[],
  ): Promise<readonly ReconciliationCandidate[]>;
}

const pairKey = (source: string, target: string) => `${source}\u0000${target}`;

export function createGraphIndex(graph: ArchitectureGraph): GraphIndex {
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  const edgeByPair = new Map<string, GraphEdge>();

  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    edgeByPair.set(pairKey(edge.source, edge.target), edge);
  }

  return { entities, edges, outgoing, incoming, edgeByPair };
}

export function findDirectedPath(
  graph: ArchitectureGraph,
  sourceId: string,
  targetId: string,
): GraphEdge[] {
  if (sourceId === targetId) return [];
  const index = createGraphIndex(graph);
  const queue: Array<{ entityId: string; path: GraphEdge[] }> = [{ entityId: sourceId, path: [] }];
  const visited = new Set([sourceId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const edge of index.outgoing.get(current.entityId) ?? []) {
      const path = [...current.path, edge];
      if (edge.target === targetId) return path;
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push({ entityId: edge.target, path });
      }
    }
  }

  return [];
}

export function deriveGraphRuntimeState(
  graph: ArchitectureGraph,
  events: readonly RuntimeEvent[],
  timestamp: number,
  minimumActiveMs = 220,
): GraphRuntimeState {
  const index = createGraphIndex(graph);
  const activeEntityIds = new Set<string>();
  const activeEdgeIds = new Set<string>();
  const completedEntityIds = new Set<string>();
  const completedEdgeIds = new Set<string>();

  for (const event of events) {
    if (event.timestamp > timestamp) continue;
    const end = event.timestamp + Math.max(event.durationMs ?? 0, minimumActiveMs);
    const isActive = timestamp <= end;
    const entityTarget = isActive ? activeEntityIds : completedEntityIds;
    const edgeTarget = isActive ? activeEdgeIds : completedEdgeIds;

    if (event.sourceEntityId) entityTarget.add(event.sourceEntityId);
    if (event.targetEntityId) entityTarget.add(event.targetEntityId);
    const reconciledEntityIds = Array.isArray(event.metadata?.architectureEntityIds)
      ? event.metadata.architectureEntityIds.filter(
          (entityId): entityId is string => typeof entityId === "string",
        )
      : [];
    for (const entityId of reconciledEntityIds) {
      entityTarget.add(entityId);
      if (event.sourceEntityId) {
        const observationEdge = index.edgeByPair.get(pairKey(event.sourceEntityId, entityId));
        if (observationEdge) edgeTarget.add(observationEdge.id);
      }
    }
    if (event.sourceEntityId && event.targetEntityId) {
      const edge =
        index.edgeByPair.get(pairKey(event.sourceEntityId, event.targetEntityId)) ??
        index.edgeByPair.get(pairKey(event.targetEntityId, event.sourceEntityId));
      if (edge) edgeTarget.add(edge.id);
    }
  }

  return { activeEntityIds, activeEdgeIds, completedEntityIds, completedEdgeIds };
}

export class ElkLayoutEngine implements GraphLayoutEngine {
  async layout(graph: ArchitectureGraph): Promise<PositionedGraph> {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    const elk = new ELK();
    const width = 184;
    const height = 84;
    const input: ElkNode = {
      id: graph.id,
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.spacing.nodeNode": "54",
        "elk.layered.spacing.nodeNodeBetweenLayers": "92",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      },
      children: graph.entities.map((entity) => ({ id: entity.id, width, height })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
    };
    const layout = await elk.layout(input);

    const children = new Map((layout.children ?? []).map((child) => [child.id, child]));
    return {
      entities: graph.entities.map((entity) => {
        const child = children.get(entity.id);
        return {
          ...entity,
          position: { x: child?.x ?? 0, y: child?.y ?? 0 },
          width,
          height,
        };
      }),
      edges: graph.edges,
      width: layout.width ?? 0,
      height: layout.height ?? 0,
    };
  }
}
