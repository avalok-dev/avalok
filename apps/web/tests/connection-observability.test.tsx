import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { Inspector } from "@visual-system/ui";
import type { ArchitectureGraph, RuntimeEvent } from "@visual-system/schema";
import {
  selectConnectionObservation,
  selectTelemetryObservability,
} from "../src/lib/observability-view";
import { useVisualizationStore, type VisualizationDataset } from "../src/store/visualization-store";

const architecture: ArchitectureGraph = {
  id: "trace-map",
  title: "Trace map",
  entities: [
    { id: "agent:root", kind: "agent", name: "Root agent" },
    { id: "tool:search", kind: "tool", name: "Search" },
    { id: "model:one", kind: "model", name: "Model" },
  ],
  edges: [
    { id: "canvas:search", source: "agent:root", target: "tool:search" },
    { id: "canvas:model", source: "agent:root", target: "model:one" },
  ],
};

const toolCall: RuntimeEvent = {
  id: "span:tool",
  traceId: "trace-one",
  spanId: "tool-span",
  timestamp: 10,
  durationMs: 20,
  category: "error",
  action: "tool.call.error",
  sourceEntityId: "agent:root",
  targetEntityId: "tool:search",
  metadata: { observedCategory: "tool", status: "error", retryObserved: true },
};

function dataset(events: RuntimeEvent[] = [toolCall]): VisualizationDataset {
  return {
    source: "telemetry",
    architecture,
    rawEvents: {},
    diagnostics: [],
    session: {
      id: "trace-one",
      source: "telemetry",
      startedAt: "2026-10-01T00:00:00.000Z",
      modifiedAt: "2026-10-01T00:00:01.000Z",
      status: "completed",
      eventCount: events.length,
    },
    run: {
      id: "trace-one",
      title: "Trace one",
      prompt: "Observed trace",
      startedAt: "2026-10-01T00:00:00.000Z",
      endedAt: "2026-10-01T00:00:01.000Z",
      totalDurationMs: 1000,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      toolCallCount: 1,
      modelCallCount: 0,
      status: "completed",
      events,
    },
  };
}

describe("selected connection statistics", () => {
  it("matches a canvas edge by directed endpoints rather than its unrelated ID", () => {
    const selected = dataset();
    const observability = selectTelemetryObservability(selected);
    const match = selectConnectionObservation(
      architecture.edges[0]!,
      architecture,
      selected.run.events,
      observability,
    );
    expect(match.status).toBe("observed");
    if (match.status === "observed") {
      expect(match.statistics.callCount).toBe(1);
      expect(match.statistics.failures).toBe(1);
      expect(match.statistics.observedRetries).toBe(1);
      expect(match.statistics.inputTokens).toBeNull();
    }
    expect(
      selectConnectionObservation(
        { id: "reverse", source: "tool:search", target: "agent:root" },
        {
          ...architecture,
          edges: [{ id: "reverse", source: "tool:search", target: "agent:root" }],
        },
        selected.run.events,
        observability,
      ).status,
    ).toBe("unobserved");
  });

  it("refuses ambiguous parallel edges and colon-key collisions", () => {
    const selected = dataset();
    const observability = selectTelemetryObservability(selected);
    const duplicated = {
      ...architecture,
      edges: [
        ...architecture.edges,
        { id: "parallel", source: "agent:root", target: "tool:search" },
      ],
    };
    expect(
      selectConnectionObservation(
        architecture.edges[0]!,
        duplicated,
        selected.run.events,
        observability,
      ).status,
    ).toBe("ambiguous");

    const collisionGraph: ArchitectureGraph = {
      ...architecture,
      edges: [{ id: "other-pair", source: "agent", target: "root:tool:search" }],
    };
    expect(
      selectConnectionObservation(
        collisionGraph.edges[0]!,
        collisionGraph,
        selected.run.events,
        observability,
      ).status,
    ).toBe("ambiguous");
  });

  it("shows honest empty detail when the chosen connection has no observed calls", () => {
    const selected = dataset();
    expect(
      selectConnectionObservation(
        architecture.edges[1]!,
        architecture,
        selected.run.events,
        selectTelemetryObservability(selected),
      ).status,
    ).toBe("unobserved");
    const html = renderToStaticMarkup(
      createElement(Inspector, {
        entity: undefined,
        currentEvent: undefined,
        connectedEntities: [],
        isLive: false,
        connection: {
          source: architecture.entities[0]!,
          target: architecture.entities[2]!,
          emptyReason: "unobserved",
        },
      }),
    );
    expect(html).toContain("Root agent");
    expect(html).toContain("Destination");
    expect(html).toContain("No observed statistics for this connection");
    expect(html).not.toContain("0 calls");
  });
});

