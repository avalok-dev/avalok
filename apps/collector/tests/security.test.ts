import { request as httpRequest } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalRuntimeStore } from "@visual-system/telemetry-adapter";
import { createCollectorServer } from "../src/server";

// Browser-controlled headers (Host, Origin, Content-Type) against the loopback receiver.
// `fetch` cannot set Host, so requests are sent with node:http and an explicit header list.

const protobufFixture = join(
  import.meta.dirname,
  "../../../packages/telemetry-adapter/tests/fixtures/openinference-trace.otlp.pb",
);

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

async function collector(options: { maxBodyBytes?: number; maxHookBodyBytes?: number } = {}) {
  const store = new LocalRuntimeStore(await mkdtemp(join(tmpdir(), "avalok-security-")));
  const server = createCollectorServer({ store, ...options });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { store, port: (server.address() as AddressInfo).port };
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(
  port: number,
  path: string,
  options: {
    method?: string;
    host?: string | null;
    headers?: Record<string, string>;
    body?: string | Buffer;
  } = {},
) {
  return new Promise<RawResponse>((resolve, reject) => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.host !== null) headers.Host = options.host ?? `127.0.0.1:${port}`;
    const request = httpRequest(
      { host: "127.0.0.1", port, path, method: options.method ?? "GET", headers, setHost: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("error", reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

const hookPayload = JSON.stringify({
  hook_event_name: "UserPromptSubmit",
  session_id: "security-session",
  cwd: "/tmp/project",
  prompt: "injected by a web page",
});
const tracePayload = JSON.stringify({
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: "security-app" } }],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: "0123456789abcdef0123456789abcdef",
              spanId: "0123456789abcdef",
              name: "GET /",
              kind: 2,
              startTimeUnixNano: "1000000000",
              endTimeUnixNano: "1100000000",
            },
          ],
        },
      ],
    },
  ],
});
const json = { "Content-Type": "application/json" };

describe("collector Host validation (DNS rebinding)", () => {
  it.each([["127.0.0.1"], ["localhost"], ["[::1]"], ["LOCALHOST"]])(
    "accepts %s on the actual port",
    async (hostname) => {
      const { port } = await collector();
      expect((await send(port, "/health", { host: `${hostname}:${port}` })).status).toBe(200);
    },
  );

  it.each([
    "attacker.example",
    "localhost.attacker.example",
    "127.0.0.1.attacker.example",
    "192.168.1.20",
    "0.0.0.0",
  ])("rejects %s on every route", async (hostname) => {
    const { port, store } = await collector();
    const host = `${hostname}:${port}`;
    const responses = await Promise.all([
      send(port, "/health", { host }),
      send(port, "/v1/traces", { host, method: "POST", headers: json, body: tracePayload }),
      send(port, "/v1/claude/hooks", { host, method: "POST", headers: json, body: hookPayload }),
      send(port, "/v1/avalok/test-trace", { host, method: "POST", headers: json, body: "{}" }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(responses[0]!.body).not.toContain("diagnostics");
    expect(await store.list()).toHaveLength(0);
  });

  it("rejects malformed, missing, and wrong-port Host headers", async () => {
    const { port } = await collector();
    for (const host of ["127.0.0.1:", "attacker.example@127.0.0.1", "127.0.0.1:1"])
      expect((await send(port, "/health", { host })).status, host).toBe(403);
    // No port means :80, which is not this server.
    expect((await send(port, "/health", { host: "127.0.0.1" })).status).toBe(403);
    // HTTP/1.1 requires Host; Node itself rejects it with 400 before the handler runs.
    expect([400, 403]).toContain((await send(port, "/health", { host: null })).status);
  });
});

describe("Claude hook browser protection", () => {
  it("accepts the documented Claude Code HTTP hook request (JSON, no Origin)", async () => {
    const { port, store } = await collector();
    const response = await send(port, "/v1/claude/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: hookPayload,
    });
    expect(response.status).toBe(200);
    expect(await store.list("claude")).toHaveLength(1);
  });

  it("accepts JSON with a charset parameter via localhost", async () => {
    const { port } = await collector();
    const response = await send(port, "/v1/claude/hooks", {
      host: `localhost:${port}`,
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: hookPayload,
    });
    expect(response.status).toBe(200);
  });

  it.each([
    "text/plain",
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=----x",
  ])("rejects the CORS-simple content type %s without storing anything", async (type) => {
    const { port, store } = await collector();
    const response = await send(port, "/v1/claude/hooks", {
      method: "POST",
      headers: { "Content-Type": type },
      body: hookPayload,
    });
    expect(response.status).toBe(415);
    expect(await store.list()).toHaveLength(0);
  });

  it("rejects a missing content type", async () => {
    const { port, store } = await collector();
    const response = await send(port, "/v1/claude/hooks", { method: "POST", body: hookPayload });
    expect(response.status).toBe(415);
    expect(await store.list()).toHaveLength(0);
  });

  it.each([
    "https://attacker.example",
    "http://attacker.example",
    "null",
    "http://localhost.attacker.example:4318",
    // Even a loopback page is a browser: Claude Code never sends Origin.
    "http://localhost:5173",
  ])("rejects a browser Origin %s even with JSON", async (origin) => {
    const { port, store } = await collector();
    const response = await send(port, "/v1/claude/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: hookPayload,
    });
    expect(response.status).toBe(403);
    expect(await store.list()).toHaveLength(0);
  });

  it("bounds hook bodies", async () => {
    const { port } = await collector({ maxHookBodyBytes: 256 });
    const response = await send(port, "/v1/claude/hooks", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ hook_event_name: "Stop", session_id: "s", pad: "x".repeat(1_000) }),
    });
    expect(response.status).toBe(413);
  });
});

