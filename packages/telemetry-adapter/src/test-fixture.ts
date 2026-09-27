const attribute = (key: string, value: string | number | boolean) => ({
  key,
  value:
    typeof value === "string"
      ? { stringValue: value }
      : typeof value === "number"
        ? { intValue: String(value) }
        : { boolValue: value },
});

const nanos = (milliseconds: number) => String(BigInt(milliseconds) * 1_000_000n);

/** A local-only, deterministic-shape trace used to prove the ingestion path. */
export function buildSyntheticTestTrace(startedAt = Date.now()) {
  const traceId = "a9e17a9e17a9e17a9e17a9e17a9e17a";
  const span = (
    id: string,
    name: string,
    offset: number,
    duration: number,
    kind: string,
    parentSpanId?: string,
    extra: ReturnType<typeof attribute>[] = [],
  ) => ({
    traceId,
    spanId: id,
    ...(parentSpanId ? { parentSpanId } : {}),
    name,
    startTimeUnixNano: nanos(startedAt + offset),
    endTimeUnixNano: nanos(startedAt + offset + duration),
    attributes: [
      attribute("agentmap.synthetic", true),
      attribute("agentmap.fixture", "m7.2-test-trace"),
      attribute("openinference.span.kind", kind),
      ...extra,
    ],
    status: { code: 1 },
  });
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attribute("service.name", "AgentMap Synthetic Fixture"),
            attribute("deployment.environment.name", "local-test"),
            attribute("agentmap.synthetic", true),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "agentmap.synthetic-fixture", version: "1" },
            spans: [
              span(
                "0000000000000101",
                "Synthetic Fixture · Test Request",
                0,
                500,
                "CHAIN",
                undefined,
                [attribute("input.value", "Synthetic fixture test request")],
              ),
              span(
                "0000000000000102",
                "Synthetic Fixture · Test Agent",
                40,
                400,
                "AGENT",
                "0000000000000101",
                [attribute("agent.name", "Synthetic Fixture Test Agent")],
              ),
              span(
                "0000000000000103",
                "Synthetic Fixture · Test Tool",
                100,
                90,
                "TOOL",
                "0000000000000102",
                [attribute("tool.name", "synthetic_fixture_test_tool")],
              ),
              span(
                "0000000000000104",
                "Synthetic Fixture · Test Model",
                220,
                140,
                "LLM",
                "0000000000000102",
                [
                  attribute("llm.provider", "fixture"),
                  attribute("llm.model_name", "synthetic-test-model"),
                  attribute("llm.token_count.prompt", 4),
                  attribute("llm.token_count.completion", 3),
                ],
              ),
              span(
                "0000000000000105",
                "Synthetic Fixture · Test Response",
                390,
                60,
                "CHAIN",
                "0000000000000101",
                [attribute("output.value", "Synthetic fixture response")],
              ),
            ],
          },
        ],
      },
    ],
  };
}
