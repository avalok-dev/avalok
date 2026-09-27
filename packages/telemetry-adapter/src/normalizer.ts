import {
  runtimeSources,
  sanitizeValue,
  type RuntimeDiagnostic,
  type RuntimeSnapshot,
  type RuntimeSourceKind,
} from "@visual-system/runtime-adapter";
import {
  ArchitectureGraphSchema,
  RunSchema,
  type Entity,
  type EntityKind,
  type EventCategory,
  type GraphEdge,
  type RuntimeEvent,
} from "@visual-system/schema";
import type { CanonicalSpan } from "./types.ts";

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const urlHost = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).host || undefined;
  } catch {
    return undefined;
  }
};

interface Classification {
  category: EventCategory;
  action: string;
  entityKind: EntityKind;
  entityId: string;
  entityName: string;
  provider?: string;
  openInferenceKind?: string;
}

function openInferenceClassification(span: CanonicalSpan): Classification | undefined {
  const kind = text(span.attributes["openinference.span.kind"])?.toUpperCase();
  if (!kind) return undefined;
  const model =
    text(span.attributes["llm.model_name"]) ??
    text(span.attributes["gen_ai.request.model"]) ??
    text(span.attributes["embedding.model_name"]);
  const provider =
    text(span.attributes["llm.provider"]) ??
    text(span.attributes["llm.system"]) ??
    text(span.attributes["gen_ai.provider.name"]);
  const toolName = text(span.attributes["tool.name"]) ?? span.name;
  const definitions: Record<string, Omit<Classification, "openInferenceKind">> = {
    LLM: {
      category: "model",
      action: "model.call",
      entityKind: "model",
      entityId: `model:${slug(`${provider ?? "unknown"}-${model ?? span.name}`)}`,
      entityName: model ?? span.name,
      ...(provider ? { provider } : {}),
    },
    AGENT: {
      category: "agent",
      action: "agent.run",
      entityKind: "agent",
      entityId: `agent:${slug(text(span.attributes["agent.name"]) ?? span.name)}`,
      entityName: text(span.attributes["agent.name"]) ?? span.name,
    },
    CHAIN: {
      category: "agent",
      action: "chain.run",
      entityKind: "agent",
      entityId: `chain:${slug(span.name)}`,
      entityName: span.name,
    },
    TOOL: {
      category: toolName.startsWith("mcp__") ? "mcp" : "tool",
      action: toolName.startsWith("mcp__") ? "mcp.tool_call" : "tool.call",
      entityKind: toolName.startsWith("mcp__") ? "mcp_server" : "tool",
      entityId: `${toolName.startsWith("mcp__") ? "mcp" : "tool"}:${slug(toolName)}`,
      entityName: toolName,
    },
    RETRIEVER: {
      category: "retrieval",
      action: "retrieval.query",
      entityKind: "vector_database",
      entityId: `retriever:${slug(span.name)}`,
      entityName: span.name,
    },
    EMBEDDING: {
      category: "retrieval",
      action: "embedding.create",
      entityKind: "model",
      entityId: `embedding:${slug(model ?? span.name)}`,
      entityName: model ?? span.name,
    },
    RERANKER: {
      category: "retrieval",
      action: "reranker.rank",
      entityKind: "model",
      entityId: `reranker:${slug(text(span.attributes["reranker.model_name"]) ?? span.name)}`,
      entityName: text(span.attributes["reranker.model_name"]) ?? span.name,
    },
    PROMPT: {
      category: "prompt",
      action: "prompt.render",
      entityKind: "agent",
      entityId: `prompt:${slug(span.name)}`,
      entityName: span.name,
    },
    GUARDRAIL: {
      category: "tool",
      action: "guardrail.check",
      entityKind: "tool",
      entityId: `guardrail:${slug(span.name)}`,
      entityName: span.name,
    },
    EVALUATOR: {
      category: "tool",
      action: "evaluation.run",
      entityKind: "tool",
      entityId: `evaluator:${slug(span.name)}`,
      entityName: span.name,
    },
  };
  const classification = definitions[kind];
  return classification ? { ...classification, openInferenceKind: kind } : undefined;
}

