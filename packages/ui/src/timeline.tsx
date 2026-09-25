import type { RuntimeEvent } from "@visual-system/schema";
import { cn } from "./lib/cn";

export interface TimelineProps {
  events: readonly RuntimeEvent[];
  currentTimestamp: number;
  totalDurationMs: number;
  onSeek: (timestamp: number) => void;
}

const categoryColor: Record<RuntimeEvent["category"], string> = {
  prompt: "bg-violet-400",
  http: "bg-blue-400",
  agent: "bg-cyan-300",
  model: "bg-fuchsia-400",
  tool: "bg-amber-400",
  retrieval: "bg-teal-400",
  memory: "bg-emerald-400",
  database: "bg-orange-400",
  web: "bg-sky-400",
  file: "bg-lime-400",
  mcp: "bg-yellow-300",
  response: "bg-cyan-200",
  error: "bg-rose-400",
};

export function Timeline({ events, currentTimestamp, totalDurationMs, onSeek }: TimelineProps) {
  const scaleDurationMs = Math.max(totalDurationMs, 1);
  return (
    <div className="min-w-0 flex-1">
      <div className="relative h-[38px] overflow-hidden rounded-md border border-white/[0.065] bg-black/20 px-1.5">
        <div
          className="absolute inset-y-0 left-0 z-10 w-px bg-cyan-200/90 shadow-[0_0_12px_#67e8f9]"
          style={{ left: `${(currentTimestamp / scaleDurationMs) * 100}%` }}
        />
        {events.map((event) => {
          const left = (event.timestamp / scaleDurationMs) * 100;
          const width = Math.max(((event.durationMs ?? 180) / scaleDurationMs) * 100, 0.7);
          const isPast = event.timestamp <= currentTimestamp;
          return (
            <div
              key={event.id}
              className={cn(
                "absolute top-2 h-5 rounded-[3px] opacity-25 transition-opacity duration-200",
                categoryColor[event.category],
                isPast && "opacity-85",
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${event.action} · ${event.durationMs ?? 0}ms`}
            />
          );
        })}
        <input
          className="timeline-range absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0"
          aria-label="Seek through execution"
          type="range"
          min={0}
          max={scaleDurationMs}
          value={currentTimestamp}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[0.6875rem] text-slate-600">
        <span>0s</span>
        <span>observable event timeline</span>
        <span>{(totalDurationMs / 1_000).toFixed(1)}s</span>
      </div>
    </div>
  );
}
