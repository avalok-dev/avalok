import { Pause, Play, RotateCcw } from "lucide-react";
import { replaySpeeds, type ReplaySpeed } from "@visual-system/replay";
import { Button } from "./primitives/button";
import { cn } from "./lib/cn";

export interface PlaybackControlsProps {
  isPlaying: boolean;
  speed: ReplaySpeed;
  elapsedMs: number;
  totalMs: number;
  onToggle: () => void;
  onReset: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
}

const time = (value: number) => `${(value / 1_000).toFixed(1)}s`;

export function PlaybackControls({
  isPlaying,
  speed,
  elapsedMs,
  totalMs,
  onToggle,
  onReset,
  onSpeedChange,
}: PlaybackControlsProps) {
  return (
    <div className="flex items-center gap-2.5">
      <Button
        size="icon"
        onClick={onToggle}
        aria-label={isPlaying ? "Pause replay" : "Play replay"}
        className="rounded-full"
      >
        {isPlaying ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}
      </Button>
      <Button variant="ghost" size="icon" onClick={onReset} aria-label="Reset replay">
        <RotateCcw className="size-3.5" />
      </Button>
      <span className="w-[76px] font-mono text-xs tabular-nums text-slate-400">
        <span className="text-slate-200">{time(elapsedMs)}</span> / {time(totalMs)}
      </span>
      <div className="ml-1 flex items-center rounded-md border border-white/[0.07] bg-black/15 p-0.5">
        {replaySpeeds.map((option) => (
          <button
            type="button"
            key={option}
            onClick={() => onSpeedChange(option)}
            className={cn(
              "rounded px-2 py-1 font-mono text-[0.6875rem] text-slate-500 transition-colors hover:text-slate-200",
              option === speed && "bg-white/[0.09] text-cyan-200",
            )}
            aria-pressed={option === speed}
          >
            {option}x
          </button>
        ))}
      </div>
    </div>
  );
}
