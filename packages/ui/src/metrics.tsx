import type { Run } from "@visual-system/schema";
import React from "react";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function RunMetrics({ run, telemetry = false }: { run: Run; telemetry?: boolean }) {
  const tokens =
    run.inputTokens === null || run.outputTokens === null
      ? "Unavailable"
      : compact.format(run.inputTokens + run.outputTokens);
  const metrics: [string, string][] = [
    ["Duration", `${(run.totalDurationMs / 1_000).toFixed(1)} sec`],
    [telemetry ? "Observed tokens" : "Tokens", tokens],
    ["Model calls", String(run.modelCallCount)],
    ["Tool calls", String(run.toolCallCount)],
  ];
  if (!telemetry) {
    metrics.push([
      "Est. cost",
      run.estimatedCostUsd === null ? "Unavailable" : `$${run.estimatedCostUsd.toFixed(3)}`,
    ]);
  }

  return (
    <div
      className={`grid ${telemetry ? "grid-cols-4" : "grid-cols-5"} divide-x divide-white/[0.065] overflow-hidden rounded-lg border border-white/[0.065] bg-black/15`}
    >
      {metrics.map(([label, value]) => (
        <div key={label} className="px-3 py-2.5">
          <div className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-slate-600">
            {label}
          </div>
          <div className="mt-1 font-mono text-sm font-medium tabular-nums text-slate-200">
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}
