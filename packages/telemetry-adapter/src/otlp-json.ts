import type {
  CanonicalSpan,
  OtlpAnyValue,
  OtlpExportTraceServiceRequest,
  OtlpKeyValue,
} from "./types.ts";

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function anyValue(value: OtlpAnyValue | undefined): unknown {
  if (!value) return undefined;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.boolValue === "boolean") return value.boolValue;
  if (typeof value.intValue === "string" || typeof value.intValue === "number")
    return Number(value.intValue);
  if (typeof value.doubleValue === "number") return value.doubleValue;
  if (typeof value.bytesValue === "string") return value.bytesValue;
  if (Array.isArray(value.arrayValue?.values)) return value.arrayValue.values.map(anyValue);
  if (Array.isArray(value.kvlistValue?.values)) return attributes(value.kvlistValue.values);
  return undefined;
}

export function attributes(values: OtlpKeyValue[] | undefined) {
  const result: Record<string, unknown> = {};
  for (const item of values ?? []) {
    if (typeof item?.key !== "string") continue;
    result[item.key] = anyValue(item.value);
  }
  return result;
}

function nanosToMs(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  try {
    return Number(BigInt(value) / 1_000_000n);
  } catch {
    return undefined;
  }
}

const stringValue = (value: unknown) => (typeof value === "string" ? value : undefined);
const numberValue = (value: unknown) =>
  typeof value === "number" ? value : typeof value === "string" ? Number(value) : undefined;

export function parseOtlpJson(payload: unknown): {
  spans: CanonicalSpan[];
  malformed: number;
} {
  const root = objectValue(payload) as OtlpExportTraceServiceRequest | undefined;
  if (!root || !Array.isArray(root.resourceSpans)) return { spans: [], malformed: 1 };
  const spans: CanonicalSpan[] = [];
  let malformed = 0;
  for (const resourceSpans of root.resourceSpans) {
    const resource = attributes(resourceSpans.resource?.attributes);
    const groups = [
      ...(resourceSpans.scopeSpans ?? []),
      ...(resourceSpans.instrumentationLibrarySpans ?? []),
    ];
    for (const group of groups) {
      const scopeName = stringValue(group.scope?.name);
      const scopeVersion = stringValue(group.scope?.version);
      for (const span of group.spans ?? []) {
        const traceId = stringValue(span.traceId);
        const spanId = stringValue(span.spanId);
        const parentSpanId = stringValue(span.parentSpanId);
        const name = stringValue(span.name);
        const startMs = nanosToMs(span.startTimeUnixNano);
        const endMs = nanosToMs(span.endTimeUnixNano);
        const kind = numberValue(span.kind);
        const statusCode = numberValue(span.status?.code);
        const statusMessage = stringValue(span.status?.message);
        if (!traceId || !spanId || !name || startMs === undefined || endMs === undefined) {
          malformed += 1;
          continue;
        }
        spans.push({
          traceId,
          spanId,
          ...(parentSpanId ? { parentSpanId } : {}),
          name,
          ...(kind !== undefined && Number.isFinite(kind) ? { kind } : {}),
          startMs,
          endMs: Math.max(startMs, endMs),
          ...(statusCode !== undefined && Number.isFinite(statusCode) ? { statusCode } : {}),
          ...(statusMessage ? { statusMessage } : {}),
          attributes: attributes(span.attributes),
          resource,
          ...(scopeName || scopeVersion
            ? {
                scope: {
                  ...(scopeName ? { name: scopeName } : {}),
                  ...(scopeVersion ? { version: scopeVersion } : {}),
                },
              }
            : {}),
        });
      }
    }
  }
  return { spans, malformed };
}
