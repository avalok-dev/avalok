import { createHash } from "node:crypto";

const kv = (key: string, value: string | number | boolean) => ({
  key,
  value:
    typeof value === "string"
      ? { stringValue: value }
      : typeof value === "number"
        ? { intValue: String(value) }
        : { boolValue: value },
});
const nano = (milliseconds: number) => String(BigInt(milliseconds) * 1_000_000n);

export function buildTracePayload(
  prompt = "Explain the local fixture",
  options: {
    startedAt?: number;
    authorization?: string;
    extraSpans?: number;
    serviceName?: string;
  } = {},
) {
  const start = options.startedAt ?? Date.now();
  const extraSpans = Math.min(2_000, Math.max(0, Math.floor(options.extraSpans ?? 0)));
  const traceId = createHash("sha256").update(`${prompt}:${start}`).digest("hex").slice(0, 32);
  const span = (
    spanId: string,
    name: string,
    offset: number,
    duration: number,
    attributes: ReturnType<typeof kv>[],
    parentSpanId?: string,
    kind = 1,
  ) => ({
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name,
    kind,
    startTimeUnixNano: nano(start + offset),
    endTimeUnixNano: nano(start + offset + duration),
    attributes,
    status: { code: 1 },
  });
  const source = "examples/instrumented-ai-app/src/server.ts";
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            kv("service.name", options.serviceName ?? "instrumented-ai-app"),
            kv("deployment.environment.name", "local"),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "avalok.example", version: "1.0.0" },
            spans: [
              span(
                "0000000000000001",
                "POST /prompt",
                0,
                900 + extraSpans,
                [
                  kv("http.request.method", "POST"),
                  kv("http.route", "/prompt"),
                  kv("url.path", "/prompt"),
                  kv("code.file.path", source),
                  ...(options.authorization ? [kv("authorization", options.authorization)] : []),
                ],
                undefined,
                2,
              ),
              span(
                "0000000000000002",
                "Fixture research agent",
                50,
                760,
                [
                  kv("openinference.span.kind", "AGENT"),
                  kv("agent.name", "Fixture Research Agent"),
                  kv("input.value", prompt),
                  kv("code.file.path", source),
                ],
                "0000000000000001",
              ),
              span(
                "0000000000000003",
                "Retrieve fixture documents",
                110,
                130,
                [
                  kv("openinference.span.kind", "RETRIEVER"),
                  kv("retrieval.documents.0.document.id", "fixture-1"),
                ],
                "0000000000000002",
              ),
              span(
                "0000000000000004",
                "SELECT fixture memory",
                260,
                90,
                [kv("db.system", "sqlite"), kv("db.operation.name", "SELECT")],
                "0000000000000002",
              ),
              span(
                "0000000000000005",
                "fixture_lookup",
                380,
                100,
                [kv("openinference.span.kind", "TOOL"), kv("tool.name", "fixture_lookup")],
                "0000000000000002",
              ),
              span(
                "0000000000000006",
                "Fixture model",
                510,
                230,
                [
                  kv("openinference.span.kind", "LLM"),
                  kv("llm.provider", "fixture"),
                  kv("llm.model_name", "deterministic-model"),
                  kv("llm.token_count.prompt", 24),
                  kv("llm.token_count.completion", 12),
                  kv("output.value", "Deterministic local response"),
                ],
                "0000000000000002",
              ),
              span(
                "0000000000000007",
                "Return response",
                780,
                80,
                [
                  kv("openinference.span.kind", "CHAIN"),
                  kv("output.value", "Deterministic local response"),
                ],
                "0000000000000001",
              ),
              ...Array.from({ length: extraSpans }, (_, index) =>
                span(
                  (index + 8).toString(16).padStart(16, "0"),
                  `Background operation ${index + 1}`,
                  880 + index,
                  1,
                  [kv("code.function.name", "backgroundOperation")],
                  "0000000000000001",
                ),
              ),
            ],
          },
        ],
      },
    ],
  };
}

export async function exportTrace(payload: unknown, endpoint = "http://127.0.0.1:4318/v1/traces") {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Collector rejected telemetry with HTTP ${response.status}.`);
}