function genericClassification(span: CanonicalSpan, serviceName: string): Classification {
  const dbSystem = text(span.attributes["db.system"]) ?? text(span.attributes["db.system.name"]);
  if (dbSystem) {
    return {
      category: "database",
      action: "database.query",
      entityKind: "database",
      entityId: `database:${slug(dbSystem)}`,
      entityName: dbSystem,
      provider: dbSystem,
    };
  }
  const genAiOperation = text(span.attributes["gen_ai.operation.name"]);
  if (genAiOperation) {
    const model =
      text(span.attributes["gen_ai.request.model"]) ??
      text(span.attributes["gen_ai.response.model"]) ??
      span.name;
    const provider = text(span.attributes["gen_ai.provider.name"]);
    return {
      category: "model",
      action: `model.${genAiOperation}`,
      entityKind: "model",
      entityId: `model:${slug(`${provider ?? "unknown"}-${model}`)}`,
      entityName: model,
      ...(provider ? { provider } : {}),
    };
  }
  const method =
    text(span.attributes["http.request.method"]) ?? text(span.attributes["http.method"]);
  if (method || span.kind === 2 || span.kind === 3) {
    const host =
      text(span.attributes["server.address"]) ??
      text(span.attributes["http.host"]) ??
      urlHost(span.attributes["url.full"]);
    const server = span.kind === 2;
    return {
      category: "http",
      action: server ? "http.server" : "http.client",
      entityKind: server ? "service" : "api",
      entityId: server ? `service:${slug(serviceName)}` : `api:${slug(host ?? span.name)}`,
      entityName: server ? serviceName : (host ?? span.name),
    };
  }
  return {
    category: "service",
    action: "service.operation",
    entityKind: "service",
    entityId: `service:${slug(serviceName)}`,
    entityName: serviceName,
  };
}

function tokenCount(span: CanonicalSpan, keys: string[]) {
  for (const key of keys) {
    const value = number(span.attributes[key]);
    if (value !== undefined) return Math.max(0, Math.round(value));
  }
  return 0;
}

function sourceKind(spans: CanonicalSpan[]): RuntimeSourceKind {
  return spans.some((span) => {
    const service = text(span.resource["service.name"])?.toLowerCase() ?? "";
    return service.includes("claude") || text(span.resource["service.namespace"]) === "claude-code";
  })
    ? "claude"
    : "telemetry";
}