describe("agent hook forwarder route (Kiro, Cursor)", () => {
  const event = JSON.stringify({ hook_event_name: "postToolUse", tool_name: "shell" });
  const post = (port: number, path: string, extra: Parameters<typeof send>[2] = {}) =>
    send(port, path, { method: "POST", headers: json, body: event, ...extra });
  const health = async (port: number) =>
    JSON.parse((await send(port, "/health")).body) as {
      hooks: Record<string, { received: number; errors: number }>;
    };

  it.each(["kiro", "cursor"])(
    "acknowledges a %s event with an empty answer and stores nothing",
    async (tool) => {
      const { port, store } = await collector();
      const response = await post(port, `/v1/hooks/${tool}`);
      expect(response.status).toBe(200);
      // Nothing a hook runner could read as allow, deny, ask or extra context.
      expect(JSON.parse(response.body)).toEqual({});
      expect(await store.list()).toHaveLength(0);
      expect((await health(port)).hooks[tool]).toMatchObject({ received: 1, errors: 0 });
    },
  );

  it.each(["claude", "codex", "KIRO", "../cursor", ""])(
    "does not know the tool %j",
    async (tool) => {
      const { port } = await collector();
      expect((await post(port, `/v1/hooks/${tool}`)).status).toBe(404);
    },
  );

  it("answers only POST", async () => {
    const { port } = await collector();
    expect((await send(port, "/v1/hooks/cursor")).status).toBe(404);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"])(
    "rejects the CORS-simple content type %s",
    async (type) => {
      const { port } = await collector();
      const response = await post(port, "/v1/hooks/cursor", { headers: { "Content-Type": type } });
      expect(response.status).toBe(415);
      expect((await health(port)).hooks.cursor).toMatchObject({ received: 0, errors: 1 });
    },
  );

  it.each(["https://attacker.example", "null", "http://localhost:5173"])(
    "rejects a browser Origin %s even with JSON",
    async (origin) => {
      const { port } = await collector();
      const response = await post(port, "/v1/hooks/kiro", {
        headers: { ...json, Origin: origin },
      });
      expect(response.status).toBe(403);
      expect((await health(port)).hooks.kiro!.received).toBe(0);
    },
  );

  it("rejects a rebound Host", async () => {
    const { port } = await collector();
    const response = await post(port, "/v1/hooks/cursor", { host: `attacker.example:${port}` });
    expect(response.status).toBe(403);
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    const { port } = await collector({ maxHookBodyBytes: 256 });
    expect((await post(port, "/v1/hooks/cursor", { body: "{not json" })).status).toBe(400);
    expect(
      (await post(port, "/v1/hooks/cursor", { body: JSON.stringify({ pad: "x".repeat(1_000) }) }))
        .status,
    ).toBe(413);
    expect((await health(port)).hooks.cursor).toMatchObject({ received: 0, errors: 2 });
  });
});

describe("synthetic test-trace protection", () => {
  it("accepts the dashboard's server-side request (JSON, no Origin)", async () => {
    const { port, store } = await collector();
    const response = await send(port, "/v1/avalok/test-trace", {
      method: "POST",
      headers: json,
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ synthetic: true });
    expect(await store.list("telemetry")).toHaveLength(1);
  });

  it("rejects a bodiless simple POST (what an HTML form or no-cors fetch can send)", async () => {
    const { port, store } = await collector();
    expect((await send(port, "/v1/avalok/test-trace", { method: "POST" })).status).toBe(415);
    const form = await send(port, "/v1/avalok/test-trace", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(form.status).toBe(415);
    expect(await store.list()).toHaveLength(0);
  });

  it.each(["https://attacker.example", "null", "http://127.0.0.1:4737"])(
    "rejects browser Origin %s",
    async (origin) => {
      const { port, store } = await collector();
      const response = await send(port, "/v1/avalok/test-trace", {
        method: "POST",
        headers: { ...json, Origin: origin },
        body: "{}",
      });
      expect(response.status).toBe(403);
      expect(await store.list()).toHaveLength(0);
    },
  );
});

describe("OTLP interoperability is preserved", () => {
  it("accepts JSON and protobuf from exporters that send no Origin", async () => {
    const { port, store } = await collector();
    const jsonResponse = await send(port, "/v1/traces", {
      method: "POST",
      headers: json,
      body: tracePayload,
    });
    expect(jsonResponse.status).toBe(200);
    const protobufResponse = await send(port, "/v1/traces", {
      host: `localhost:${port}`,
      method: "POST",
      headers: { "Content-Type": "application/x-protobuf" },
      body: await readFile(protobufFixture),
    });
    expect(protobufResponse.status).toBe(200);
    expect(protobufResponse.headers["content-type"]).toBe("application/x-protobuf");
    expect((await store.list("telemetry")).length).toBeGreaterThanOrEqual(2);
  });

  it("does not require Origin but rejects a foreign or null one", async () => {
    const { port, store } = await collector();
    for (const origin of ["https://attacker.example", "null"]) {
      const response = await send(port, "/v1/traces", {
        method: "POST",
        headers: { ...json, Origin: origin },
        body: tracePayload,
      });
      expect(response.status, origin).toBe(403);
    }
    expect(await store.list()).toHaveLength(0);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"])(
    "still rejects %s with 415",
    async (type) => {
      const { port } = await collector();
      const response = await send(port, "/v1/traces", {
        method: "POST",
        headers: { "Content-Type": type },
        body: tracePayload,
      });
      expect(response.status).toBe(415);
    },
  );
});

describe("CORS", () => {
  it("never grants cross-origin access", async () => {
    const { port } = await collector();
    const preflight = await send(port, "/v1/claude/hooks", {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(preflight.status).toBeGreaterThanOrEqual(400);
    const health = await send(port, "/health", { headers: { Origin: "http://localhost:4318" } });
    for (const response of [preflight, health])
      expect(
        Object.keys(response.headers).filter((key) => key.startsWith("access-control-")),
      ).toEqual([]);
  });
});
