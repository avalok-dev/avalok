import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalRuntimeStore, normalizeTraces, parseOtlpJson } from "../src";

const nanos = (milliseconds: number) => String(BigInt(milliseconds) * 1_000_000n);
const kv = (key: string, value: string | number | boolean) => ({
  key,
  value:
    typeof value === "string"
      ? { stringValue: value }
      : typeof value === "number"
        ? { intValue: String(value) }
        : { boolValue: value },
});

function request(spans: Array<Record<string, unknown>>, service = "fixture-ai-app") {
  return {
    resourceSpans: [
      {
        resource: { attributes: [kv("service.name", service)] },
        scopeSpans: [{ scope: { name: "fixture" }, spans }],
      },
    ],
  };
}

const span = (
  spanId: string,
  name: string,
  start: number,
  end: number,
  attributes: Array<Record<string, unknown>> = [],
  parentSpanId?: string,
) => ({
  traceId: "0123456789abcdef0123456789abcdef",
  spanId,
  ...(parentSpanId ? { parentSpanId } : {}),
  name,
  startTimeUnixNano: nanos(start),
  endTimeUnixNano: nanos(end),
  attributes,
  status: { code: 1 },
});

describe("OTLP JSON ingestion", () => {
  it("preserves hierarchy and classifies OpenInference spans", () => {
    const payload = request([
      span("0000000000000001", "research", 1_000, 2_000, [kv("openinference.span.kind", "AGENT")]),
      span(
        "0000000000000002",
        "retrieve",
        1_100,
        1_300,
        [kv("openinference.span.kind", "RETRIEVER")],
        "0000000000000001",
      ),
      span(
        "0000000000000003",
        "chat",
        1_400,
        1_900,
        [
          kv("openinference.span.kind", "LLM"),
          kv("llm.model_name", "fixture-model"),
          kv("llm.token_count.prompt", 12),
          kv("llm.token_count.completion", 5),
        ],
        "0000000000000001",
      ),
    ]);
    const parsed = parseOtlpJson(payload);
    const snapshot = normalizeTraces(parsed.spans)[0];
    expect(parsed.malformed).toBe(0);
    expect(snapshot?.run.events).toHaveLength(3);
    expect(snapshot?.run.events[1]?.parentSpanId).toBe("0000000000000001");
    expect(snapshot?.run.events.map((event) => event.category)).toEqual([
      "agent",
      "retrieval",
      "model",
    ]);
    expect(snapshot?.run.inputTokens).toBe(12);
    expect(snapshot?.run.outputTokens).toBe(5);
    expect(snapshot?.run.estimatedCostUsd).toBeNull();
  });

  it("keeps generic HTTP and database spans conservative", () => {
    const parsed = parseOtlpJson(
      request([
        {
          ...span("0000000000000001", "POST /ask", 1_000, 2_000, [
            kv("http.request.method", "POST"),
            kv("http.route", "/ask"),
          ]),
          kind: 2,
        },
        span(
          "0000000000000002",
          "SELECT documents",
          1_100,
          1_200,
          [kv("db.system", "sqlite")],
          "0000000000000001",
        ),
      ]),
    );
    const snapshot = normalizeTraces(parsed.spans)[0];
    expect(snapshot?.run.events.map((event) => event.category)).toEqual(["http", "database"]);
    expect(snapshot?.run.events.some((event) => event.category === "agent")).toBe(false);
  });

  it("handles errors, missing attributes, unknown attributes, and malformed spans", () => {
    const failed = {
      ...span("0000000000000001", "failed operation", 1_000, 1_010, [
        kv("unknown.attribute", "kept"),
      ]),
      status: { code: 2, message: "failed" },
    };
    const payload = request([failed, { traceId: "missing-fields" }]);
    const parsed = parseOtlpJson(payload);
    const snapshot = normalizeTraces(parsed.spans)[0];
    expect(parsed.malformed).toBe(1);
    expect(snapshot?.run.status).toBe("error");
    expect(snapshot?.run.events[0]?.category).toBe("error");
    expect(JSON.stringify(snapshot?.rawEvents)).toContain("unknown.attribute");
  });

  it("does not imply AI semantics for ordinary or unknown OpenInference spans", () => {
    const parsed = parseOtlpJson(
      request([
        span("0000000000000001", "cache refresh", 1_000, 1_010),
        span("0000000000000002", "future kind", 1_020, 1_030, [
          kv("openinference.span.kind", "FUTURE_KIND"),
        ]),
      ]),
    );
    const snapshot = normalizeTraces(parsed.spans)[0];
    expect(snapshot?.run.events.map((event) => event.category)).toEqual(["service", "service"]);
    expect(snapshot?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "span.unsupported-openinference-kind", count: 1 }),
    );
  });

  it("redacts secrets and marks truncation before raw display", () => {
    const parsed = parseOtlpJson(
      request([
        span("0000000000000001", "safe", 1_000, 1_010, [
          kv("authorization", "Bearer fake-secret"),
          kv("output.value", "x".repeat(5_000)),
        ]),
      ]),
    );
    const snapshot = normalizeTraces(parsed.spans)[0];
    const raw = JSON.stringify(snapshot?.rawEvents);
    expect(raw).not.toContain("fake-secret");
    expect(raw).toContain("[REDACTED]");
    expect(raw).toContain('"truncated":true');
    expect(snapshot?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "privacy.redacted",
      "payload.truncated",
    ]);
  });

  it("separates multiple traces", () => {
    const first = span("0000000000000001", "one", 1_000, 1_010);
    const second = {
      ...span("0000000000000002", "two", 2_000, 2_010),
      traceId: "fedcba9876543210fedcba9876543210",
    };
    const parsed = parseOtlpJson(request([first, second]));
    expect(normalizeTraces(parsed.spans)).toHaveLength(2);
  });

  it("normalizes thousands of spans with stable service topology", () => {
    const manySpans = Array.from({ length: 2_000 }, (_, index) =>
      span(
        (index + 1).toString(16).padStart(16, "0"),
        `operation ${index}`,
        1_000 + index,
        1_001 + index,
      ),
    );
    const snapshot = normalizeTraces(parseOtlpJson(request(manySpans)).spans)[0];
    expect(snapshot?.run.events).toHaveLength(2_000);
    expect(
      snapshot?.architecture.entities.filter((entity) => entity.kind === "service"),
    ).toHaveLength(1);
    expect(new Set(snapshot?.run.events.map((event) => event.id)).size).toBe(2_000);
  });

  it("rejects non-envelope payloads without throwing", () => {
    expect(parseOtlpJson({ no: "resource spans" })).toEqual({ spans: [], malformed: 1 });
    expect(parseOtlpJson(null)).toEqual({ spans: [], malformed: 1 });
  });
});

describe("local runtime storage", () => {
  it("persists and concurrently merges batches for refresh-safe replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentmap-runtime-"));
    const store = new LocalRuntimeStore(directory);
    const first = normalizeTraces(
      parseOtlpJson(
        request([
          span("0000000000000001", "root", 1_000, 2_000, [kv("openinference.span.kind", "AGENT")]),
        ]),
      ).spans,
    )[0]!;
    const second = normalizeTraces(
      parseOtlpJson(
        request([
          span(
            "0000000000000002",
            "tool",
            1_100,
            1_200,
            [kv("openinference.span.kind", "TOOL")],
            "0000000000000001",
          ),
        ]),
      ).spans,
    )[0]!;
    await Promise.all([store.upsert(first), store.upsert(second)]);
    const loaded = await store.load("telemetry", first.session.id);
    expect(loaded?.run.events).toHaveLength(2);
    expect((await store.list("telemetry"))[0]?.eventCount).toBe(2);
    const files = await import("node:fs/promises").then(({ readdir }) => readdir(directory));
    expect(files).toHaveLength(1);
    const persisted = await readFile(join(directory, files[0]!), "utf8");
    expect(() => JSON.parse(persisted)).not.toThrow();
  });
});
