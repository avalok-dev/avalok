import type { ArchitectureMetadata } from "@visual-system/analyzer";
import {
  ArchitectureGraphSchema,
  type ArchitectureGraph,
  type Entity,
  type GraphEdge,
  type RuntimeEvent,
} from "@visual-system/schema";

export type ReconciliationMatchType =
  "exact-source-path" | "workspace-ownership" | "known-integration";

export interface ReconciliationMatch {
  runtimeEventId: string;
  runtimePath?: string;
  runtimeEntityId?: string;
  architectureEntityId: string;
  matchType: ReconciliationMatchType;
  confidence: number;
  evidence: string;
}

export interface ArchitectureActivity {
  architectureEntityId: string;
  observed: boolean;
  eventCount: number;
  eventIds: string[];
  files: string[];
  lastTimestamp?: number;
  operations: { read: number; edit: number; create: number; delete: number; other: number };
  hasError: boolean;
}

export interface ReconciliationResult {
  graph: ArchitectureGraph;
  events: RuntimeEvent[];
  matches: ReconciliationMatch[];
  activities: Record<string, ArchitectureActivity>;
  unmatchedRuntimeEntityIds: string[];
  unmatchedPaths: string[];
}

export interface ReconcileOptions {
  repositoryRoot?: string;
  runtimeCwd?: string;
}

const architectureMetadata = (entity: Entity) =>
  entity.metadata?.architecture as ArchitectureMetadata | undefined;
const normalizedSeparators = (value: string) => value.replaceAll("\\", "/");

