import { describe, expect, it } from "vitest";
import type { ArchitectureGraph, RuntimeEvent } from "@visual-system/schema";
import { createGraphIndex, deriveGraphRuntimeState, findDirectedPath } from "../src/index";

const graph: ArchitectureGraph = {
  id: "test",
  title: "Test",
  entities: [
    { id: "a", kind: "user", name: "A" },
    { id: "b", kind: "service", name: "B" },
    { id: "c", kind: "agent", name: "C" },
  ],
  edges: [
    { id: "ab", source: "a", target: "b" },
    { id: "bc", source: "b", target: "c" },
  ],
};

describe("graph logic", () => {
  it("builds constant-time lookup indexes", () => {
    const index = createGraphIndex(graph);
    expect(index.entities.get("b")?.name).toBe("B");
    expect(index.outgoing.get("b")?.[0]?.id).toBe("bc");
  });

  it("finds a directed path", () => {
    expect(findDirectedPath(graph, "a", "c").map((edge) => edge.id)).toEqual(["ab", "bc"]);
  });

  it("derives active and completed path state", () => {
    const events: RuntimeEvent[] = [
      {
        id: "first",
        traceId: "trace",
        timestamp: 0,
        durationMs: 100,
        category: "http",
        action: "request",
        sourceEntityId: "a",
        targetEntityId: "b",
      },
      {
        id: "second",
        traceId: "trace",
        timestamp: 500,
        durationMs: 200,
        category: "agent",
        action: "start",
        sourceEntityId: "b",
        targetEntityId: "c",
      },
    ];

    const state = deriveGraphRuntimeState(graph, events, 550);
    expect(state.completedEdgeIds.has("ab")).toBe(true);
    expect(state.activeEdgeIds.has("bc")).toBe(true);
    expect(state.activeEntityIds).toEqual(new Set(["b", "c"]));
  });

  it("activates reconciled architecture entities carried by runtime metadata", () => {
    const reconciledGraph: ArchitectureGraph = {
      id: "unified",
      title: "Unified",
      entities: [...graph.entities, { id: "package", kind: "service", name: "Package" }],
      edges: [...graph.edges, { id: "runtime-package", source: "c", target: "package" }],
    };
    const events: RuntimeEvent[] = [
      {
        id: "file",
        traceId: "trace",
        timestamp: 100,
        category: "file",
        action: "files.changed",
        sourceEntityId: "c",
        metadata: { architectureEntityIds: ["package"] },
      },
    ];
    const state = deriveGraphRuntimeState(reconciledGraph, events, 150);
    expect(state.activeEntityIds.has("package")).toBe(true);
    expect(state.activeEdgeIds.has("runtime-package")).toBe(true);
  });
});
