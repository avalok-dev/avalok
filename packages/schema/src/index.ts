import { z } from "zod";

export const EntityKindSchema = z.enum([
  "user",
  "frontend",
  "service",
  "agent",
  "model",
  "memory",
  "vector_database",
  "database",
  "tool",
  "mcp_server",
  "web",
  "document",
  "api",
  "queue",
  "storage",
  "infrastructure",
  "cloud",
  "network",
  "cluster",
  "namespace",
  "workload",
  "container",
  "gateway",
  "load_balancer",
  "function",
  "config",
  "identity",
]);

export type EntityKind = z.infer<typeof EntityKindSchema>;

export const SourceLocationSchema = z.object({
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});

export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const MetricStatusSchema = z.enum(["configured", "observed", "estimated"]);
export type MetricStatus = z.infer<typeof MetricStatusSchema>;

export const ResourceMetricSchema = z.object({
  name: z.string().min(1),
  status: MetricStatusSchema,
  source: z.string().min(1),
  unit: z.string().min(1).optional(),
  value: z.union([z.number(), z.string()]),
  observedAt: z.string().datetime().optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type ResourceMetric = z.infer<typeof ResourceMetricSchema>;

export const CostAttributionSchema = z.object({
  category: z.string().min(1),
  status: z.enum(["observed", "estimated"]),
  source: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type CostAttribution = z.infer<typeof CostAttributionSchema>;

export const EntitySchema = z.object({
  id: z.string().min(1),
  kind: EntityKindSchema,
  name: z.string().min(1),
  provider: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  source: SourceLocationSchema.optional(),
  metrics: z.array(ResourceMetricSchema).optional(),
  costs: z.array(CostAttributionSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type Entity = z.infer<typeof EntitySchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const EventCategorySchema = z.enum([
  "prompt",
  "http",
  "service",
  "agent",
  "model",
  "tool",
  "retrieval",
  "memory",
  "database",
  "web",
  "file",
  "mcp",
  "response",
  "error",
]);

export type EventCategory = z.infer<typeof EventCategorySchema>;

export const RuntimeEventSchema = z.object({
  id: z.string().min(1),
  traceId: z.string().min(1),
  spanId: z.string().min(1).optional(),
  parentSpanId: z.string().min(1).optional(),
  timestamp: z.number().nonnegative(),
  durationMs: z.number().nonnegative().optional(),
  category: EventCategorySchema,
  action: z.string().min(1),
  sourceEntityId: z.string().min(1).optional(),
  targetEntityId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

export const SpanSchema = z.object({
  id: z.string().min(1),
  traceId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  name: z.string().min(1),
  startedAt: z.number().nonnegative(),
  endedAt: z.number().nonnegative().optional(),
  attributes: z.record(z.unknown()).optional(),
});

export type Span = z.infer<typeof SpanSchema>;

export const TraceSchema = z.object({
  id: z.string().min(1),
  spans: z.array(SpanSchema),
});

export type Trace = z.infer<typeof TraceSchema>;

export const RunStatusSchema = z.enum(["queued", "running", "completed", "error"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    prompt: z.string().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    totalDurationMs: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
    toolCallCount: z.number().int().nonnegative(),
    modelCallCount: z.number().int().nonnegative(),
    status: RunStatusSchema,
    events: z.array(RuntimeEventSchema),
  })
  .superRefine((run, context) => {
    for (let index = 1; index < run.events.length; index += 1) {
      const previous = run.events[index - 1];
      const current = run.events[index];
      if (previous && current && current.timestamp < previous.timestamp) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Run events must be ordered by timestamp",
          path: ["events", index, "timestamp"],
        });
      }
    }
  });

export type Run = z.infer<typeof RunSchema>;

export const ArchitectureGraphSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    entities: z.array(EntitySchema),
    edges: z.array(GraphEdgeSchema),
  })
  .superRefine((graph, context) => {
    const entityIds = new Set(graph.entities.map((entity) => entity.id));
    const duplicateIds = graph.entities
      .map((entity) => entity.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index);

    for (const id of duplicateIds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate entity id: ${id}`,
        path: ["entities"],
      });
    }

    graph.edges.forEach((edge, index) => {
      if (!entityIds.has(edge.source) || !entityIds.has(edge.target)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge ${edge.id} references an unknown entity`,
          path: ["edges", index],
        });
      }
    });
  });

