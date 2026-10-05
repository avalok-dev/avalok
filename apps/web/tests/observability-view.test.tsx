import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VisualizationDataset } from "../src/store/visualization-store";
import { selectTelemetryObservability } from "../src/lib/observability-view";
import {
  ActivityStatisticsLine,
  RunObservabilitySummary,
} from "../src/components/observability-statistics";
import { RunMetrics } from "@visual-system/ui";

const graph: VisualizationDataset["architecture"] = {
  id: "fixture",
  title: "Fixture trace",
  entities: [
    { id: "root", kind: "agent", name: "Root agent" },
    { id: "sub", kind: "agent", name: "Research subagent" },
    { id: "model", kind: "model", name: "fixture-model" },
    { id: "tool", kind: "tool", name: "Search" },
  ],
  edges: [
    { id: "root-sub", source: "root", target: "sub" },
    { id: "sub-model", source: "sub", target: "model" },
    { id: "sub-tool", source: "sub", target: "tool" },
  ],
};

function dataset(
  events: VisualizationDataset["run"]["events"],
  source: VisualizationDataset["source"] = "telemetry",
): VisualizationDataset {
  return {
    source,
    architecture: graph,
    rawEvents: {},
    diagnostics: [],
    session: {
      id: "trace-fixture",
      source: "telemetry",
      startedAt: "2026-10-01T00:00:00.000Z",
      modifiedAt: "2026-10-01T00:00:01.000Z",
      status: "completed",
      eventCount: events.length,
    },
    run: {
      id: "trace-fixture",
      title: "Fixture trace",
      prompt: "Observed trace",
      startedAt: "2026-10-01T00:00:00.000Z",
      endedAt: "2026-10-01T00:00:01.000Z",
      totalDurationMs: 1000,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      toolCallCount: 0,
      modelCallCount: 0,
      status: "completed",
      events,
    },
  };
}

const root = {
  id: "span:root",
  traceId: "trace-fixture",
  spanId: "root-span",
  timestamp: 0,
  durationMs: 1000,
  category: "agent" as const,
  action: "agent.run",
  targetEntityId: "root",
  metadata: { imported: true, inputTokens: 10 },
};
const sub = {
  id: "span:sub",
  traceId: "trace-fixture",
  spanId: "sub-span",
  parentSpanId: "root-span",
  timestamp: 100,
  durationMs: 500,
  category: "agent" as const,
  action: "agent.run",
  sourceEntityId: "root",
  targetEntityId: "sub",
  metadata: { imported: true },
};
const model = {
  id: "span:model",
  traceId: "trace-fixture",
  spanId: "model-span",
  parentSpanId: "sub-span",
  timestamp: 200,
  durationMs: 100,
  category: "model" as const,
  action: "model.call",
  sourceEntityId: "sub",
  targetEntityId: "model",
  metadata: { imported: true, outputTokens: 0 },
};
const tool = {
  id: "span:tool",
  traceId: "trace-fixture",
  spanId: "tool-span",
  parentSpanId: "sub-span",
  timestamp: 350,
  durationMs: 20,
  category: "error" as const,
  action: "tool.call.error",
  sourceEntityId: "sub",
  targetEntityId: "tool",
  metadata: { imported: true, observedCategory: "tool", status: "error" },
};

describe("telemetry observability selection", () => {
  it("selects the current imported trace with named nodes and observed connections", () => {
    const selected = selectTelemetryObservability(dataset([root, sub, model, tool]));
    expect(selected?.imported).toBe(true);
    expect(selected?.run.callCount).toBe(4);
    expect(selected?.run.inputTokens).toBe(10);
    expect(selected?.run.outputTokens).toBe(0);
    expect(selected?.nodes.find((row) => row.id === "sub")?.label).toBe("Research subagent");
    expect(selected?.edges.find((row) => row.id === "edge:sub:tool")?.label).toBe(
      "Research subagent → Search",
    );
    expect(selected?.nodeById.tool?.failures).toBe(1);
    expect(selectTelemetryObservability(dataset([model]))?.run.callCount).toBe(1);
  });

  it("works for ordinary OTLP and a telemetry run inside the repository view; hides other sources", () => {
    const ordinary = { ...model, metadata: { outputTokens: 2 } };
    expect(selectTelemetryObservability(dataset([ordinary]))?.imported).toBe(false);
    expect(selectTelemetryObservability(dataset([ordinary], "repository"))?.run.outputTokens).toBe(
      2,
    );
    const other = dataset([ordinary], "codex");
    other.session = { ...other.session!, source: "codex" };
    expect(selectTelemetryObservability(other)).toBeUndefined();
  });

  it("renders missing usage and latency as unavailable while retaining observed zero", () => {
    const { durationMs: _durationMs, ...withoutDuration } = model;
    expect(_durationMs).toBe(100);
    const selected = selectTelemetryObservability(dataset([withoutDuration]))!;
    const summary = renderToStaticMarkup(
      createElement(RunObservabilitySummary, { statistics: selected.run }),
    );
    const detail = renderToStaticMarkup(
      createElement(ActivityStatisticsLine, { statistics: selected.nodes[0]!.statistics }),
    );
    expect(summary).toContain(
      'Available input tokens</div><div class="mt-1 font-mono text-xs text-slate-300">unavailable',
    );
    expect(summary).toContain(
      'Available output tokens</div><div class="mt-1 font-mono text-xs text-slate-300">0',
    );
    expect(summary).toContain("0 samples");
    expect(summary).toContain(
      'Observed duration</div><div class="mt-1 font-mono text-xs text-slate-300">unavailable',
    );
    expect(detail).toContain("P50 unavailable");
    expect(detail).toContain("Observed retries 0");
    expect(detail).toContain("Repeated attempts 0");
    expect(summary).not.toContain("cost");
    const dock = renderToStaticMarkup(
      createElement(RunMetrics, { run: dataset([root]).run, telemetry: true }),
    );
    expect(dock).toContain("Observed tokens");
    expect(dock).not.toContain("Est. cost");
  });
});
