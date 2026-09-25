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
]);

export type EntityKind = z.infer<typeof EntityKindSchema>;

export const SourceLocationSchema = z.object({
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});

export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const EntitySchema = z.object({
  id: z.string().min(1),
  kind: EntityKindSchema,
  name: z.string().min(1),
  provider: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  source: SourceLocationSchema.optional(),
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
