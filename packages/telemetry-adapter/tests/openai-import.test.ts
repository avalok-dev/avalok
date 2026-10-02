import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateRunObservability,
  importOpenAiTraceFiles,
  LocalRuntimeStore,
  parseOpenAiTracePage,
} from "../src";

const kv = (key: string, value: string | number) => ({
  key,
  value: typeof value === "number" ? { intValue: String(value) } : { stringValue: value },
});
const span = (
  id: string,
  name: string,
  start: number,
  end: number,
  type: string,
  parent?: string,
  extras: ReturnType<typeof kv>[] = [],
  failed = false,
) => ({
  traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  spanId: id,
  ...(parent ? { parentSpanId: parent } : {}),
  name,
  startTimeUnixNano: String(BigInt(start) * 1_000_000n),
  endTimeUnixNano: String(BigInt(end) * 1_000_000n),
  attributes: [kv("openai.span.type", type), ...extras],
  status: { code: failed ? 2 : 1 },
});
const page = (spans: ReturnType<typeof span>[]) => ({
  object: "list",
  data: [
    {
      object: "agent.session.trace",
      id: "turn_fixture",
      session_id: "sess_fixture",
      created_at: 1,
      otlp: {
        resourceSpans: [
          { resource: { attributes: [kv("service.name", "fixture")] }, scopeSpans: [{ spans }] },
        ],
      },
    },
  ],
  first_id: "turn_fixture",
  last_id: "turn_fixture",
  has_more: false,
});

describe("saved OpenAI Agents API trace pages", () => {
  it("rejects a bare OTLP request and skips malformed page entries", () => {
    expect(parseOpenAiTracePage({ resourceSpans: [] }).malformed).toBe(1);
    expect(parseOpenAiTracePage({ object: "list", data: [{ id: "bad" }] }).malformed).toBe(1);
    expect(
      parseOpenAiTracePage({
        object: "list",
        data: [
          {
            object: "agent.session.trace",
            id: "turn",
            session_id: "sess",
            otlp: { resourceSpans: [null] },
          },
        ],
      }).malformed,
    ).toBe(1);
  });

  it("imports partial pages, repairs hierarchy, deduplicates spans, and updates late usage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sarvadrik-openai-"));
    const store = new LocalRuntimeStore(join(dir, "runtime"));
    const root = span("0000000000000001", "root", 1000, 2000, "agent", undefined, [
      kv("agent.name", "Root"),
      kv("openai.agent.id", "agent_root"),
      kv("gen_ai.usage.input_tokens", 20),
      kv("gen_ai.usage.output_tokens", 4),
    ]);
    const subA = span("0000000000000002", "sub A", 1100, 1600, "agent", root.spanId, [
      kv("agent.name", "Research"),
      kv("openai.subagent.id", "sub_a"),
      kv("gen_ai.usage.input_tokens", 7),
    ]);
    const subB = span("0000000000000003", "sub B", 1150, 1700, "agent", root.spanId, [
      kv("agent.name", "Review"),
      kv("openai.subagent.id", "sub_b"),
    ]);
    const model = span("0000000000000004", "generation", 1200, 1300, "generation", subA.spanId, [
      kv("gen_ai.request.model", "fixture-model"),
      kv("gen_ai.usage.input_tokens", 7),
      kv("gen_ai.usage.output_tokens", 2),
    ]);
    const mcp = span("0000000000000005", "lookup", 1350, 1400, "tool", subA.spanId, [
      kv("tool.name", "lookup"),
      kv("mcp.server_label", "local_docs"),
      kv("authorization", "Bearer private-key"),
    ]);
    const failed = span(
      "0000000000000006",
      "search",
      1250,
      1260,
      "tool",
      subB.spanId,
      [kv("tool.name", "search")],
      true,
    );
    const retry = span("0000000000000007", "search", 1270, 1280, "tool", subB.spanId, [
      kv("tool.name", "search"),
      kv("retry.attempt", 2),
    ]);
    const missingUsage = span(
      "0000000000000008",
      "generation",
      1450,
      1500,
      "generation",
      subB.spanId,
      [kv("gen_ai.request.model", "fixture-model")],
    );
    const firstPath = join(dir, "first.json");
    const secondPath = join(dir, "second.json");
    await writeFile(
      firstPath,
      JSON.stringify(page([subA, subB, model, mcp, failed, retry, missingUsage])),
    );
    await writeFile(secondPath, JSON.stringify(page([root, model])));
    expect((await importOpenAiTraceFiles([firstPath], store)).spans).toBe(7);
    const partial = await store.load("telemetry", root.traceId);
    expect(
      partial?.run.events.find((event) => event.spanId === subA.spanId)?.sourceEntityId,
    ).toBeUndefined();
    await importOpenAiTraceFiles([secondPath], store);
    const complete = await store.load("telemetry", root.traceId);
    expect(complete?.run.events).toHaveLength(8);
    expect(complete?.run.events.find((event) => event.spanId === subA.spanId)?.sourceEntityId).toBe(
      "agent:agent-root",
    );
    expect(complete?.run.events.find((event) => event.spanId === subB.spanId)?.sourceEntityId).toBe(
      "agent:agent-root",
    );
    expect(complete?.run.inputTokens).toBe(27); // Root and subagent summaries; generation is not added twice.
    expect(complete?.run.outputTokens).toBe(6); // Root summary plus subagent model usage.
    expect(JSON.stringify(complete)).not.toContain("private-key");
    expect(
      complete?.run.events.find((event) => event.spanId === missingUsage.spanId)?.metadata
        ?.inputTokens,
    ).toBeUndefined();
    const metrics = aggregateRunObservability(complete!.run);
    expect(metrics.run.callCount).toBe(8);
    expect(metrics.run.failures).toBe(1);
    expect(metrics.nodes["tool:search"]?.callCount).toBe(2);
    expect(metrics.nodes["tool:search"]?.observedRetries).toBe(1);
    expect(metrics.nodes["tool:search"]?.repeatedAttempts).toBe(1);
    expect(metrics.nodes["tool:search"]?.p50LatencyMs).toBe(10);
    expect(metrics.edges["edge:agent:sub-b:tool:search"]?.failureRate).toBe(0.5);
    const before = JSON.stringify(complete);
    await importOpenAiTraceFiles([firstPath, secondPath], store);
    expect(JSON.stringify(await store.load("telemetry", root.traceId))).toBe(before);

    const latePath = join(dir, "late.json");
    const lateModel = span(model.spanId, "generation", 1200, 1300, "generation", subA.spanId, [
      kv("gen_ai.request.model", "fixture-model"),
      kv("gen_ai.usage.input_tokens", 9),
      kv("gen_ai.usage.output_tokens", 3),
    ]);
    await writeFile(latePath, JSON.stringify(page([lateModel])));
    await importOpenAiTraceFiles([latePath], store);
    const updated = await store.load("telemetry", root.traceId);
    expect(updated?.run.outputTokens).toBe(7);
    await importOpenAiTraceFiles([firstPath], store);
    expect((await store.load("telemetry", root.traceId))?.run.outputTokens).toBe(7);
  });
});
