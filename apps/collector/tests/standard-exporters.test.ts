import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { OTLPTraceExporter as HttpJsonExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as HttpProtobufExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { LocalRuntimeStore } from "@visual-system/telemetry-adapter";
import { createCollectorServer } from "../src/server";

const servers: ReturnType<typeof createCollectorServer>[] = [];
afterEach(async () =>
  Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  ),
);

async function exportWith(kind: "protobuf" | "json") {
  const store = new LocalRuntimeStore(await mkdtemp(join(tmpdir(), "agentmap-exporter-")));
  const server = createCollectorServer({ store });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/traces`;
  const exporter =
    kind === "protobuf" ? new HttpProtobufExporter({ url }) : new HttpJsonExporter({ url });
  const results: number[] = [];
  const original = exporter.export.bind(exporter);
  exporter.export = (spans, done) =>
    original(spans, (result) => {
      results.push(result.code);
      done(result);
    });
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ "service.name": `node-${kind}-exporter` }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer("agentmap.standard-exporter-test");
  tracer.startActiveSpan(
    "agent run",
    { attributes: { "openinference.span.kind": "AGENT" } },
    (agent) => {
      tracer
        .startSpan(
          "chat completion",
          {
            attributes: {
              "openinference.span.kind": "LLM",
              "llm.model_name": "fixture-model",
              "llm.token_count.prompt": 11,
              "llm.token_count.completion": 3,
            },
          },
          trace.setSpan(context.active(), agent),
        )
        .end();
      agent.end();
    },
  );
  await provider.forceFlush();
  await provider.shutdown();
  const [run] = await store.list("telemetry");
  const snapshot = run ? await store.load("telemetry", run.id) : undefined;
  return { results, snapshot };
}

describe("standard OpenTelemetry JS exporters", () => {
  for (const kind of ["protobuf", "json"] as const)
    it(`exports directly over OTLP/HTTP ${kind} without retries or bridges`, async () => {
      const { results, snapshot } = await exportWith(kind);
      // ExportResultCode.SUCCESS === 0; a non-success response would make the SDK retry or drop.
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((code) => code === 0)).toBe(true);
      expect(snapshot?.session.serviceName).toBe(`node-${kind}-exporter`);
      expect(snapshot?.run.events.map((event) => event.category).sort()).toEqual([
        "agent",
        "model",
      ]);
      expect(snapshot?.run.inputTokens).toBe(11);
    });
});
