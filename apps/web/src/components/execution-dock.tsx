"use client";

import { useEffect, useState } from "react";
import { Radio, StepForward } from "lucide-react";
import type { Run } from "@visual-system/schema";
import { Button, PlaybackControls, RunMetrics, Timeline } from "@visual-system/ui";
import { deriveLiveActivity, formatElapsed, type LiveActivityState } from "@/lib/live-activity";
import { useVisualizationStore } from "@/store/visualization-store";

const activityDot: Record<LiveActivityState, string> = {
  running: "bg-cyan-300 motion-safe:animate-pulse",
  thinking: "bg-violet-300 motion-safe:animate-pulse",
  waiting: "bg-amber-300",
  idle: "bg-slate-600",
};

/** Mounted only while following a live session, so its 1 s clock never runs otherwise. */
function LiveActivityStrip({ run, modifiedAt }: { run: Run; modifiedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const activity = deriveLiveActivity(run, Date.parse(modifiedAt), now);
  if (!activity) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 font-mono text-[0.6875rem] text-slate-300">
      <span className={`size-1.5 shrink-0 rounded-full ${activityDot[activity.state]}`} />
      {/* Only the label is announced, so screen readers hear state changes, not every tick. */}
      <span aria-live="polite" className="truncate">
        {activity.label}
      </span>
      <span className="shrink-0 tabular-nums text-slate-500">
        {formatElapsed(now - activity.sinceMs)}
      </span>
    </div>
  );
}

export function ExecutionDock() {
  const mode = useVisualizationStore((state) => state.mode);
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const dataset = useVisualizationStore((state) => state.dataset);
  const togglePlayback = useVisualizationStore((state) => state.togglePlayback);
  const reset = useVisualizationStore((state) => state.reset);
  const seek = useVisualizationStore((state) => state.seek);
  const setSpeed = useVisualizationStore((state) => state.setSpeed);
  const liveFollowing = useVisualizationStore((state) => state.liveFollowing);
  const tailConnected = useVisualizationStore((state) => state.tailConnected);
  const jumpToLive = useVisualizationStore((state) => state.jumpToLive);

  return (
    <footer className="col-span-full grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(400px,0.75fr)] gap-4 border-t border-white/[0.065] bg-[#0b0e14] px-4 py-3.5">
      <div className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-slate-600">
                Execution timeline
              </div>
              {mode === "live" && dataset.session && tailConnected && liveFollowing ? (
                <LiveActivityStrip run={dataset.run} modifiedAt={dataset.session.modifiedAt} />
              ) : null}
            </div>
            <div className="mt-1 max-w-[430px] truncate text-xs text-slate-400">
              {dataset.run.prompt}
            </div>
          </div>
          <PlaybackControls
            isPlaying={snapshot.isPlaying}
            speed={snapshot.speed}
            elapsedMs={snapshot.currentTimestamp}
            totalMs={snapshot.durationMs}
            onToggle={togglePlayback}
            onReset={reset}
            onSpeedChange={setSpeed}
          />
        </div>
        <Timeline
          events={dataset.run.events}
          currentTimestamp={snapshot.currentTimestamp}
          totalDurationMs={snapshot.durationMs}
          onSeek={seek}
        />
      </div>
      <div className="min-w-0 border-l border-white/[0.065] pl-4">
        <div className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-slate-600">
          Run summary
        </div>
        <RunMetrics
          run={dataset.run}
          telemetry={dataset.source === "telemetry" || dataset.session?.source === "telemetry"}
        />
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 font-mono text-[0.6875rem] text-slate-600">
            {dataset.session ? (
              <Radio className="size-3.5 shrink-0" />
            ) : (
              <span className="size-1.5 shrink-0 rounded-full bg-cyan-300/70" />
            )}
            <span className="truncate">
              {dataset.session
                ? tailConnected
                  ? liveFollowing
                    ? dataset.source === "repository"
                      ? `Following ${dataset.session.source ?? "codex"} · architecture overlay active`
                      : `Following ${dataset.session.source ?? "codex"} · observable records only`
                    : "Live updates paused at selected time"
                  : `Historical ${dataset.session.source ?? "codex"} data · reconnecting`
                : dataset.source === "repository"
                  ? "Static analysis only · nothing to replay until you open an agent session"
                  : "Simulated observable events · no chain-of-thought"}
            </span>
          </div>
          {dataset.session && !liveFollowing ? (
            <Button size="sm" onClick={jumpToLive}>
              <StepForward className="size-3.5" /> Jump to live
            </Button>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
