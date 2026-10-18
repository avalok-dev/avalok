import { describe, expect, it } from "vitest";
import { ElkLayoutEngine } from "@visual-system/graph";
import {
  entityLabels,
  renderDiagramSvg,
  renderRecapMarkdown,
  renderRecapSvg,
  safeLabel,
  summarizeSession,
  svgSize,
} from "../src";
import { CREDENTIAL_URL, PATH_NAME, SECRET_NAME, event, graph, gridLayout, run } from "./fixtures";

const allOutputs = (anonymize: boolean, brand = true) => {
  const recap = summarizeSession(run, graph, { anonymize });
  const layout = gridLayout();

  return {
    recapSvg: renderRecapSvg(recap, { brand }),
    markdown: renderRecapMarkdown(recap, { brand }),
    diagram: renderDiagramSvg(graph, layout, { anonymize, brand }),
    json: JSON.stringify(recap),
  };
};

describe("safeLabel", () => {
  it("keeps only the last segment of a path", () => {
    expect(safeLabel(PATH_NAME)).toBe("payments");
    expect(safeLabel("C:\\Users\\dev\\proj\\billing-service")).toBe("billing-service");
    expect(safeLabel("~/code/acme/internal/some-very-long-service-name-here")).toBe(
      "some-very-long-service-name…",
    );
  });
  it("redacts secret-looking values and credentialed URLs", () => {
    expect(safeLabel(SECRET_NAME)).toBe("[redacted]");
    expect(safeLabel("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe("[redacted]");
    expect(safeLabel("AKIAABCDEFGHIJKLMNOP")).toBe("[redacted]");
    expect(safeLabel(CREDENTIAL_URL)).toBe("[redacted]");
    expect(safeLabel("A".repeat(40))).toBe("[redacted]");
    expect(safeLabel("a3f9c1d2e4b5a6978877665544332211")).toBe("[redacted]"); // 32 hex characters
    expect(safeLabel("Xk9_Qw2-Lm4Rt7Yp1Zs8Vb3Nc6Hd5Jf0Ga2Be4Ud7")).toBe("[redacted]"); // random key
    expect(safeLabel("research-platform-backend-worker")).toBe("research-platform-backend-w…"); // kept
  });
  it("reduces a URL to its host and bounds length", () => {
    expect(safeLabel("https://api.example.com/v1/users?token=abc")).toBe("api.example.com");
    expect(safeLabel("x".repeat(10) + " " + "y".repeat(40), 28)).toHaveLength(28);
    expect(safeLabel("   ")).toBe("(unnamed)");
  });
  it("leaves ordinary names alone", () => {
    expect(safeLabel("api-gateway")).toBe("api-gateway");
    expect(safeLabel("Research Agent")).toBe("Research Agent");
  });
});

describe("entityLabels", () => {
  it("anonymizes to stable '<Kind> <n>' labels without any original name", () => {
    const labels = entityLabels(graph.entities, true);
    expect([...labels.values()]).toContain("Service 1");
    for (const name of ["api-gateway", "orders-db", "Terminal", "Codex"])
      expect([...labels.values()].join("|")).not.toContain(name);
    expect(entityLabels(graph.entities, true)).toEqual(labels);
  });
});

describe("summarizeSession", () => {
  const recap = summarizeSession(run, graph);

  it("counts only what was observed", () => {
    expect(recap).toMatchObject({
      status: "completed",
      durationMs: 1_800_000,
      steps: 6,
      failures: 1,
      retries: 1,
      slowSteps: 3, // the 900 s terminal step, the 120 s test run and the 300 s model step
      commands: 2,
      fileOperations: 1,
      testRuns: 1,
      toolCalls: 5,
      modelCalls: 2,
      inputTokens: 12_000,
      outputTokens: 3_400,
    });
  });

  it("ranks where the time went and leaves the user out", () => {
    expect(recap.whereTimeWent.map((entry) => entry.label)[0]).toBe("Terminal");
    expect(recap.whereTimeWent.some((entry) => entry.kind === "user")).toBe(false);
    const times = recap.whereTimeWent.map((entry) => entry.timeMs);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("lists the architecture parts reconciled steps touched", () => {
    const labels = recap.architectureTouched.map((entry) => entry.label);
    expect(labels).toContain("api-gateway");
    expect(labels).not.toContain("Terminal"); // an agent tool, not part of the user's system
  });

  it("says what could not be observed instead of estimating it", () => {
    expect(recap.unavailable).toEqual(["cost"]);
    const bare = summarizeSession(
      { ...run, inputTokens: null, outputTokens: null, events: [event("x", 0)] },
      graph,
    );
    expect(bare.unavailable).toEqual(["token counts", "cost", "step durations"]);
  });
});

describe("nothing private leaks into any export", () => {
  for (const anonymize of [false, true]) {
    it(`anonymize=${anonymize}: recap card, markdown, diagram and data hold no paths, secrets, title or prompt`, () => {
      const outputs = allOutputs(anonymize);
      for (const [name, text] of Object.entries(outputs)) {
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
          "<i onclick",
        ])
          expect(text, `${name} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    });
  }

  it("keeps the last path segment of a path-like entity name, never the path", () => {
    const outputs = allOutputs(false);
    expect(outputs.diagram).toContain("payments");
    expect(outputs.diagram).not.toContain("secret-project");
  });
});

describe("SVG output", () => {
  const { recapSvg, diagram } = allOutputs(false);

  it("is a self-contained image: no scripts, links, external references or raw ampersands", () => {
    for (const svg of [recapSvg, diagram]) {
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect(svg).not.toMatch(/<script|<foreignObject|href=|xlink|<image|@import|url\(http/i);
      expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);
      expect((svg.match(/<svg /g) ?? []).length).toBe(1);
    }
  });

  it("escapes hostile entity names", () => {
    const { diagram: hostile } = allOutputs(false);
    expect(hostile).toContain("a&amp;b &lt;i onclick");
    expect(hostile).not.toContain("<i onclick");
  });

  it("shows the brand by default and omits it when turned off", () => {
    expect(allOutputs(false, true).recapSvg).toContain("Made with Avalok");
    expect(allOutputs(false, true).markdown).toContain("Made with [Avalok](https://avalok.dev)");
    expect(allOutputs(false, false).recapSvg).not.toContain("Made with Avalok");
    expect(allOutputs(false, false).markdown).not.toContain("Avalok](");
  });

  it("states honestly what is unavailable and that nothing is uploaded", () => {
    expect(recapSvg).toContain("Not observed: cost");
    expect(recapSvg).toContain("nothing uploaded");
    expect(diagram).toContain("not a complete picture");
  });
});

describe("svgSize", () => {
  it("reads the pixel size of the exported images", () => {
    expect(svgSize(allOutputs(false).recapSvg)).toEqual({ width: 1200, height: 630 });
    const diagram = svgSize(allOutputs(false).diagram);
    expect(diagram.width).toBeGreaterThan(400);
    expect(diagram.height).toBeGreaterThan(200);
  });
});

describe("golden output (reviewed by eye)", () => {
  it("recap card", async () => {
    await expect(allOutputs(false).recapSvg).toMatchFileSnapshot("./snapshots/recap.svg");
  });
  it("recap markdown", async () => {
    await expect(allOutputs(false).markdown).toMatchFileSnapshot("./snapshots/recap.md");
  });
  it("anonymized diagram", async () => {
    await expect(allOutputs(true).diagram).toMatchFileSnapshot("./snapshots/diagram-anonymous.svg");
  });
});

describe("with the real layout engine", () => {
  // The first ELK layout loads a large bundle; on a cold, busy CI runner (Windows) that can pass
  // the default 5 s. It is fast on a normal machine (about 0.3 s), so this only guards slow hosts.
  it("lays out and renders a diagram in Node", { timeout: 60_000 }, async () => {
    const layout = await new ElkLayoutEngine().layout(graph);
    const svg = renderDiagramSvg(graph, layout, { anonymize: true });
    expect(svg).toContain("<svg ");
    expect((svg.match(/marker-end=/g) ?? []).length).toBe(graph.edges.length);
  });
});

describe("session relation to a repository", () => {
  const root = "/Users/dev/workspace/shop";
  it("tells inside, parent-folder and unrelated sessions apart", async () => {
    const { sessionRelationToRepository } = await import("../src/sessions");
    expect(sessionRelationToRepository({ cwd: root }, root)).toBe("inside");
    expect(sessionRelationToRepository({ cwd: `${root}/api` }, root)).toBe("inside");
    expect(sessionRelationToRepository({ cwd: "/Users/dev/workspace" }, root)).toBe("parent");
    expect(sessionRelationToRepository({ cwd: "/Users/dev/work" }, root)).toBe("other");
    expect(sessionRelationToRepository({ cwd: `${root}-old` }, root)).toBe("other");
    expect(sessionRelationToRepository({ cwd: "/" }, root)).toBe("other");
    expect(sessionRelationToRepository({ cwd: null }, root)).toBe("other");
  });
});
