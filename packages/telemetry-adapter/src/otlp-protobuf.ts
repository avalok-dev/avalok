import Long from "long";
import protobuf from "protobufjs/light.js";
import { otlpTraceDescriptor } from "./otlp-proto-descriptor.ts";
import type { OtlpAnyValue, OtlpExportTraceServiceRequest, OtlpKeyValue } from "./types.ts";

// OTLP/HTTP binary protobuf support. Requests are decoded with the maintained `protobufjs`
// runtime against the official opentelemetry-proto definitions, then mapped onto the OTLP/JSON
// shape (hex IDs, base64 bytes, string 64-bit integers) so both encodings share one pipeline:
// decode → canonical OTLP request → `parseOtlpJson` → `normalizeTraces` → runtime store.

// Keep 64-bit timestamps exact (as decimal strings) regardless of how the bundler resolves
// protobufjs's optional `long` lookup.
protobuf.util.Long = Long;
protobuf.configure();

const root = protobuf.Root.fromJSON(otlpTraceDescriptor);
const requestType = root.lookupType(
  "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest",
);
const responseType = root.lookupType(
  "opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse",
);
const statusType = root.lookupType("google.rpc.Status");

export const OTLP_PROTOBUF_CONTENT_TYPE = "application/x-protobuf";

export class OtlpProtobufDecodeError extends Error {}

type Decoded = Record<string, unknown>;

const hex = (value: unknown) =>
  value instanceof Uint8Array ? Buffer.from(value).toString("hex") : undefined;

function anyValue(value: Decoded | undefined): OtlpAnyValue | undefined {
  if (!value) return undefined;
  if ("stringValue" in value) return { stringValue: value.stringValue };
  if ("boolValue" in value) return { boolValue: value.boolValue };
  if ("intValue" in value) return { intValue: value.intValue };
  if ("doubleValue" in value) return { doubleValue: value.doubleValue };
  if ("bytesValue" in value)
    return {
      bytesValue:
        value.bytesValue instanceof Uint8Array
          ? Buffer.from(value.bytesValue).toString("base64")
          : value.bytesValue,
    };
  if ("arrayValue" in value)
    return {
      arrayValue: {
        values: (((value.arrayValue as Decoded)?.values as Decoded[]) ?? []).map(
          (item) => anyValue(item) ?? {},
        ),
      },
    };
  if ("kvlistValue" in value)
    return { kvlistValue: { values: keyValues((value.kvlistValue as Decoded)?.values) } };
  return {};
}

function keyValues(values: unknown): OtlpKeyValue[] {
  return ((values as Decoded[] | undefined) ?? []).map((item) => {
    const value = anyValue(item.value as Decoded | undefined);
    return { key: item.key, ...(value ? { value } : {}) };
  });
}

function span(value: Decoded) {
  const status = value.status as Decoded | undefined;
  return {
    traceId: hex(value.traceId),
    spanId: hex(value.spanId),
    // An absent or empty parent means a root span, matching OTLP/JSON's omitted field.
    ...(value.parentSpanId instanceof Uint8Array && value.parentSpanId.length > 0
      ? { parentSpanId: hex(value.parentSpanId) }
      : {}),
    ...(typeof value.traceState === "string" && value.traceState
      ? { traceState: value.traceState }
      : {}),
    name: value.name,
    // Absent proto3 fields stay absent, exactly as an OTLP/JSON exporter would omit them.
    ...(value.kind !== undefined ? { kind: value.kind } : {}),
    ...(value.startTimeUnixNano !== undefined
      ? { startTimeUnixNano: value.startTimeUnixNano }
      : {}),
    ...(value.endTimeUnixNano !== undefined ? { endTimeUnixNano: value.endTimeUnixNano } : {}),
    attributes: keyValues(value.attributes),
    ...(status ? { status: { code: status.code ?? 0, message: status.message } } : {}),
    events: ((value.events as Decoded[] | undefined) ?? []).map((event) => ({
      timeUnixNano: event.timeUnixNano,
      name: event.name,
      attributes: keyValues(event.attributes),
    })),
  };
}

/**
 * Decodes an OTLP `ExportTraceServiceRequest` protobuf body into the OTLP/JSON request shape.
 * Throws `OtlpProtobufDecodeError` for bytes that are not a valid message.
 */
export function decodeOtlpTraceProtobuf(body: Uint8Array): OtlpExportTraceServiceRequest {
  let decoded: Decoded;
  try {
    const message = requestType.decode(body);
    decoded = requestType.toObject(message, {
      longs: String,
      enums: Number,
      bytes: Uint8Array,
      arrays: true,
      defaults: false,
    }) as Decoded;
  } catch (error) {
    throw new OtlpProtobufDecodeError(
      `Malformed OTLP protobuf payload: ${error instanceof Error ? error.message : "decode failed"}.`,
    );
  }
  return {
    resourceSpans: ((decoded.resourceSpans as Decoded[]) ?? []).map((resourceSpans) => ({
      resource: {
        attributes: keyValues((resourceSpans.resource as Decoded | undefined)?.attributes),
      },
      scopeSpans: ((resourceSpans.scopeSpans as Decoded[] | undefined) ?? []).map((scopeSpans) => {
        const scope = scopeSpans.scope as Decoded | undefined;
        return {
          ...(scope ? { scope: { name: scope.name, version: scope.version } } : {}),
          spans: ((scopeSpans.spans as Decoded[] | undefined) ?? []).map(span),
        };
      }),
    })),
  } as OtlpExportTraceServiceRequest;
}

/** Encodes an `ExportTraceServiceResponse`; an empty message signals full success. */
export function encodeOtlpTraceResponse(partialSuccess?: {
  rejectedSpans: number;
  errorMessage: string;
}): Uint8Array {
  return responseType
    .encode(
      responseType.fromObject(
        partialSuccess
          ? {
              partialSuccess: {
                rejectedSpans: String(partialSuccess.rejectedSpans),
                errorMessage: partialSuccess.errorMessage,
              },
            }
          : {},
      ),
    )
    .finish();
}

/** Encodes the `google.rpc.Status` body OTLP/HTTP uses for protobuf error responses. */
export function encodeOtlpStatus(code: number, message: string): Uint8Array {
  return statusType.encode(statusType.fromObject({ code, message })).finish();
}

/** Test/diagnostic helper: decodes a response body produced by `encodeOtlpTraceResponse`. */
export function decodeOtlpTraceResponse(body: Uint8Array) {
  return responseType.toObject(responseType.decode(body), { longs: String }) as {
    partialSuccess?: { rejectedSpans?: string; errorMessage?: string };
  };
}

/** Test/diagnostic helper: decodes a `google.rpc.Status` error body. */
export function decodeOtlpStatus(body: Uint8Array) {
  return statusType.toObject(statusType.decode(body)) as { code?: number; message?: string };
}
