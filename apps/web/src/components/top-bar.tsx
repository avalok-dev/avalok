"use client";

import {
  Activity,
  Boxes,
  ChevronDown,
  CircleDotDashed,
  HelpCircle,
  Radio,
  Rows3,
} from "lucide-react";
import { Badge, cn } from "@visual-system/ui";
import type { VisualizerMode } from "@/store/visualization-store";

const modes = [
  { id: "map", label: "Map", icon: Boxes },
  { id: "live", label: "Live", icon: Radio },
  { id: "runs", label: "Runs", icon: Rows3 },
] as const;

export function TopBar({
  mode,
  onModeChange,
  isPlaying,
  sourceLabel,
  isTailConnected,
  onSourceClick,
  onSetupClick,
}: {
  mode: VisualizerMode;
  onModeChange: (mode: VisualizerMode) => void;
  isPlaying: boolean;
  sourceLabel: string;
  isTailConnected: boolean;
  onSourceClick: () => void;
  onSetupClick: () => void;
}) {
  return (
    <header className="col-span-full flex min-w-0 items-center border-b border-white/[0.065] bg-[#090c11]/95 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative grid size-8 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-300">
          <CircleDotDashed className="size-[18px]" />
          <span className="absolute inset-0 animate-[spin_10s_linear_infinite] rounded-lg border-t border-cyan-200/50" />
        </div>
        <div className="hidden items-baseline gap-2 sm:flex">
          <span className="text-sm font-semibold tracking-[-0.02em] text-slate-100">Avalok</span>
          <Badge className="border-white/[0.06] text-[0.6rem]">preview</Badge>
        </div>
        <div className="mx-2 hidden h-4 w-px bg-white/[0.08] md:block" />
        <button
          type="button"
          onClick={onSourceClick}
          aria-label={`Select data source (${sourceLabel})`}
          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-white/[0.04]"
        >
          <span className="hidden font-mono text-[0.6875rem] text-slate-600 lg:inline">SOURCE</span>
          <span className="hidden max-w-[140px] truncate font-mono text-xs text-slate-300 md:inline lg:max-w-[220px]">
            {sourceLabel}
          </span>
          <ChevronDown className="size-3 text-slate-600" />
        </button>
      </div>

      <nav
        className="ml-4 flex items-center rounded-lg border border-white/[0.07] bg-white/[0.025] p-1 xl:absolute xl:left-1/2 xl:ml-0 xl:-translate-x-1/2"
        aria-label="Visualization mode"
      >
        {modes.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            onClick={() => onModeChange(id)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-slate-500 transition-colors hover:text-slate-200",
              mode === id && "bg-white/[0.075] text-slate-100 shadow-sm",
            )}
            aria-current={mode === id ? "page" : undefined}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-slate-500">
        <button
          type="button"
          onClick={onSetupClick}
          className="mr-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-slate-500 hover:bg-white/[0.04] hover:text-slate-200"
          aria-label="Open Getting Started"
        >
          <HelpCircle className="size-3.5" />
          <span className="hidden md:inline">Setup</span>
        </button>
        <span className="relative flex size-2">
          {isPlaying || isTailConnected ? (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
          ) : null}
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              isPlaying || isTailConnected ? "bg-emerald-400" : "bg-slate-600",
            )}
          />
        </span>
        <span className="hidden sm:inline">
          {isTailConnected ? "live local" : isPlaying ? "replaying" : "local"}
        </span>
        <Activity className="ml-1 size-3.5 text-slate-600" />
      </div>
    </header>
  );
}
