"use client";

import { Radio, StepForward } from "lucide-react";
import { Button, PlaybackControls, RunMetrics, Timeline } from "@visual-system/ui";
import { useVisualizationStore } from "@/store/visualization-store";

export function ExecutionDock() {
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
          <div>
            <div className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-slate-600">
              Execution timeline
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
        <RunMetrics run={dataset.run} />
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
                      ? "Following local JSONL · architecture overlay active"
                      : "Following local JSONL · observable records only"
                    : "Live updates paused at selected time"
                  : "Historical local JSONL · reconnecting"
                : dataset.source === "repository"
                  ? "Static local analysis · no target code executed"
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
