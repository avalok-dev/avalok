"use client";

import { useEffect, useState } from "react";
import {
  Database,
  FlaskConical,
  FolderKanban,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import type { RepositoryAnalysis } from "@visual-system/analyzer";
import { Badge, Button, cn } from "@visual-system/ui";
import type { PublicSessionSummary } from "@/store/visualization-store";

function sessionLabel(session: PublicSessionSummary) {
  const directory = session.cwd?.split("/").filter(Boolean).at(-1);
  return directory || session.fileName.replace(".jsonl", "");
}

export function SourcePanel({
  open,
  currentSource,
  currentSessionId,
  currentEventCount,
  repository,
  loading,
  error,
  onClose,
  onDemo,
  onRepository,
  onSession,
}: {
  open: boolean;
  currentSource: "demo" | "codex" | "repository";
  currentSessionId: string | undefined;
  currentEventCount: number;
  repository: RepositoryAnalysis | undefined;
  loading: boolean;
  error: string | undefined;
  onClose: () => void;
  onDemo: () => void;
  onRepository: (force?: boolean) => void;
  onSession: (session: PublicSessionSummary) => void;
}) {
  const [sessions, setSessions] = useState<PublicSessionSummary[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string>();

  const discover = async () => {
    setDiscovering(true);
    setDiscoveryError(undefined);
    try {
      const response = await fetch("/api/codex/sessions", { cache: "no-store" });
      const payload = (await response.json()) as {
        sessions?: PublicSessionSummary[];
        error?: string;
      };
      if (!response.ok || !payload.sessions) throw new Error(payload.error ?? "Discovery failed.");
      setSessions(payload.sessions);
    } catch (caught) {
      setDiscoveryError(caught instanceof Error ? caught.message : "Discovery failed.");
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    if (open && sessions.length === 0 && !discovering) void discover();
  }, [open, sessions.length, discovering]);

  if (!open) return null;

  return (
    <section className="absolute left-3 top-3 z-30 flex max-h-[calc(100%-24px)] w-[360px] flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-[#0d1119]/95 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between border-b border-white/[0.07] px-4 py-3.5">
        <div>
          <div className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-slate-600">
            Data source
          </div>
          <h2 className="mt-1 text-sm font-semibold text-slate-100">Choose a system source</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close source selector">
          <X className="size-4" />
        </Button>
      </div>

      <div className="overflow-y-auto p-2">
        <button
          type="button"
          onClick={onDemo}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
            currentSource === "demo"
              ? "border-cyan-300/20 bg-cyan-300/[0.06]"
              : "border-transparent hover:bg-white/[0.035]",
          )}
        >
          <span className="grid size-9 place-items-center rounded-lg border border-white/[0.07] bg-black/20 text-cyan-300">
            <FlaskConical className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-200">Demo fixture</span>
            <span className="mt-0.5 block text-xs text-slate-600">
              Deterministic Milestone 1 replay
            </span>
          </span>
          <Badge>built in</Badge>
        </button>

        <button
          type="button"
          onClick={() => onRepository(false)}
          className={cn(
            "mt-1 flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
            currentSource === "repository"
              ? "border-cyan-300/20 bg-cyan-300/[0.06]"
              : "border-transparent hover:bg-white/[0.035]",
          )}
        >
          <span className="grid size-9 place-items-center rounded-lg border border-white/[0.07] bg-black/20 text-indigo-300">
            {loading && currentSource !== "codex" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <FolderKanban className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-200">Current repository</span>
            <span className="mt-0.5 block text-xs text-slate-600">
              Local static JS/TS architecture
            </span>
          </span>
          <Badge>{repository?.metrics.cacheHit ? "cached" : "local"}</Badge>
        </button>

        {currentSource === "repository" && repository ? (
          <div className="mx-2 mt-2 rounded-lg border border-white/[0.055] bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-wider text-emerald-300/70">
                <ShieldCheck className="size-3.5" /> Static · local only
              </span>
              <button
                type="button"
                onClick={() => onRepository(true)}
                className="flex items-center gap-1 font-mono text-[0.625rem] text-slate-500 hover:text-slate-300"
              >
                <RefreshCw className="size-3" /> Rescan
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[0.625rem] text-slate-600">
              <span>Discovered · {repository.metrics.filesDiscovered}</span>
              <span>Parsed · {repository.metrics.filesParsed}</span>
              <span>Ignored · {repository.metrics.filesIgnored}</span>
              <span>Packages · {repository.metrics.packagesDiscovered}</span>
              <span>Imports · {repository.metrics.importEdges}</span>
              <span>Unresolved · {repository.metrics.unresolvedImports}</span>
              <span>Entities · {repository.metrics.architectureEntities}</span>
              <span>Edges · {repository.metrics.architectureEdges}</span>
              <span>Warnings · {repository.metrics.warnings}</span>
              <span>Duration · {repository.metrics.durationMs} ms</span>
            </div>
            {repository.partial ? (
              <p className="mt-2 text-[0.6875rem] text-amber-300/70">
                Analysis partial · {repository.partialReasons.join(" ")}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mb-1 mt-4 flex items-center justify-between px-2">
          <div className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-slate-600">
            <Database className="size-3.5" /> Local Codex sessions
          </div>
          <button
            type="button"
            onClick={() => void discover()}
            className="text-slate-600 transition-colors hover:text-slate-300"
            aria-label="Refresh local sessions"
          >
            <RefreshCw className={cn("size-3.5", discovering && "animate-spin")} />
          </button>
        </div>

        {discoveryError ? (
          <p className="m-2 rounded-lg border border-rose-400/15 bg-rose-400/[0.05] p-3 text-xs leading-5 text-rose-300">
            {discoveryError}
          </p>
        ) : null}
        {discovering && sessions.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-5 text-xs text-slate-500">
            <LoaderCircle className="size-4 animate-spin" /> Discovering read-only JSONL sessions…
          </div>
        ) : null}

        <div className="grid gap-1">
          {sessions.slice(0, 40).map((session) => {
            const selected = currentSource !== "demo" && currentSessionId === session.id;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onSession(session)}
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-white/[0.035]",
                  selected && "border-cyan-300/15 bg-cyan-300/[0.05]",
                )}
              >
                <TerminalSquare className="size-4 text-slate-600" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-slate-300">
                    {sessionLabel(session)}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[0.625rem] text-slate-600">
                    {new Date(session.startedAt ?? session.modifiedAt).toLocaleString()}
                    {selected ? ` · ${currentEventCount} events` : ""}
                  </span>
                </span>
                {selected && loading ? (
                  <LoaderCircle className="size-3.5 animate-spin text-cyan-300" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div className="border-t border-rose-400/10 bg-rose-400/[0.04] px-4 py-2.5 text-xs text-rose-300">
          {error}
        </div>
      ) : (
        <div className="border-t border-white/[0.055] px-4 py-2.5 text-[0.6875rem] leading-4 text-slate-600">
          Local only · static analysis never executes target code
        </div>
      )}
    </section>
  );
}
