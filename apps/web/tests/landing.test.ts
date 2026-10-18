import { describe, expect, it } from "vitest";
import {
  pickLandingSession,
  relativeTime,
  sessionBelongsToRepository,
  sortSessionsNewestFirst,
} from "../src/lib/landing";
import type { PublicSessionSummary } from "../src/store/visualization-store";

function session(overrides: Partial<PublicSessionSummary>): PublicSessionSummary {
  return {
    id: "s",
    source: "codex",
    startedAt: null,
    modifiedAt: "2026-10-01T00:00:00.000Z",
    eventCount: 10,
    status: "completed",
    ...overrides,
  };
}

describe("landing session selection", () => {
  const root = "/Users/dev/projects/shop";

  it("matches sessions run in the repository folder or a subfolder", () => {
    expect(sessionBelongsToRepository({ cwd: root }, root)).toBe(true);
    expect(sessionBelongsToRepository({ cwd: `${root}/services/api` }, root)).toBe(true);
    expect(sessionBelongsToRepository({ cwd: `${root}-old` }, root)).toBe(false);
    expect(sessionBelongsToRepository({ cwd: "/Users/dev/projects" }, root)).toBe(false);
    expect(sessionBelongsToRepository({ cwd: null }, root)).toBe(false);
    expect(sessionBelongsToRepository({ cwd: root }, undefined)).toBe(false);
  });

  it("ignores case, trailing slashes and Windows separators", () => {
    expect(sessionBelongsToRepository({ cwd: "C:\\Work\\Shop\\api" }, "c:/work/shop/")).toBe(true);
  });

  it("opens the newest session from this repository", () => {
    const sessions = [
      session({ id: "old", cwd: root, modifiedAt: "2026-10-01T00:00:00.000Z" }),
      session({ id: "new", cwd: `${root}/web`, modifiedAt: "2026-10-05T00:00:00.000Z" }),
      session({ id: "elsewhere", cwd: "/other", modifiedAt: "2026-10-06T00:00:00.000Z" }),
    ];
    expect(pickLandingSession(root, sessions)?.id).toBe("new");
  });

  it("never opens a session from another folder automatically", () => {
    expect(pickLandingSession(root, [session({ id: "x", cwd: "/other" })])).toBeUndefined();
  });

  it("skips sessions with no events but accepts unknown event counts", () => {
    const sessions = [
      session({ id: "empty", cwd: root, eventCount: 0, modifiedAt: "2026-10-05T00:00:00.000Z" }),
      session({
        id: "unknown",
        cwd: root,
        eventCount: null,
        modifiedAt: "2026-10-04T00:00:00.000Z",
      }),
    ];
    expect(pickLandingSession(root, sessions)?.id).toBe("unknown");
  });

  it("sorts newest first without mutating the input", () => {
    const sessions = [
      session({ id: "a", modifiedAt: "2026-10-01T00:00:00.000Z" }),
      session({ id: "b", modifiedAt: "2026-10-03T00:00:00.000Z" }),
    ];
    expect(sortSessionsNewestFirst(sessions).map((item) => item.id)).toEqual(["b", "a"]);
    expect(sessions.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("describes elapsed time in plain words", () => {
    const now = Date.parse("2026-10-06T12:00:00.000Z");
    expect(relativeTime("2026-10-06T11:59:40.000Z", now)).toBe("just now");
    expect(relativeTime("2026-10-06T11:30:00.000Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-10-06T07:00:00.000Z", now)).toBe("5 h ago");
    expect(relativeTime("2026-10-03T12:00:00.000Z", now)).toBe("3 d ago");
    expect(relativeTime(null, now)).toBe("unknown time");
    expect(relativeTime("not a date", now)).toBe("unknown time");
  });
});

describe("live and related sessions", () => {
  it("treats a session changed in the last two minutes as running", async () => {
    const { isLiveSession, sessionRelationToRepository } = await import("../src/lib/landing");
    const now = Date.parse("2026-10-18T05:00:00.000Z");
    expect(isLiveSession({ modifiedAt: "2026-10-18T04:59:00.000Z" }, now)).toBe(true);
    expect(isLiveSession({ modifiedAt: "2026-10-18T04:50:00.000Z" }, now)).toBe(false);
    expect(isLiveSession({ modifiedAt: "garbage" }, now)).toBe(false);
    expect(sessionRelationToRepository({ cwd: "/Users/dev" }, "/Users/dev/shop")).toBe("parent");
  });
});

describe("landing with a session started in a parent folder", () => {
  const root = "/Users/dev/workspace/shop";
  const now = Date.parse("2026-10-18T05:00:00.000Z");
  it("opens a running parent-folder session, but not an old one", () => {
    const running = session({
      id: "run",
      cwd: "/Users/dev/workspace",
      modifiedAt: "2026-10-18T04:59:30.000Z",
    });
    const old = session({
      id: "old",
      cwd: "/Users/dev/workspace",
      modifiedAt: "2026-10-17T04:59:30.000Z",
    });
    expect(pickLandingSession(root, [running], now)?.id).toBe("run");
    expect(pickLandingSession(root, [old], now)).toBeUndefined();
  });
  it("still prefers a session inside the repository", () => {
    const inside = session({
      id: "in",
      cwd: `${root}/api`,
      modifiedAt: "2026-10-10T00:00:00.000Z",
    });
    const running = session({
      id: "run",
      cwd: "/Users/dev/workspace",
      modifiedAt: "2026-10-18T04:59:30.000Z",
    });
    expect(pickLandingSession(root, [running, inside], now)?.id).toBe("in");
  });
});
