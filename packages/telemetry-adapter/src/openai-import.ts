import { readFile, stat } from "node:fs/promises";
import { parseOtlpJson } from "./otlp-json.ts";
import { normalizeTrace } from "./normalizer.ts";
import { LocalRuntimeStore } from "./store.ts";
import type { CanonicalSpan } from "./types.ts";
import { aggregateRunObservability } from "./observability.ts";
import { sanitizeValue } from "@visual-system/runtime-adapter";

interface ImportedTrace {
  sessionId: string;
  turnId: string;
  spans: CanonicalSpan[];
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Parse a saved public Agents API page, never an undocumented dashboard response. */
export function parseOpenAiTracePage(payload: unknown): {
  traces: ImportedTrace[];
  malformed: number;
} {
  const page = record(payload);
  if (page?.object !== "list" || !Array.isArray(page.data)) return { traces: [], malformed: 1 };
  const traces: ImportedTrace[] = [];
  let malformed = 0;
  for (const item of page.data) {
    const trace = record(item);
    if (
      trace?.object !== "agent.session.trace" ||
      typeof trace.id !== "string" ||
      typeof trace.session_id !== "string" ||
      !record(trace.otlp)
    ) {
      malformed += 1;
      continue;
    }
    const parsed = parseOtlpJson(trace.otlp);
    const valid = parsed.spans.filter(
      (span) => /^[0-9a-f]{32}$/i.test(span.traceId) && /^[0-9a-f]{16}$/i.test(span.spanId),
    );
    malformed += parsed.malformed + parsed.spans.length - valid.length;
    if (valid.length)
      traces.push({
        sessionId: String(scrub(trace.session_id)),
        turnId: String(scrub(trace.id)),
        spans: valid,
      });
  }
  return { traces, malformed };
}

const richness = (span: CanonicalSpan) =>
  Object.keys(span.attributes).length + (span.parentSpanId ? 1 : 0) + (span.statusCode ? 1 : 0);

function scrub(value: unknown): unknown {
  if (typeof value === "string")
    return value.replace(/\bsk-[A-Za-z0-9_-]{8,}\b|Bearer\s+[A-Za-z0-9._-]+/gi, "[REDACTED]");
  if (Array.isArray(value)) return value.map(scrub);
  const object = record(value);
  if (object)
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, scrub(item)]));
  return value;
}

function safeSpan(span: CanonicalSpan): CanonicalSpan {
  return {
    ...span,
    name: String(scrub(span.name)).slice(0, 4_000),
    attributes: sanitizeValue(scrub(span.attributes)).value as Record<string, unknown>,
    resource: sanitizeValue(scrub(span.resource)).value as Record<string, unknown>,
    ...(span.scope ? { scope: scrub(span.scope) as NonNullable<CanonicalSpan["scope"]> } : {}),
    ...(span.statusMessage
      ? { statusMessage: String(scrub(span.statusMessage)).slice(0, 4_000) }
      : {}),
  };
}

/** Import bounded local files. No network access or API key is used by this path. */
export async function importOpenAiTraceFiles(
  paths: readonly string[],
  store = new LocalRuntimeStore(),
): Promise<{ files: number; traces: number; spans: number; malformed: number }> {
  if (!paths.length) throw new Error("Provide at least one saved trace page.");
  const grouped = new Map<
    string,
    { sessionId: string; turnId: string; spans: Map<string, CanonicalSpan> }
  >();
  let malformed = 0;
  for (const path of paths) {
    if ((await stat(path)).size > 20 * 1024 * 1024)
      throw new Error(`Trace page exceeds the 20 MiB local import limit: ${path}`);
    const bytes = await readFile(path);
    let payload: unknown;
    try {
      payload = JSON.parse(bytes.toString("utf8"));
    } catch {
      malformed += 1;
      continue;
    }
    const page = parseOpenAiTracePage(payload);
    malformed += page.malformed;
    for (const trace of page.traces) {
      for (const span of trace.spans) {
        const key = `${trace.sessionId}\0${trace.turnId}\0${span.traceId}`;
        let group = grouped.get(key);
        if (!group) {
          group = { sessionId: trace.sessionId, turnId: trace.turnId, spans: new Map() };
          grouped.set(key, group);
        }
        const safe = safeSpan(span);
        const previous = group.spans.get(safe.spanId);
        if (!previous || richness(safe) >= richness(previous)) group.spans.set(safe.spanId, safe);
      }
    }
  }
  let spans = 0;
  for (const group of grouped.values()) {
    spans += group.spans.size;
    const snapshot = normalizeTrace([...group.spans.values()], {
      imported: true,
      sessionId: group.sessionId,
      turnId: group.turnId,
    });
    const totals = aggregateRunObservability(snapshot.run).run;
    snapshot.run.inputTokens = totals.inputTokens;
    snapshot.run.outputTokens = totals.outputTokens;
    await store.upsert(snapshot);
  }
  return { files: paths.length, traces: grouped.size, spans, malformed };
}