describe("connection selection lifetime", () => {
  beforeEach(() => {
    useVisualizationStore.setState({
      dataset: dataset(),
      showExecution: false,
      layerFilter: "all",
    });
    useVisualizationStore.getState().loadDataset(dataset());
  });

  it("keeps node and connection inspection exclusive and clears on view/run changes", () => {
    const state = useVisualizationStore.getState();
    state.selectConnection("canvas:search");
    expect(useVisualizationStore.getState().selectedEntityId).toBeUndefined();
    expect(useVisualizationStore.getState().selectedConnectionId).toBe("canvas:search");
    state.selectEntity("agent:root");
    expect(useVisualizationStore.getState().selectedConnectionId).toBeUndefined();
    state.selectConnection(undefined);
    expect(useVisualizationStore.getState().selectedEntityId).toBe("agent:root");

    state.selectConnection("canvas:search");
    state.setLayerFilter("runtime");
    expect(useVisualizationStore.getState().selectedConnectionId).toBeUndefined();
    state.selectConnection("canvas:search");
    state.toggleExecutionOverlay();
    expect(useVisualizationStore.getState().selectedConnectionId).toBeUndefined();
    state.selectConnection("canvas:search");
    state.loadDataset(dataset([]));
    expect(useVisualizationStore.getState().selectedConnectionId).toBeUndefined();
    state.selectConnection("canvas:search");
    state.setMode("live");
    expect(useVisualizationStore.getState().selectedConnectionId).toBeUndefined();

    state.selectConnection("canvas:search");
    const codex = dataset();
    codex.source = "codex";
    codex.session = { ...codex.session!, source: "codex" };
    state.loadDataset(codex);
    expect(useVisualizationStore.getState().selectedConnectionId).toBeUndefined();
    state.selectConnection("canvas:search");
    expect(useVisualizationStore.getState().selectedConnectionId).toBeUndefined();
  });

  it("retains a selected connection through late spans but clears it if the graph removes the edge", () => {
    const state = useVisualizationStore.getState();
    state.selectConnection("canvas:search");
    const metrics = {
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      toolCallCount: 1,
      modelCallCount: 0,
      status: "completed" as const,
      totalDurationMs: 1000,
      endedAt: "2026-10-01T00:00:01.000Z",
    };
    state.applyLiveDelta({ events: [], rawEvents: {}, architecture, metrics, diagnostics: [] });
    expect(useVisualizationStore.getState().selectedConnectionId).toBe("canvas:search");
    state.applyLiveDelta({
      events: [],
      rawEvents: {},
      architecture: { ...architecture, edges: [architecture.edges[1]!] },
      metrics,
      diagnostics: [],
    });
    expect(useVisualizationStore.getState().selectedConnectionId).toBeUndefined();

    state.selectConnection("canvas:model");
    state.applyLiveDelta({
      events: [],
      rawEvents: {},
      architecture: {
        ...architecture,
        edges: [{ id: "canvas:model", source: "model:one", target: "agent:root" }],
      },
      metrics,
      diagnostics: [],
    });
    expect(useVisualizationStore.getState().selectedConnectionId).toBeUndefined();
  });
});
