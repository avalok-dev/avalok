import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalRuntimeStore } from "@visual-system/telemetry-adapter";
import { buildTracePayload } from "@visual-system/instrumented-ai-app";
import { collectorConfiguration, createCollectorServer } from "../src/server";

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

async function collector(maxBodyBytes = 1024 * 1024) {
  const store = new LocalRuntimeStore(await mkdtemp(join(tmpdir(), "agentmap-collector-")));
  const server = createCollectorServer({ store, maxBodyBytes });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { store, url: `http://127.0.0.1:${port}` };
}

const tracePayload = {
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: "integration-app" } }],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: "0123456789abcdef0123456789abcdef",
              spanId: "0123456789abcdef",
              name: "POST /prompt",
              kind: 2,
              startTimeUnixNano: "1000000000",
              endTimeUnixNano: "1100000000",
              attributes: [{ key: "http.request.method", value: { stringValue: "POST" } }],
            },
          ],
        },
      ],
    },
  ],
};

describe("local collector", () => {
  it("ingests OTLP/HTTP into a normalized persisted run", async () => {
    const { store, url } = await collector();
    const response = await fetch(`${url}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tracePayload),
    });
    expect(response.status).toBe(200);
    const runs = await store.list("telemetry");
    expect(runs).toHaveLength(1);
    const snapshot = await store.load("telemetry", runs[0]!.id);
    expect(snapshot?.run.events[0]?.category).toBe("http");
    expect(snapshot?.session.serviceName).toBe("integration-app");
  });

  it("accepts the instrumented example end to end", async () => {
    const { store, url } = await collector();
    const response = await fetch(`${url}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildTracePayload("Integration fixture", { startedAt: 1_000 })),
    });
    expect(response.status).toBe(200);
    const [run] = await store.list("telemetry");
    const snapshot = run ? await store.load("telemetry", run.id) : undefined;
    expect(snapshot?.run.events.map((event) => event.category)).toEqual(
      expect.arrayContaining(["http", "agent", "retrieval", "database", "tool", "model"]),
    );
    expect(snapshot?.run.events.find((event) => event.category === "model")?.parentSpanId).toBe(
      "0000000000000002",
    );
    expect(snapshot?.run.inputTokens).toBe(24);
    expect(snapshot?.run.outputTokens).toBe(12);
  });

  it("rejects malformed, oversized, and unsupported encoding safely", async () => {
    const { url } = await collector(32);
    expect(
      (
        await fetch(`${url}/v1/traces`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${url}/v1/traces`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "x".repeat(100),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await fetch(`${url}/v1/traces`, {
          method: "POST",
          headers: { "content-type": "application/x-protobuf" },
          body: "x",
        })
      ).status,
    ).toBe(415);
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it("ingests Claude hooks without affecting tool execution", async () => {
    const { store, url } = await collector();
    const response = await fetch(`${url}/v1/claude/hooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: "claude-live",
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_use_id: "one",
        tool_input: { command: "pwd" },
      }),
    });
    expect(response.status).toBe(200);
    expect((await store.list("claude"))[0]?.eventCount).toBe(1);
    const health = (await (await fetch(`${url}/health`)).json()) as {
      claude: { hooksReceived: number; normalized: number; errors: number; liveStatus: string };
    };
    expect(health.claude).toMatchObject({
      hooksReceived: 1,
      normalized: 1,
      errors: 0,
      liveStatus: "listening",
    });
  });

  it("refuses accidental public binding", () => {
    expect(() => collectorConfiguration({ AGENTMAP_OTLP_HOST: "0.0.0.0" })).toThrow("Refusing");
  });
});
