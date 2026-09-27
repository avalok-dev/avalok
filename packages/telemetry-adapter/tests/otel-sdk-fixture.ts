// Produces OTLP payloads with the official OpenTelemetry JS SDK and serializers, so protobuf
// tests exercise real wire bytes encoded independently of AgentMap's decoder.
import { SpanKind, SpanStatusCode, context, trace, type Attributes } from "@opentelemetry/api";
import { JsonTraceSerializer, ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type IdGenerator,
} from "@opentelemetry/sdk-trace-base";

class SequentialIds implements IdGenerator {
  private span = 0;
  generateTraceId() {
    return "4bf92f3577b34da6a3ce929d0e0e4736";
  }
  generateSpanId() {
    this.span += 1;
    return this.span.toString(16).padStart(16, "0");
  }
}

const at = (milliseconds: number): [number, number] => [
  Math.floor(milliseconds / 1_000),
  (milliseconds % 1_000) * 1_000_000,
];

export function sdkSpans(options: { serviceName?: string; extraAttributes?: Attributes } = {}) {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": options.serviceName ?? "python-standard-exporter-shape",
      "service.namespace": "fixtures",
      "deployment.environment": "test",
    }),
    idGenerator: new SequentialIds(),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer("agentmap.protobuf.fixture", "1.2.3");
  const start = 1_760_000_000_000;
  const agent = tracer.startSpan(
    "research agent",
    {
      kind: SpanKind.SERVER,
      startTime: at(start),
      attributes: { "openinference.span.kind": "AGENT", "http.request.method": "POST" },
    },
    context.active(),
  );
  const parent = trace.setSpan(context.active(), agent);
  const llm = tracer.startSpan(
    "chat completion",
    {
      kind: SpanKind.CLIENT,
      startTime: at(start + 100),
      attributes: {
        "openinference.span.kind": "LLM",
        "llm.model_name": "fixture-model",
        "llm.provider": "fixture-provider",
        "llm.token_count.prompt": 42,
        "llm.token_count.completion": 7,
        "input.value": "Explain the fixture",
        authorization: "Bearer protobuf-secret-token",
        "list.attribute": ["a", "b"],
        "ratio.attribute": 0.25,
        "flag.attribute": true,
        ...options.extraAttributes,
      },
    },
    parent,
  );
  llm.end(at(start + 600));
  const tool = tracer.startSpan(
    "search tool",
    {
      startTime: at(start + 650),
      attributes: { "openinference.span.kind": "TOOL", "tool.name": "search" },
    },
    parent,
  );
  tool.setStatus({ code: SpanStatusCode.ERROR, message: "tool failed" });
  tool.end(at(start + 700));
  agent.end(at(start + 900));
  return exporter.getFinishedSpans();
}

export function sdkProtobufPayload(options?: Parameters<typeof sdkSpans>[0]) {
  const bytes = ProtobufTraceSerializer.serializeRequest(sdkSpans(options));
  if (!bytes) throw new Error("Serializer returned no bytes.");
  return bytes;
}

export function sdkJsonPayload(options?: Parameters<typeof sdkSpans>[0]) {
  const bytes = JsonTraceSerializer.serializeRequest(sdkSpans(options));
  if (!bytes) throw new Error("Serializer returned no bytes.");
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