function normalizeRuntimePath(path: string, options: ReconcileOptions) {
  let value = normalizedSeparators(path.trim().replace(/^['"]|['"]$/g, ""));
  if (value.startsWith("file://")) value = value.slice("file://".length);
  const roots = [options.repositoryRoot, options.runtimeCwd]
    .filter((item): item is string => Boolean(item))
    .map((item) => normalizedSeparators(item).replace(/\/$/, ""));
  for (const root of roots) {
    if (value === root) return ".";
    if (value.startsWith(`${root}/`)) return value.slice(root.length + 1);
  }
  return value.replace(/^\.\//, "").replace(/^\//, "");
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function eventPaths(event: RuntimeEvent) {
  const paths = new Set<string>(stringArray(event.metadata?.files));
  if (typeof event.metadata?.path === "string") paths.add(event.metadata.path);
  if (typeof event.metadata?.file === "string") paths.add(event.metadata.file);
  if (typeof event.metadata?.command === "string") {
    for (const token of event.metadata.command.match(/(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]+/g) ??
      [])
      paths.add(token);
  }
  return [...paths];
}

function operationFor(event: RuntimeEvent, path: string) {
  const operations = Array.isArray(event.metadata?.fileOperations)
    ? event.metadata.fileOperations
    : [];
  const explicit = operations.find(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "path" in item &&
      (item as { path?: unknown }).path === path,
  ) as { operation?: unknown } | undefined;
  const operation =
    typeof explicit?.operation === "string"
      ? explicit.operation.toLowerCase()
      : event.action.toLowerCase();
  if (operation.includes("create") || operation.includes("add")) return "create" as const;
  if (operation.includes("delete") || operation.includes("remove")) return "delete" as const;
  if (operation.includes("read")) return "read" as const;
  if (
    operation.includes("edit") ||
    operation.includes("change") ||
    operation.includes("write") ||
    operation.includes("update")
  )
    return "edit" as const;
  return "other" as const;
}

function runtimeId(id: string, staticIds: ReadonlySet<string>) {
  return staticIds.has(id) ? `runtime:${id}` : id;
}

export function reconcileArchitectureExecution(
  architecture: ArchitectureGraph,
  execution: ArchitectureGraph,
  events: readonly RuntimeEvent[],
  options: ReconcileOptions = {},
): ReconciliationResult {
  const staticIds = new Set(architecture.entities.map((entity) => entity.id));
  const sourceOwners = new Map<string, string[]>();
  const directoryOwners: Array<{ directory: string; entityId: string }> = [];
  for (const entity of architecture.entities) {
    const metadata = architectureMetadata(entity);
    if (!metadata) continue;
    for (const file of metadata.sourceFiles)
      sourceOwners.set(file, [...(sourceOwners.get(file) ?? []), entity.id]);
    if (metadata.category === "package" && metadata.directory)
      directoryOwners.push({ directory: metadata.directory, entityId: entity.id });
  }
  directoryOwners.sort((left, right) => right.directory.length - left.directory.length);

  const matches: ReconciliationMatch[] = [];
  const unmatchedPaths = new Set<string>();
  for (const event of events) {
    for (const originalPath of eventPaths(event)) {
      const path = normalizeRuntimePath(originalPath, options);
      const exact = sourceOwners.get(path) ?? [];
      if (exact.length > 0) {
        for (const architectureEntityId of exact)
          matches.push({
            runtimeEventId: event.id,
            runtimePath: originalPath,
            architectureEntityId,
            matchType: "exact-source-path",
            confidence: 1,
            evidence: `${path} exactly matches an analyzed source file.`,
          });
        continue;
      }
      const owner = directoryOwners.find(
        (candidate) =>
          candidate.directory === "." ||
          path === candidate.directory ||
          path.startsWith(`${candidate.directory}/`),
      );
      if (owner) {
        matches.push({
          runtimeEventId: event.id,
          runtimePath: originalPath,
          architectureEntityId: owner.entityId,
          matchType: "workspace-ownership",
          confidence: 0.98,
          evidence: `${path} belongs to workspace ${owner.directory}.`,
        });
      } else {
        unmatchedPaths.add(originalPath);
      }
    }
  }

  for (const event of events) {
    const target = event.targetEntityId
      ? execution.entities.find((entity) => entity.id === event.targetEntityId)
      : undefined;
    if (!target || event.category === "file") continue;
    const integration = architecture.entities.find((entity) => {
      const metadata = architectureMetadata(entity);
      return (
        metadata?.category === "integration" &&
        (entity.name.toLowerCase() === target.name.toLowerCase() ||
          entity.provider?.toLowerCase() === target.provider?.toLowerCase())
      );
    });
    if (integration)
      matches.push({
        runtimeEventId: event.id,
        runtimeEntityId: target.id,
        architectureEntityId: integration.id,
        matchType: "known-integration",
        confidence: 0.9,
        evidence: `${target.name} matches the detected ${integration.name} integration.`,
      });
  }

  const matchesByEvent = new Map<string, ReconciliationMatch[]>();
  for (const match of matches)
    matchesByEvent.set(match.runtimeEventId, [
      ...(matchesByEvent.get(match.runtimeEventId) ?? []),
      match,
    ]);
  const activities: Record<string, ArchitectureActivity> = {};
  for (const entity of architecture.entities) {
    activities[entity.id] = {
      architectureEntityId: entity.id,
      observed: false,
      eventCount: 0,
      eventIds: [],
      files: [],
      operations: { read: 0, edit: 0, create: 0, delete: 0, other: 0 },
      hasError: false,
    };
  }
  for (const event of events) {
    const grouped = new Map<string, ReconciliationMatch>();
    for (const match of matchesByEvent.get(event.id) ?? [])
      grouped.set(match.architectureEntityId, match);
    for (const match of grouped.values()) {
      const activity = activities[match.architectureEntityId];
      if (!activity) continue;
      activity.observed = true;
      activity.eventCount += 1;
      activity.eventIds.push(event.id);
      activity.lastTimestamp = Math.max(activity.lastTimestamp ?? 0, event.timestamp);
      activity.hasError ||= event.category === "error";
      if (match.runtimePath && !activity.files.includes(match.runtimePath))
        activity.files.push(match.runtimePath);
      activity.operations[operationFor(event, match.runtimePath ?? "")] += 1;
    }
  }

  const runtimeIdMap = new Map(
    execution.entities.map((entity) => [entity.id, runtimeId(entity.id, staticIds)]),
  );
  const runtimeEntities = execution.entities.map((entity) => ({
    ...entity,
    id: runtimeIdMap.get(entity.id) ?? entity.id,
    metadata: { ...entity.metadata, runtime: { external: true, originalEntityId: entity.id } },
  }));
  const enrichedStatic = architecture.entities.map((entity) => ({
    ...entity,
    metadata: { ...entity.metadata, runtime: activities[entity.id] },
  }));
  const runtimeEdges: GraphEdge[] = execution.edges.map((edge) => ({
    ...edge,
    id: `runtime:${edge.id}`,
    source: runtimeIdMap.get(edge.source) ?? edge.source,
    target: runtimeIdMap.get(edge.target) ?? edge.target,
    kind: "runtime",
    metadata: { ...edge.metadata, runtime: true, relationship: "runtime-observation" },
  }));
  const observationEdges: GraphEdge[] = [];
  const observationKeys = new Set<string>();
  for (const match of matches) {
    const event = events.find((candidate) => candidate.id === match.runtimeEventId);
    const source = event?.sourceEntityId ? runtimeIdMap.get(event.sourceEntityId) : undefined;
    if (!source) continue;
    const key = `${source}\0${match.architectureEntityId}`;
    if (observationKeys.has(key)) continue;
    observationKeys.add(key);
    observationEdges.push({
      id: `runtime:observation:${source}:${match.architectureEntityId}`,
      source,
      target: match.architectureEntityId,
      kind: "runtime-observation",
      label: "observed",
      metadata: {
        runtime: true,
        relationship: "runtime-observation",
        matchType: match.matchType,
        confidence: match.confidence,
        evidence: match.evidence,
      },
    });
  }

  const reconciledEvents = events.map((event) => {
    const eventMatches = matchesByEvent.get(event.id) ?? [];
    return {
      ...event,
      ...(event.sourceEntityId
        ? { sourceEntityId: runtimeIdMap.get(event.sourceEntityId) ?? event.sourceEntityId }
        : {}),
      ...(event.targetEntityId
        ? { targetEntityId: runtimeIdMap.get(event.targetEntityId) ?? event.targetEntityId }
        : {}),
      metadata: {
        ...event.metadata,
        architectureEntityIds: [
          ...new Set(eventMatches.map((match) => match.architectureEntityId)),
        ],
        architectureMatches: eventMatches.map((match) => ({
          entityId: match.architectureEntityId,
          matchType: match.matchType,
          confidence: match.confidence,
          evidence: match.evidence,
        })),
      },
    };
  });
  const matchedRuntimeIds = new Set(
    matches.flatMap((match) => (match.runtimeEntityId ? [match.runtimeEntityId] : [])),
  );
  return {
    graph: ArchitectureGraphSchema.parse({
      id: `unified:${architecture.id}:${execution.id}`,
      title: architecture.title,
      entities: [...enrichedStatic, ...runtimeEntities],
      edges: [...architecture.edges, ...runtimeEdges, ...observationEdges],
    }),
    events: reconciledEvents,
    matches,
    activities,
    unmatchedRuntimeEntityIds: execution.entities
      .filter((entity) => !matchedRuntimeIds.has(entity.id))
      .map((entity) => entity.id),
    unmatchedPaths: [...unmatchedPaths],
  };
}