export type ArchitectureGraph = z.infer<typeof ArchitectureGraphSchema>;

export const RuntimeGraphSchema = z.object({
  architecture: ArchitectureGraphSchema,
  activeEntityIds: z.array(z.string()),
  activeEdgeIds: z.array(z.string()),
  completedEntityIds: z.array(z.string()),
  completedEdgeIds: z.array(z.string()),
  currentEventId: z.string().optional(),
});

export type RuntimeGraph = z.infer<typeof RuntimeGraphSchema>;

/** The public, content-free contract for a manually exported local run. */
export const RunExportV1Schema = z
  .object({
    format: z.literal("avalok.run-export"),
    version: z.literal(1),
    source: z.enum(["demo", "codex", "claude", "telemetry"]),
    run: z
      .object({
        status: RunStatusSchema,
        totalDurationMs: z.number().finite().nonnegative(),
        inputTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        toolCallCount: z.number().int().nonnegative(),
        modelCallCount: z.number().int().nonnegative(),
      })
      .strict(),
    entities: z.array(
      z.object({ id: z.number().int().positive(), kind: EntityKindSchema }).strict(),
    ),
    events: z.array(
      z
        .object({
          sequence: z.number().int().positive(),
          trace: z.number().int().positive(),
          timestampMs: z.number().finite().nonnegative(),
          durationMs: z.number().finite().nonnegative().optional(),
          category: EventCategorySchema,
          sourceEntity: z.number().int().positive().optional(),
          targetEntity: z.number().int().positive().optional(),
          failed: z.boolean(),
          retryObserved: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((payload, context) => {
    const entityIds = new Set<number>();
    payload.entities.forEach((entity, index) => {
      if (entity.id !== index + 1 || entityIds.has(entity.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entities", index, "id"],
          message: "Entity IDs must be consecutive",
        });
      }
      entityIds.add(entity.id);
    });
    payload.events.forEach((event, index) => {
      if (event.sequence !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index, "sequence"],
          message: "Event sequence must be consecutive",
        });
      }
      if (index > 0 && event.timestampMs < payload.events[index - 1]!.timestampMs) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index, "timestampMs"],
          message: "Events must be ordered by timestamp",
        });
      }
      for (const key of ["sourceEntity", "targetEntity"] as const) {
        if (event[key] !== undefined && !entityIds.has(event[key])) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["events", index, key],
            message: "Unknown entity reference",
          });
        }
      }
    });
  });

export type RunExportV1 = z.infer<typeof RunExportV1Schema>;

/** Rebuilds a payload from approved scalar fields; no original IDs, names, or metadata cross this boundary. */
export function prepareRunExportV1(
  run: Run,
  architecture: ArchitectureGraph,
  source: RunExportV1["source"],
): RunExportV1 {
  const kindsById = new Map(architecture.entities.map((entity) => [entity.id, entity.kind]));
  const entityNumbers = new Map<string, number>();
  const traceNumbers = new Map<string, number>();
  const entities: RunExportV1["entities"] = [];
  const entityNumber = (id: string | undefined) => {
    if (!id) return undefined;
    const kind = kindsById.get(id);
    if (!kind) return undefined;
    let number = entityNumbers.get(id);
    if (!number) {
      number = entities.length + 1;
      entityNumbers.set(id, number);
      entities.push({ id: number, kind });
    }
    return number;
  };
  const events = run.events.map((event, index) => {
    let trace = traceNumbers.get(event.traceId);
    if (!trace) {
      trace = traceNumbers.size + 1;
      traceNumbers.set(event.traceId, trace);
    }
    const sourceEntity = entityNumber(event.sourceEntityId);
    const targetEntity = entityNumber(event.targetEntityId);
    return {
      sequence: index + 1,
      trace,
      timestampMs: event.timestamp,
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      category: event.category,
      ...(sourceEntity === undefined ? {} : { sourceEntity }),
      ...(targetEntity === undefined ? {} : { targetEntity }),
      failed: event.category === "error" || event.metadata?.status === "error",
      retryObserved: event.metadata?.retryObserved === true,
    };
  });
  return RunExportV1Schema.parse({
    format: "avalok.run-export",
    version: 1,
    source,
    run: {
      status: run.status,
      totalDurationMs: run.totalDurationMs,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      toolCallCount: run.toolCallCount,
      modelCallCount: run.modelCallCount,
    },
    entities,
    events,
  });
}
