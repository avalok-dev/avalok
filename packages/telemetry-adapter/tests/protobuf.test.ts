import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeOtlpStatus,
  decodeOtlpTraceProtobuf,
  decodeOtlpTraceResponse,
  encodeOtlpStatus,
  encodeOtlpTraceResponse,
  normalizeTraces,
  OtlpProtobufDecodeError,
  parseOtlpJson,
} from "../src";
import { otlpTraceDescriptor } from "../src/otlp-proto-descriptor";
import { sdkJsonPayload, sdkProtobufPayload } from "./otel-sdk-fixture";
// @ts-expect-error The generator is a plain ESM script without type declarations.
import { loadOtlpDescriptor } from "../scripts/generate-otlp-descriptor.mjs";

const fixturePath = join(import.meta.dirname, "fixtures", "openinference-trace.otlp.pb");

function normalizeProtobuf(bytes: Uint8Array) {
  const parsed = parseOtlpJson(decodeOtlpTraceProtobuf(bytes));
  return { parsed, snapshots: normalizeTraces(parsed.spans) };
}

describe("OTLP protobuf ingestion", () => {
  it("keeps the checked-in descriptor identical to the vendored official .proto files", () => {
    expect(JSON.parse(JSON.stringify(otlpTraceDescriptor))).toEqual(loadOtlpDescriptor());
  });

  it("decodes SDK-encoded protobuf into the same canonical request as the SDK JSON encoding", () => {
    const fromProtobuf = parseOtlpJson(decodeOtlpTraceProtobuf(sdkProtobufPayload()));
    const fromJson = parseOtlpJson(sdkJsonPayload());
    expect(fromProtobuf.malformed).toBe(0);
    expect(fromProtobuf.spans).toHaveLength(3);
    expect(fromProtobuf.spans).toEqual(fromJson.spans);
  });

  it("preserves hierarchy, resource, scope, status, timestamps, and OpenInference tokens", () => {
    const { parsed, snapshots } = normalizeProtobuf(sdkProtobufPayload());
    const [snapshot] = snapshots;
    const byName = Object.fromEntries(parsed.spans.map((span) => [span.name, span]));
    expect(byName["research agent"]?.parentSpanId).toBeUndefined();
    expect(byName["chat completion"]?.parentSpanId).toBe(byName["research agent"]?.spanId);
    expect(byName["chat completion"]?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(byName["chat completion"]?.startMs).toBe(1_760_000_000_100);
    expect(byName["chat completion"]?.endMs).toBe(1_760_000_000_600);
    expect(byName["research agent"]?.kind).toBe(2);
    expect(byName["search tool"]?.statusCode).toBe(2);
    expect(byName["search tool"]?.statusMessage).toBe("tool failed");
    expect(byName["chat completion"]?.resource["service.name"]).toBe(
      "python-standard-exporter-shape",
    );
    expect(byName["chat completion"]?.scope).toEqual({
      name: "agentmap.protobuf.fixture",
      version: "1.2.3",
    });
    expect(byName["chat completion"]?.attributes).toMatchObject({
      "llm.token_count.prompt": 42,
      "list.attribute": ["a", "b"],
      "ratio.attribute": 0.25,
      "flag.attribute": true,
    });
    expect(snapshot?.session.serviceName).toBe("python-standard-exporter-shape");
    expect(snapshot?.run.events.map((event) => event.category)).toEqual([
      "agent",
      "model",
      "error",
    ]);
    expect(snapshot?.run.inputTokens).toBe(42);
    expect(snapshot?.run.outputTokens).toBe(7);
    expect(snapshot?.run.status).toBe("error");
  });

  it("redacts secrets arriving over protobuf", () => {
    const [snapshot] = normalizeProtobuf(sdkProtobufPayload()).snapshots;
    const raw = JSON.stringify(snapshot?.rawEvents);
    expect(raw).not.toContain("protobuf-secret-token");
    expect(raw).toContain("[REDACTED]");
  });

  it("treats an empty protobuf body as a valid empty export", () => {
    const decoded = decodeOtlpTraceProtobuf(new Uint8Array());
    expect(decoded).toEqual({ resourceSpans: [] });
    expect(parseOtlpJson(decoded)).toEqual({ spans: [], malformed: 0 });
  });

  it("rejects malformed and truncated protobuf without throwing unexpected errors", () => {
    const valid = sdkProtobufPayload();
    for (const bytes of [
      valid.subarray(0, valid.length - 5),
      Uint8Array.from([0x0a, 0xff, 0xff, 0xff, 0xff, 0x0f]),
      new TextEncoder().encode('{"resourceSpans":[]}'),
      Uint8Array.from([0x0f]),
    ])
      expect(() => decodeOtlpTraceProtobuf(bytes)).toThrow(OtlpProtobufDecodeError);
  });

  it("encodes standards-shaped success, partial-success, and status responses", () => {
    expect(encodeOtlpTraceResponse()).toHaveLength(0);
    expect(
      decodeOtlpTraceResponse(
        encodeOtlpTraceResponse({
          rejectedSpans: 2,
          errorMessage: "Malformed spans were ignored.",
        }),
      ),
    ).toEqual({
      partialSuccess: { rejectedSpans: "2", errorMessage: "Malformed spans were ignored." },
    });
    expect(decodeOtlpStatus(encodeOtlpStatus(3, "bad request"))).toEqual({
      code: 3,
      message: "bad request",
    });
  });

  it("ships a deterministic protobuf fixture that matches the SDK encoder", async () => {
    const fixture = new Uint8Array(await readFile(fixturePath));
    expect(Buffer.from(fixture).equals(Buffer.from(sdkProtobufPayload()))).toBe(true);
    const [snapshot] = normalizeProtobuf(fixture).snapshots;
    expect(snapshot?.run.events).toHaveLength(3);
  });
});
