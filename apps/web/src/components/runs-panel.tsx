"use client";

import { ArrowRight, CheckCircle2, Play, RadioTower, TerminalSquare } from "lucide-react";
import { Badge, Button } from "@visual-system/ui";
import { useVisualizationStore } from "@/store/visualization-store";
import type { ObservabilityView, ObservedStatisticsRow } from "@/lib/observability-view";
import { ActivityStatisticsLine, RunObservabilitySummary } from "./observability-statistics";

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

export function RunsPanel({
  onReplay,
  onConnectTelemetry,
  observability,
}: {
  onReplay: () => void;
  onConnectTelemetry: () => void;
  observability?: ObservabilityView;
}) {
  const dataset = useVisualizationStore((state) => state.dataset);
  const run = dataset.run;
  if (run.events.length === 0) {
    return (
      <div className="absolute inset-0 z-20 grid place-items-center bg-[#080b10]/65 p-6 backdrop-blur-[4px]">
        <section className="w-full max-w-lg rounded-2xl border border-white/[0.09] bg-[#10141c] p-6 text-center shadow-2xl">
          <RadioTower className="mx-auto size-6 text-cyan-300/80" />
          <h2 className="mt-3 text-base font-semibold text-slate-100">No runs yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-slate-500">
            Runs appear after Avalok observes an available Codex or Claude Code source, or receives
            OpenTelemetry/OpenInference activity.
          </p>
          <Button size="sm" className="mt-4" onClick={onConnectTelemetry}>
            Connect telemetry
          </Button>
        </section>
      </div>
    );
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
              Observable execution history
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
              <div className="mt-1.5 truncate font-mono text-xs text-slate-600">{run.prompt}</div>
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
        <div className="flex items-center justify-between border-t border-white/[0.055] bg-black/10 px-5 py-3">
          <span className="text-xs text-slate-600">
            {dataset.source === "demo"
              ? "Milestone 1 demo fixture."
              : `${dataset.diagnostics.length} adapter diagnostics · raw and normalized records available.`}
          </span>
          <Button size="sm" onClick={onReplay}>
            <Play className="size-3.5" /> Replay run
          </Button>
        </div>
      </section>
    </div>
  );
}
