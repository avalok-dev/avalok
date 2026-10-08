import { describe, expect, it } from "vitest";
import {
  buildPlaybackPlan,
  glowAtPlaybackPosition,
  glowScript,
  playbackLength,
  renderReplayHtml,
} from "../src";
import { SECRET_NAME, event, graph, gridLayout, run } from "./fixtures";

const entityIds = graph.entities.map((entity) => entity.id);

function pageScript(html: string) {
  const scripts = [
    ...html.matchAll(/<script(?: type="application\/json" id="data")?>([\s\S]*?)<\/script>/g),
  ];
  return { json: scripts[0]![1]!, code: scripts[1]![1]!, count: scripts.length };
}

describe("playback plan", () => {
  const plan = buildPlaybackPlan(run, entityIds);

  it("keeps steps in order, one per event, with real times alongside", () => {
    expect(plan.steps).toHaveLength(run.events.length);
    const starts = plan.steps.map((step) => step.startMs);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(plan.steps[1]).toMatchObject({
      realOffsetMs: 1_000,
      realDurationMs: 900_000,
      slow: true,
    });
    expect(plan.totalMs).toBeGreaterThan(starts.at(-1)!);
  });

  it("shortens long steps but keeps them visibly longer than short ones", () => {
    expect(playbackLength(0)).toBe(0); // a brief pulse; no dwell is invented
    expect(playbackLength(220)).toBe(0);
    expect(playbackLength(2_000)).toBeGreaterThan(300);
    expect(playbackLength(2_000)).toBeLessThan(playbackLength(60_000));
    expect(playbackLength(60_000)).toBeLessThanOrEqual(playbackLength(900_000));
    expect(playbackLength(86_400_000)).toBeLessThanOrEqual(4_000);
  });

  it("maps entities to indexes, and unknown ids to null", () => {
    const withUnknown = buildPlaybackPlan(
      { ...run, events: [event("u", 0, { sourceEntityId: "nope", targetEntityId: "codex" })] },
      entityIds,
    );
    expect(withUnknown.steps[0]).toMatchObject({
      source: null,
      target: entityIds.indexOf("codex"),
    });
  });

  it("says plainly when it includes only part of a very long session", () => {
    const limited = buildPlaybackPlan(run, entityIds, { maxSteps: 3 });
    expect(limited.includedSteps).toBe(3);
    expect(limited.totalSteps).toBe(run.events.length);
  });
});

describe("the page's glow matches the dashboard's", () => {
  // The exported page cannot import code, so it carries a plain-JavaScript copy of the glow
  // algorithm. This runs both over the same plan and requires identical results everywhere.
  const plan = buildPlaybackPlan(run, entityIds);
  const stepsForScript = plan.steps.map((step) => [
    step.startMs,
    step.playMs,
    step.source,
    step.target,
    step.extra,
    step.slow,
  ]);
  const glowAt = new Function(`${glowScript}; return glowAt;`)() as (
    steps: unknown[],
    position: number,
  ) => Record<number, { intensity: number; role: string; slow: boolean; inFlight: boolean }>;

  it("agrees at every sampled position, for every entity", () => {
    let compared = 0;
    for (let position = 0; position <= plan.totalMs + 1_000; position += 97) {
      const expected = glowAtPlaybackPosition(plan, entityIds, position);
      const actual = glowAt(stepsForScript, position);
      expect(
        Object.keys(actual)
          .map(Number)
          .sort((a, b) => a - b),
      ).toEqual([...expected.keys()].map((id) => entityIds.indexOf(id)).sort((a, b) => a - b));
      for (const [id, glow] of expected) {
        const mine = actual[entityIds.indexOf(id)]!;
        expect(mine.role).toBe(glow.role);
        expect(mine.slow).toBe(glow.slow);
        expect(mine.inFlight).toBe(glow.inFlight);
        expect(mine.intensity).toBeCloseTo(glow.intensity, 9);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });
});

describe("renderReplayHtml", () => {
  const result = renderReplayHtml(graph, gridLayout(), run);

  it("is one self-contained page: no external files, links, images or network references", () => {
    expect(result.html.startsWith("<!doctype html>")).toBe(true);
    expect(result.html).not.toMatch(
      /\b(src|href)=|<link|<img|<iframe|@import|url\((?!#)|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|import\(/i,
    );
    const urls = [...result.html.matchAll(/https?:\/\/[^\s"'<)]+/g)].map((match) => match[0]);
    expect(urls.filter((url) => !url.startsWith("http://www.w3.org/"))).toEqual([]); // only the SVG namespace; the brand is text
  });

  it("holds no paths, secrets, titles, prompts, commands or actions", () => {
    for (const forbidden of [
      "/Users/",
      "jaishnav",
      "hunter2",
      "db.internal",
      SECRET_NAME.slice(0, 12),
      "run-secret-id",
      "Q3 revenue",
      "ACME",
      "id_rsa",
      "boss@",
      "internal/payments",
      "tool.call",
      "<i onclick",
    ])
      expect(result.html, `must not contain ${forbidden}`).not.toContain(forbidden);
  });

  it("anonymized replays carry no original names", () => {
    const anonymous = renderReplayHtml(graph, gridLayout(), run, { anonymize: true }).html;
    for (const name of ["api-gateway", "orders-db", "Terminal", "Codex", "gpt-5"])
      expect(anonymous).not.toContain(name);
    expect(anonymous).toContain("Service 1");
  });

  it("cannot be broken out of by hostile data", () => {
    const hostile = renderReplayHtml(
      {
        ...graph,
        entities: [
          ...graph.entities,
          { id: "x", kind: "service", name: "a</script><script>alert(1)</script>" },
        ],
      },
      gridLayout(),
      run,
    ).html;
    const { count } = pageScript(hostile);
    expect(count).toBe(2); // the data block and the page script, nothing injected
    expect(hostile).not.toContain("<script>alert");
  });

  it("has exactly one data block and one script, and the script is valid JavaScript", () => {
    const { json, code, count } = pageScript(result.html);
    expect(count).toBe(2);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(() => new Function(code)).not.toThrow(); // parses only; does not run
    expect(code).not.toContain("innerHTML");
    expect(code).not.toContain("eval(");
  });

  it("embeds the session's real total and the step counts honestly", () => {
    expect(result.html).toContain("30m 00s real time");
    expect(result.html).toContain(`${run.events.length} steps shown`);
    expect(result.truncated).toBe(false);
    const limited = renderReplayHtml(graph, gridLayout(), run, { maxSteps: 2 });
    expect(limited.truncated).toBe(true);
    expect(limited.html).toContain(
      `2 steps shown of ${run.events.length} (the rest are not included)`,
    );
  });

  it("shows the brand by default and omits it when turned off, and respects reduced motion", () => {
    expect(result.html).toContain("Made with Avalok");
    expect(renderReplayHtml(graph, gridLayout(), run, { brand: false }).html).not.toContain(
      "Made with Avalok",
    );
    expect(result.html).toContain("prefers-reduced-motion");
  });

  it("golden page", async () => {
    await expect(result.html).toMatchFileSnapshot("./snapshots/replay.html");
  });
});
