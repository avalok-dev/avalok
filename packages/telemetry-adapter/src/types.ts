export interface OtlpAnyValue {
  stringValue?: unknown;
  boolValue?: unknown;
  intValue?: unknown;
  doubleValue?: unknown;
  bytesValue?: unknown;
  arrayValue?: { values?: OtlpAnyValue[] };
  kvlistValue?: { values?: OtlpKeyValue[] };
}

export interface OtlpKeyValue {
  key?: unknown;
  value?: OtlpAnyValue;
}

export interface OtlpStatus {
  code?: unknown;
  message?: unknown;
}

export interface OtlpSpan {
  traceId?: unknown;
  spanId?: unknown;
  parentSpanId?: unknown;
  name?: unknown;
  kind?: unknown;
  startTimeUnixNano?: unknown;
  endTimeUnixNano?: unknown;
  attributes?: OtlpKeyValue[];
  status?: OtlpStatus;
  events?: unknown;
}

export interface OtlpScopeSpans {
  scope?: { name?: unknown; version?: unknown };
  spans?: OtlpSpan[];
}

export interface OtlpResourceSpans {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeSpans?: OtlpScopeSpans[];
  instrumentationLibrarySpans?: OtlpScopeSpans[];
}

export interface OtlpExportTraceServiceRequest {
  resourceSpans?: OtlpResourceSpans[];
}

export interface CanonicalSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startMs: number;
  endMs: number;
  statusCode?: number;
  statusMessage?: string;
  attributes: Record<string, unknown>;
  resource: Record<string, unknown>;
  scope?: { name?: string; version?: string };
}

export interface TelemetryIngestionDiagnostics {
  spansReceived: number;
  spansNormalized: number;
  unsupportedSpans: number;
  malformedPayloads: number;
  redactedFields: number;
  truncatedFields: number;
  activeServices: string[];
  lastReceivedAt?: string;
}
