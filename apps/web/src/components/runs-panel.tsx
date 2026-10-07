"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Play,
  RadioTower,
  TerminalSquare,
} from "lucide-react";
import { Badge, Button } from "@visual-system/ui";
import { prepareRunExportV1, type RunExportV1 } from "@visual-system/schema";
import { useVisualizationStore } from "@/store/visualization-store";
import type { ObservabilityView, ObservedStatisticsRow } from "@/lib/observability-view";
import { ActivityStatisticsLine, RunObservabilitySummary } from "./observability-statistics";
import { deriveRunInsights } from "@/lib/run-insights";

function ObservedRows({ title, rows }: { title: string; rows: ObservedStatisticsRow[] }) {
  return (
    <section>
      <h3 className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-slate-500">
        {title} · {rows.length}
      </h3>
      {rows.length ? (
        <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
          {rows.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-white/[0.055] bg-black/15 px-3 py-2.5"
            >
              <div className="truncate text-xs font-medium text-slate-300" title={row.label}>
                {row.label}
              </div>
              <div className="mt-1">
                <ActivityStatisticsLine statistics={row.statistics} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-600">No {title.toLowerCase()}.</p>
      )}
    </section>
  );
}

export function EmptyRunsState({
  onChooseSource,
  onDemo,
}: {
  onChooseSource: () => void;
  onDemo: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-[#080b10]/65 p-6 backdrop-blur-[4px]">
      <section className="w-full max-w-lg rounded-2xl border border-white/[0.09] bg-[#10141c] p-6 text-center shadow-2xl">
        <RadioTower className="mx-auto size-6 text-cyan-300/80" />
        <h2 className="mt-3 text-base font-semibold text-slate-100">No runs yet</h2>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-slate-500">
          Open a local Codex or Claude Code session to see its runs. Everything is read on this
          machine and nothing is sent anywhere.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button size="sm" onClick={onChooseSource}>
            Choose a session
          </Button>
          <Button size="sm" variant="ghost" onClick={onDemo}>
            Explore the demo
          </Button>
        </div>
      </section>
    </div>
  );
}

export function RunsPanel({
  onReplay,
  onChooseSource,
  onDemo,
  observability,
}: {
  onReplay: () => void;
  onChooseSource: () => void;
  onDemo: () => void;
  observability?: ObservabilityView;
}) {
  const dataset = useVisualizationStore((state) => state.dataset);
  const run = dataset.run;
  const insights = deriveRunInsights(run);
  const [preparedExport, setPreparedExport] = useState<string>();
  const [exportError, setExportError] = useState(false);
  const prepareExport = () => {
    try {
      const source: RunExportV1["source"] | undefined =
        dataset.session?.source ?? (dataset.source === "repository" ? undefined : dataset.source);
      if (!source) throw new Error("The run source is unavailable.");
      const payload = prepareRunExportV1(
        dataset.executionRun ?? run,
        dataset.executionArchitecture ?? dataset.architecture,
        source,
      );
      setPreparedExport(`${JSON.stringify(payload, null, 2)}\n`);
      setExportError(false);
    } catch {
      setPreparedExport(undefined);
      setExportError(true);
    }
  };
  const downloadExport = () => {
    if (!preparedExport) return;
    const url = URL.createObjectURL(new Blob([preparedExport], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "avalok-run-export-v1.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  if (run.events.length === 0) {
    return <EmptyRunsState onChooseSource={onChooseSource} onDemo={onDemo} />;
  }
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-[#080b10]/75 p-6 backdrop-blur-[6px]">
      <section className="max-h-[calc(100dvh-3rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/[0.09] bg-[#10141c] shadow-[0_28px_90px_rgba(0,0,0,0.58)]">
        <div className="flex items-start justify-between border-b border-white/[0.065] px-5 py-4">
          <div>
            <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-slate-600">
              Recent runs
            </div>
            <h2 className="mt-1.5 text-base font-semibold text-slate-100">
              {preparedExport ? "Review run export" : "Observable execution history"}
            </h2>
          </div>
          <Badge className="border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300">
            {dataset.source === "demo"
              ? "local fixture"
              : observability?.imported
                ? "OpenAI import"
                : dataset.session?.source === "telemetry"
                  ? "local OTLP"
                  : dataset.session?.source === "claude"
                    ? "Claude Code"
                    : "local JSONL"}
          </Badge>
        </div>
        {preparedExport ? (
          <section className="space-y-3 px-5 py-4" aria-label="Run export preview">
            <p className="text-xs leading-5 text-slate-400">
              This is the exact JSON that will be saved to your device. It contains event timing,
              categories, counts, and numbered entity kinds. Prompts, responses, names, paths,
              original IDs, and event metadata are excluded. No data is sent to Avalok Cloud.
            </p>
            <pre className="max-h-[min(50dvh,32rem)] overflow-auto rounded-lg border border-white/[0.07] bg-black/30 p-3 font-mono text-[0.6875rem] leading-5 text-slate-300">
              {preparedExport}
            </pre>
            <div className="flex justify-between gap-2">
              <Button size="sm" onClick={() => setPreparedExport(undefined)}>
                <ArrowLeft className="size-3.5" /> Back to run
              </Button>
              <Button size="sm" onClick={downloadExport}>
                <Download className="size-3.5" /> Download reviewed JSON
              </Button>
            </div>
          </section>
        ) : (
          <>
            <div className="p-3">
              <button
                type="button"
                onClick={onReplay}
                className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-white/[0.065] bg-black/15 p-4 text-left transition-colors hover:border-cyan-300/20 hover:bg-cyan-300/[0.025]"
              >
                <div className="grid size-10 place-items-center rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-300">
                  <TerminalSquare className="size-[18px]" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-200">{run.title}</span>
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
                  </div>
                  <div className="mt-1.5 truncate font-mono text-xs text-slate-600">
                    {run.prompt}
                  </div>
                  <div className="mt-2 flex gap-3 font-mono text-[0.6875rem] text-slate-500">
                    <span>{(run.totalDurationMs / 1000).toFixed(1)}s</span>
                    <span>{run.events.length} events</span>
                    <span>
                      {run.inputTokens === null || run.outputTokens === null
                        ? "tokens unavailable"
                        : `${run.inputTokens + run.outputTokens} tokens`}
                    </span>
                  </div>
                </div>
                <ArrowRight className="size-4 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-300" />
              </button>
            </div>
            {observability ? (
              <div className="space-y-5 border-t border-white/[0.055] px-5 py-4">
                <section>
                  <h3 className="mb-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-slate-500">
                    Observed run statistics
                  </h3>
                  <RunObservabilitySummary statistics={observability.run} />
                </section>
                <ObservedRows title="Observed nodes" rows={observability.nodes} />
                <ObservedRows title="Observed connections" rows={observability.edges} />
              </div>
            ) : null}
            {insights.length ? (
              <section
                className="border-t border-white/[0.055] px-5 py-4"
                aria-label="Local run findings"
              >
                <h3 className="mb-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-slate-500">
                  Local run findings
                </h3>
                <div className="space-y-2">
                  {insights.map((insight) => (
                    <div
                      key={insight.id}
                      className="rounded-lg border border-white/[0.055] bg-black/15 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                        {insight.severity === "warning" ? (
                          <AlertTriangle className="size-3.5 text-amber-300" aria-hidden="true" />
                        ) : null}
                        {insight.title}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{insight.detail}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <div className="flex items-center justify-between border-t border-white/[0.055] bg-black/10 px-5 py-3">
              <span className="text-xs text-slate-600">
                {dataset.source === "demo"
                  ? "Milestone 1 demo fixture."
                  : `${dataset.diagnostics.length} adapter diagnostics · raw and normalized records available.`}
              </span>
              <div className="flex gap-2">
                <Button size="sm" onClick={prepareExport}>
                  Prepare export
                </Button>
                <Button size="sm" onClick={onReplay}>
                  <Play className="size-3.5" /> Replay run
                </Button>
              </div>
            </div>
            {exportError ? (
              <p role="alert" className="px-5 py-2 text-xs text-amber-300">
                This run could not be prepared for export.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
