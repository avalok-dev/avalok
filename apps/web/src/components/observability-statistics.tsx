import type { ActivityStatistics } from "@visual-system/telemetry-adapter/observability";
import React from "react";

const number = (value: number) => value.toLocaleString("en-US");
const available = (value: number | null) => (value === null ? "unavailable" : number(value));
const percent = (value: number | null) =>
  value === null ? "unavailable" : `${(value * 100).toFixed(1)}%`;
const latency = (value: number | null) =>
  value === null ? "unavailable" : `${number(Math.round(value))} ms`;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.055] bg-black/20 px-3 py-2.5">
      <div className="font-mono text-[0.625rem] uppercase tracking-[0.11em] text-slate-600">
        {label}
      </div>
      <div className="mt-1 font-mono text-xs text-slate-300">{value}</div>
    </div>
  );
}

export function RunObservabilitySummary({ statistics }: { statistics: ActivityStatistics }) {
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      aria-label="Run observability statistics"
    >
      <Metric label="Calls" value={number(statistics.callCount)} />
      <Metric
        label="Failures"
        value={`${number(statistics.failures)} · ${percent(statistics.failureRate)}`}
      />
      <Metric
        label="P50 / P95 latency"
        value={`${latency(statistics.p50LatencyMs)} / ${latency(statistics.p95LatencyMs)} · ${number(statistics.latencySampleCount)} samples`}
      />
      <Metric
        label="Observed duration"
        value={
          statistics.latencySampleCount === 0
            ? "unavailable"
            : `${number(statistics.totalDurationMs)} ms cumulative`
        }
      />
      <Metric label="Available input tokens" value={available(statistics.inputTokens)} />
      <Metric label="Available output tokens" value={available(statistics.outputTokens)} />
      <Metric label="Observed retries" value={number(statistics.observedRetries)} />
      <Metric label="Repeated attempts" value={number(statistics.repeatedAttempts)} />
    </div>
  );
}

export function ActivityStatisticsLine({ statistics }: { statistics: ActivityStatistics }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[0.6875rem] leading-5 text-slate-500">
      <span>{number(statistics.callCount)} calls</span>
      <span>
        {number(statistics.failures)} failures · {percent(statistics.failureRate)}
      </span>
      <span>
        P50 {latency(statistics.p50LatencyMs)} · P95 {latency(statistics.p95LatencyMs)} ·{" "}
        {number(statistics.latencySampleCount)} samples
      </span>
      <span>
        Input tokens {available(statistics.inputTokens)} · Output tokens{" "}
        {available(statistics.outputTokens)}
      </span>
      <span>Observed retries {number(statistics.observedRetries)}</span>
      <span>Repeated attempts {number(statistics.repeatedAttempts)}</span>
    </div>
  );
}
