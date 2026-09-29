import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "../src/middleware";
import { dashboardPort, guardDashboardRequest } from "../src/lib/request-guard";
import { readJsonBody } from "../src/lib/request-body";

const port = 4737;
const request = (
  overrides: Partial<Parameters<typeof guardDashboardRequest>[0]> = {},
): Parameters<typeof guardDashboardRequest>[0] => ({
  method: "GET",
  pathname: "/api/repository",
  host: `127.0.0.1:${port}`,
  origin: null,
  contentType: null,
  ...overrides,
});
// An explicit `undefined` port means "unknown", so no default parameter here.
const status = (overrides: Parameters<typeof request>[0], ...expected: [number?]) => {
  const result = guardDashboardRequest(request(overrides), expected.length ? expected[0] : port);
  return result.ok ? 200 : result.status;
};

describe("dashboard Host validation (DNS rebinding)", () => {
  it.each([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `LocalHost:${port}`])(
    "accepts %s",
    (host) => expect(status({ host })).toBe(200),
  );

  it.each([
    `attacker.example:${port}`,
    `localhost.attacker.example:${port}`,
    `127.0.0.1.attacker.example:${port}`,
    `192.168.1.20:${port}`,
    `attacker.example@127.0.0.1:${port}`,
    "127.0.0.1:",
    "127.0.0.1:3000",
    "127.0.0.1",
  ])("rejects %s on sensitive reads", (host) => {
    for (const pathname of [
      "/api/repository",
      "/api/codex/sessions",
      "/api/codex/sessions/019a-session",
      "/api/codex/sessions/019a-session/stream",
      "/api/runtime/runs",
      "/api/capabilities",
      "/api/settings",
      "/",
      "/_next/static/chunk.js",
    ])
      expect(status({ host, pathname }), `${host} ${pathname}`).toBe(403);
  });

  it("rejects a missing Host", () => expect(status({ host: null })).toBe(403));

  it("uses the actual development port, and only the hostname when it is unknown", () => {
    expect(status({ host: "localhost:3000" }, 3000)).toBe(200);
    expect(status({ host: "localhost:3001" }, 3000)).toBe(403);
    expect(status({ host: "localhost:3001" }, undefined)).toBe(200);
    expect(status({ host: "attacker.example:3001" }, undefined)).toBe(403);
  });

  it("reads the port the CLI or Next publishes", () => {
    expect(dashboardPort({ SARVADRIK_DASHBOARD_PORT: "4740", PORT: "1" })).toBe(4740);
    expect(dashboardPort({ PORT: "3001" })).toBe(3001);
    expect(dashboardPort({})).toBeUndefined();
    expect(dashboardPort({ PORT: "nope" })).toBeUndefined();
  });
});

describe("dashboard Origin validation", () => {
  const mutation = { method: "POST", pathname: "/api/settings", contentType: "application/json" };

  it.each([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`])(
    "accepts same-loopback origin %s for mutations",
    (origin) => expect(status({ ...mutation, origin })).toBe(200),
  );

  it.each([
    "https://attacker.example",
    "http://attacker.example",
    `http://attacker.example:${port}`,
    `http://localhost.attacker.example:${port}`,
    "null",
    "http://127.0.0.1:3000",
    `https://127.0.0.1:${port}`,
  ])("rejects %s on mutations and reads", (origin) => {
    expect(status({ ...mutation, origin })).toBe(403);
    expect(status({ ...mutation, pathname: "/api/telemetry/test", origin })).toBe(403);
    expect(status({ origin })).toBe(403);
  });

  it("allows a missing Origin (non-browser local clients)", () =>
    expect(status(mutation)).toBe(200));

  it("derives the same-origin port from Host when the listening port is unknown", () => {
    expect(
      status({ ...mutation, host: "localhost:3002", origin: "http://localhost:3002" }, undefined),
    ).toBe(200);
    expect(
      status({ ...mutation, host: "localhost:3002", origin: "http://localhost:3003" }, undefined),
    ).toBe(403);
  });
});

describe("dashboard mutation content type", () => {
  it.each([
    "text/plain",
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    null,
  ])("rejects %s for API mutations", (contentType) => {
    expect(status({ method: "POST", pathname: "/api/settings", contentType })).toBe(415);
    expect(status({ method: "POST", pathname: "/api/telemetry/test", contentType })).toBe(415);
  });

  it("does not constrain reads", () =>
    expect(status({ method: "GET", contentType: "text/plain" })).toBe(200));
});

describe("middleware", () => {
  const originalPort = process.env.SARVADRIK_DASHBOARD_PORT;
  beforeEach(() => {
    process.env.SARVADRIK_DASHBOARD_PORT = String(port);
  });
  afterEach(() => {
    if (originalPort === undefined) delete process.env.SARVADRIK_DASHBOARD_PORT;
    else process.env.SARVADRIK_DASHBOARD_PORT = originalPort;
  });

  const call = (path: string, headers: Record<string, string>, method = "GET") =>
    middleware(new NextRequest(`http://127.0.0.1:${port}${path}`, { method, headers }));

  it("passes legitimate requests through", () => {
    const response = call("/api/repository", { host: `127.0.0.1:${port}` });
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects a rebound Host without leaking details or granting CORS", async () => {
    const response = call("/api/repository", { host: `attacker.example:${port}` });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/^Forbidden/);
    expect(JSON.stringify(body)).not.toMatch(/Users|home|\\\\|repository root/i);
  });

  it("rejects a foreign-origin mutation", () => {
    const response = call(
      "/api/settings",
      {
        host: `127.0.0.1:${port}`,
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      "POST",
    );
    expect(response.status).toBe(403);
  });

  it("applies to every path", async () => {
    const source = await readFile(join(import.meta.dirname, "../src/middleware.ts"), "utf8");
    expect(source).toContain('matcher: "/:path*"');
  });
});

describe("bounded JSON bodies", () => {
  it("parses small JSON and refuses oversized or malformed bodies", async () => {
    const post = (body: string) =>
      new Request("http://127.0.0.1/api/settings", { method: "POST", body });
    await expect(readJsonBody(post('{"a":1}'), 64)).resolves.toEqual({ a: 1 });
    await expect(readJsonBody(post("x".repeat(65)), 64)).rejects.toMatchObject({ status: 413 });
    await expect(readJsonBody(post("{"), 64)).rejects.toMatchObject({ status: 400 });
  });
});

describe("settings route", () => {
  let data: string;
  beforeEach(async () => {
    data = await mkdtemp(join(tmpdir(), "sarvadrik-settings-"));
    vi.stubEnv("SARVADRIK_DATA_DIR", data);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("saves valid settings and rejects oversized bodies", async () => {
    const { POST } = await import("../src/app/api/settings/route");
    const ok = await POST(
      new Request("http://127.0.0.1/api/settings", {
        method: "POST",
        body: JSON.stringify({ gettingStartedDismissed: true }),
      }),
    );
    expect(ok.status).toBe(200);
    const big = await POST(
      new Request("http://127.0.0.1/api/settings", {
        method: "POST",
        body: JSON.stringify({ gettingStartedDismissed: true, pad: "x".repeat(20_000) }),
      }),
    );
    expect(big.status).toBe(413);
    const invalid = await POST(
      new Request("http://127.0.0.1/api/settings", { method: "POST", body: "null" }),
    );
    expect(invalid.status).toBe(400);
  });
});