export function normalizeTrace(spansInput: readonly CanonicalSpan[]): RuntimeSnapshot {
  if (spansInput.length === 0) throw new Error("A telemetry trace must contain at least one span.");
  const spans = [...spansInput].sort(
    (left, right) => left.startMs - right.startMs || left.spanId.localeCompare(right.spanId),
  );
  const traceId = spans[0]?.traceId ?? "unknown";
  const origin = Math.min(...spans.map((span) => span.startMs));
  const end = Math.max(...spans.map((span) => span.endMs));
  const services = [
    ...new Set(
      spans
        .map((span) => text(span.resource["service.name"]))
        .filter((item): item is string => Boolean(item)),
    ),
  ];
  const serviceName = services[0] ?? "Observed service";
  const kind = sourceKind(spans);
  const entities = new Map<string, Entity>();
  const edges = new Map<string, GraphEdge>();
  const events: RuntimeEvent[] = [];
  const rawEvents: Record<string, unknown> = {};
  const diagnostics: RuntimeDiagnostic[] = [];
  let unsupportedOpenInferenceKinds = 0;
  let redactedFields = 0;
  let truncatedFields = 0;

  entities.set("user", { id: "user", kind: "user", name: "User" });
  const classifications = new Map<string, Classification>();
  for (const span of spans) {
    const openInferenceKind = text(span.attributes["openinference.span.kind"]);
    const openInference = openInferenceClassification(span);
    if (openInferenceKind && !openInference) unsupportedOpenInferenceKinds += 1;
    const classification =
      openInference ??
      genericClassification(span, text(span.resource["service.name"]) ?? serviceName);
    classifications.set(span.spanId, classification);
    if (!entities.has(classification.entityId)) {
      entities.set(classification.entityId, {
        id: classification.entityId,
        kind: classification.entityKind,
        name: classification.entityName,
        ...(classification.provider ? { provider: classification.provider } : {}),
        description: classification.openInferenceKind
          ? `Observed OpenInference ${classification.openInferenceKind} span.`
          : "Observed OpenTelemetry span.",
        metadata: { runtime: true, services },
      });
    }
  }

  for (const span of spans) {
    const classification = classifications.get(span.spanId);
    if (!classification) continue;
    const parent = span.parentSpanId ? classifications.get(span.parentSpanId) : undefined;
    const sourceEntityId = parent?.entityId ?? "user";
    const targetEntityId = classification.entityId;
    const edgeId = `edge:${sourceEntityId}:${targetEntityId}`;
    if (sourceEntityId !== targetEntityId && !edges.has(edgeId)) {
      edges.set(edgeId, {
        id: edgeId,
        source: sourceEntityId,
        target: targetEntityId,
        label: classification.category,
        kind: "runtime",
      });
    }
    const sanitized = sanitizeValue({
      attributes: span.attributes,
      resource: span.resource,
      scope: span.scope,
      status: { code: span.statusCode, message: span.statusMessage },
    });
    redactedFields += sanitized.stats.redactedFields;
    truncatedFields += sanitized.stats.truncatedFields;
    const failed = span.statusCode === 2;
    const inputTokens = tokenCount(span, [
      "llm.token_count.prompt",
      "gen_ai.usage.input_tokens",
      "gen_ai.usage.prompt_tokens",
    ]);
    const outputTokens = tokenCount(span, [
      "llm.token_count.completion",
      "gen_ai.usage.output_tokens",
      "gen_ai.usage.completion_tokens",
    ]);
    const sourceFile =
      text(span.attributes["code.file.path"]) ??
      text(span.attributes["code.filepath"]) ??
      text(span.attributes["source.file.name"]);
    const route = text(span.attributes["http.route"]) ?? text(span.attributes["url.path"]);
    const event: RuntimeEvent = {
      id: `span:${span.spanId}`,
      traceId,
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      timestamp: Math.max(0, span.startMs - origin),
      durationMs: Math.max(0, span.endMs - span.startMs),
      category: failed ? "error" : classification.category,
      action: failed ? `${classification.action}.error` : classification.action,
      sourceEntityId,
      targetEntityId,
      metadata: {
        spanName: span.name,
        spanKind: span.kind,
        status: failed ? "error" : span.statusCode === 1 ? "ok" : "unset",
        absoluteStartMs: span.startMs,
        absoluteEndMs: span.endMs,
        inputTokens,
        outputTokens,
        serviceName: text(span.resource["service.name"]) ?? serviceName,
        ...(classification.openInferenceKind
          ? { openInferenceSpanKind: classification.openInferenceKind }
          : {}),
        ...(sourceFile ? { file: sourceFile, files: [sourceFile] } : {}),
        ...(route ? { route } : {}),
        ...(text(span.attributes["db.system"])
          ? { dbSystem: text(span.attributes["db.system"]) }
          : {}),
        sanitized: sanitized.value,
      },
    };
    events.push(event);
    rawEvents[event.id] = sanitized.value;
  }

  if (redactedFields > 0)
    diagnostics.push({
      severity: "info",
      code: "privacy.redacted",
      message: `Redacted ${redactedFields} sensitive telemetry field${redactedFields === 1 ? "" : "s"}.`,
      count: redactedFields,
    });
  if (truncatedFields > 0)
    diagnostics.push({
      severity: "info",
      code: "payload.truncated",
      message: `Truncated ${truncatedFields} oversized telemetry field${truncatedFields === 1 ? "" : "s"}.`,
      count: truncatedFields,
    });
  if (unsupportedOpenInferenceKinds > 0)
    diagnostics.push({
      severity: "warning",
      code: "span.unsupported-openinference-kind",
      message: `Preserved ${unsupportedOpenInferenceKinds} span${unsupportedOpenInferenceKinds === 1 ? "" : "s"} with unknown OpenInference kinds as generic service activity.`,
      count: unsupportedOpenInferenceKinds,
    });

  const inputTokens = events.reduce(
    (total, event) => total + (number(event.metadata?.inputTokens) ?? 0),
    0,
  );
  const outputTokens = events.reduce(
    (total, event) => total + (number(event.metadata?.outputTokens) ?? 0),
    0,
  );
  const errors = events.filter((event) => event.category === "error").length;
  const root = spans.find((span) => !span.parentSpanId) ?? spans[0];
  const prompt =
    text(root?.attributes["input.value"]) ??
    text(root?.attributes["prompt"]) ??
    "Observed telemetry trace";
  const architecture = ArchitectureGraphSchema.parse({
    id: `${kind}:${traceId}`,
    title: serviceName,
    entities: [...entities.values()],
    edges: [...edges.values()],
  });
  const run = RunSchema.parse({
    id: traceId,
    title: `${serviceName} · ${root?.name ?? "trace"}`,
    prompt: prompt.slice(0, 2_000),
    startedAt: new Date(origin).toISOString(),
    endedAt: new Date(end).toISOString(),
    totalDurationMs: Math.max(0, end - origin),
    inputTokens: inputTokens > 0 ? inputTokens : null,
    outputTokens: outputTokens > 0 ? outputTokens : null,
    estimatedCostUsd: null,
    toolCallCount: events.filter((event) =>
      ["tool", "mcp", "retrieval", "database", "web"].includes(event.category),
    ).length,
    modelCallCount: events.filter((event) => event.category === "model").length,
    status: errors > 0 ? "error" : "completed",
    events,
  });
  return {
    source: runtimeSources[kind],
    session: {
      id: traceId,
      source: kind,
      title: run.title,
      startedAt: run.startedAt,
      modifiedAt: new Date().toISOString(),
      status: run.status === "running" || run.status === "queued" ? "active" : run.status,
      serviceName,
      eventCount: events.length,
      traceId,
    },
    architecture,
    run,
    rawEvents,
    diagnostics,
  };
}

export function normalizeTraces(spans: readonly CanonicalSpan[]) {
  const grouped = new Map<string, CanonicalSpan[]>();
  for (const span of spans) grouped.set(span.traceId, [...(grouped.get(span.traceId) ?? []), span]);
  return [...grouped.values()].map(normalizeTrace);
}
