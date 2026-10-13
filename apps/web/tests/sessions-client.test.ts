import { describe, expect, it } from "vitest";
import { pickLandingSession } from "../src/lib/landing";
import { discoverLocalSessions } from "../src/lib/sessions-client";

const ROOT = "/work/shop";

function fakeFetch(routes: Record<string, { ok?: boolean; body?: unknown; throws?: boolean }>) {
  return (async (input: RequestInfo | URL) => {
    const route = routes[String(input)];
    if (!route || route.throws) throw new TypeError("Failed to fetch");
    return { ok: route.ok ?? true, json: async () => route.body } as Response;
  }) as typeof fetch;
}

const codexList = {
  sessions: [
    {
      id: "codex-1",
      startedAt: null,
      modifiedAt: "2026-10-07T09:00:00.000Z",
      eventCount: null,
      cwd: ROOT,
      status: "unknown",
    },
  ],
};
const runtimeList = {
  runs: [
    {
      id: "claude-1",
      source: "claude",
      startedAt: "2026-10-07T10:00:00.000Z",
      modifiedAt: "2026-10-07T10:05:00.000Z",
      eventCount: 12,
      cwd: ROOT,
      status: "completed",
    },
    {
      id: "otlp-1",
      source: "telemetry",
      startedAt: "2026-10-07T11:00:00.000Z",
      modifiedAt: "2026-10-07T11:05:00.000Z",
      eventCount: 30,
      status: "completed",
    },
  ],
};

describe("discoverLocalSessions", () => {
  it("returns Codex sessions and stored runs together, tagged by source", async () => {
    const { sessions, failed } = await discoverLocalSessions(
      fakeFetch({
        "/api/codex/sessions": { body: codexList },
        "/api/runtime/runs": { body: runtimeList },
      }),
    );
    expect(failed).toEqual([]);
    expect(sessions.map((session) => [session.source, session.id])).toEqual([
      ["claude", "claude-1"],
      ["telemetry", "otlp-1"],
      ["codex", "codex-1"],
    ]);
  });

  it("lands on a Claude Code run from this repository, never on a trace without a folder", async () => {
    const { sessions } = await discoverLocalSessions(
      fakeFetch({
        "/api/codex/sessions": { body: codexList },
        "/api/runtime/runs": { body: runtimeList },
      }),
    );
    // The OpenTelemetry trace is the newest, but it has no folder; the Claude run is newer than Codex.
    expect(pickLandingSession(ROOT, sessions)?.id).toBe("claude-1");
  });

  it("still lists Codex sessions when the run store fails, and says what failed", async () => {
    const result = await discoverLocalSessions(
      fakeFetch({
        "/api/codex/sessions": { body: codexList },
        "/api/runtime/runs": { ok: false, body: { error: "disk" } },
      }),
    );
    expect(result.failed).toEqual(["runtime"]);
    expect(pickLandingSession(ROOT, result.sessions)?.id).toBe("codex-1");
  });

  it("still lists stored runs when Codex discovery throws", async () => {
    const result = await discoverLocalSessions(
      fakeFetch({ "/api/runtime/runs": { body: runtimeList } }),
    );
    expect(result.failed).toEqual(["codex"]);
    expect(pickLandingSession(ROOT, result.sessions)?.id).toBe("claude-1");
  });

  it("reports both lists failing when the server is unreachable", async () => {
    const result = await discoverLocalSessions(fakeFetch({}));
    expect(result).toEqual({ sessions: [], failed: ["codex", "runtime"] });
  });

  it("keeps one entry per source and id", async () => {
    const { sessions } = await discoverLocalSessions(
      fakeFetch({
        "/api/codex/sessions": {
          body: { sessions: [...codexList.sessions, ...codexList.sessions] },
        },
        "/api/runtime/runs": { body: { runs: [] } },
      }),
    );
    expect(sessions).toHaveLength(1);
  });
});
