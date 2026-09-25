import { describe, expect, it } from "vitest";
import type { ArchitectureGraph, RuntimeEvent } from "@visual-system/schema";
import { reconcileArchitectureExecution } from "../src/index";

const architecture: ArchitectureGraph = {
  id: "repo",
  title: "Repository",
  entities: [
    {
      id: "replay",
      kind: "service",
      name: "Replay Engine",
      metadata: {
        architecture: {
          category: "package",
          confidence: 1,
          confidenceLabel: "confirmed",
          evidence: [],
          directory: "packages/replay",
          technologies: [],
          sourceFiles: ["packages/replay/src/engine.ts"],
          fileCount: 1,
          dependencies: [],
        },
      },
    },
  ],
  edges: [],
};

const execution: ArchitectureGraph = {
  id: "run",
  title: "Run",
  entities: [
    { id: "codex", kind: "agent", name: "Codex" },
    { id: "files", kind: "storage", name: "Files" },
    { id: "terminal", kind: "tool", name: "Terminal" },
    { id: "mcp:github", kind: "mcp_server", name: "GitHub MCP" },
    { id: "model", kind: "model", name: "Model" },
  ],
  edges: [
    { id: "codex-files", source: "codex", target: "files" },
    { id: "codex-terminal", source: "codex", target: "terminal" },
  ],
};

describe("architecture/runtime reconciliation", () => {
  it("maps exact and workspace-owned runtime file paths", () => {
    const events: RuntimeEvent[] = [
      {
        id: "file",
        traceId: "run",
        timestamp: 10,
        category: "file",
        action: "files.changed",
        sourceEntityId: "codex",
        targetEntityId: "files",
        metadata: {
          files: ["packages/replay/src/engine.ts", "packages/replay/src/new-example.ts"],
        },
      },
    ];
    const result = reconcileArchitectureExecution(architecture, execution, events, {
      repositoryRoot: "/work/repo",
    });
    expect(result.matches.map((match) => match.matchType)).toEqual([
      "exact-source-path",
      "workspace-ownership",
    ]);
    expect(result.activities.replay).toMatchObject({ observed: true, eventCount: 1 });
    expect(result.events[0]?.metadata?.architectureEntityIds).toEqual(["replay"]);
    expect(
      result.graph.edges.some(
        (edge) => edge.target === "replay" && edge.kind === "runtime-observation",
      ),
    ).toBe(true);
  });

  it("preserves unknown files and unmatched external runtime entities", () => {
    const events: RuntimeEvent[] = [
      {
        id: "unknown",
        traceId: "run",
        timestamp: 10,
        category: "file",
        action: "files.changed",
        sourceEntityId: "codex",
        targetEntityId: "files",
        metadata: { files: ["outside/unknown.go"] },
      },
    ];
    const result = reconcileArchitectureExecution(architecture, execution, events);
    expect(result.unmatchedPaths).toEqual(["outside/unknown.go"]);
    expect(result.graph.entities.map((entity) => entity.id)).toEqual(
      expect.arrayContaining(["terminal", "mcp:github", "model"]),
    );
    expect(result.unmatchedRuntimeEntityIds).toEqual(
      expect.arrayContaining(["terminal", "mcp:github", "model"]),
    );
  });
});
