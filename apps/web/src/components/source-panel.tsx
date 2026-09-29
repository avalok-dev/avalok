"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Database,
  Boxes,
  CloudCog,
  FileCode2,
  FlaskConical,
  FolderKanban,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  RadioTower,
  TerminalSquare,
  X,
} from "lucide-react";
import type { RepositoryAnalysis } from "@visual-system/analyzer";
import type { CapabilityReport } from "@visual-system/capabilities";
import { Badge, Button, cn } from "@visual-system/ui";
import type { DataSource, PublicSessionSummary } from "@/store/visualization-store";

function sessionLabel(session: PublicSessionSummary) {
  const directory = session.cwd?.split("/").filter(Boolean).at(-1);
  return (
    directory ||
    session.title ||
    session.serviceName ||
    session.fileName?.replace(".jsonl", "") ||
    session.id
  );
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
  capabilities,
  onConnectTelemetry,
}: {
  open: boolean;
  currentSource: DataSource;
  currentSessionId: string | undefined;
  currentEventCount: number;
  repository: RepositoryAnalysis | undefined;
  loading: boolean;
  error: string | undefined;
  onClose: () => void;
  onDemo: () => void;
  onRepository: (
    force?: boolean,
    fixture?: "fastapi" | "polyglot" | "terraform" | "kubernetes" | "helm" | "infrastructure",
  ) => void;
  onSession: (session: PublicSessionSummary) => void;
  capabilities?: CapabilityReport;
  onConnectTelemetry: () => void;
}) {
  const [sessions, setSessions] = useState<PublicSessionSummary[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string>();

  const discover = useCallback(async (background = false) => {
    if (!background) setDiscovering(true);
    setDiscoveryError(undefined);
    try {
      const [codexResponse, runtimeResponse] = await Promise.all([
        fetch("/api/codex/sessions", { cache: "no-store" }),
        fetch("/api/runtime/runs", { cache: "no-store" }),
      ]);
      const payload = (await codexResponse.json()) as {
        sessions?: PublicSessionSummary[];
        error?: string;
      };
      const runtimePayload = (await runtimeResponse.json()) as {
        runs?: PublicSessionSummary[];
        error?: string;
      };
      if (!codexResponse.ok || !payload.sessions)
        throw new Error(payload.error ?? "Codex discovery failed.");
      if (!runtimeResponse.ok || !runtimePayload.runs)
        throw new Error(runtimePayload.error ?? "Runtime discovery failed.");
      const discovered = [
        ...runtimePayload.runs,
        ...payload.sessions.map((session) => ({ ...session, source: "codex" as const })),
      ];
      setSessions(
        discovered.filter(
          (session, index) =>
            discovered.findIndex(
              (candidate) =>
                (candidate.source ?? "codex") === (session.source ?? "codex") &&
                candidate.id === session.id,
            ) === index,
        ),
      );
    } catch (caught) {
      setDiscoveryError(caught instanceof Error ? caught.message : "Discovery failed.");
    } finally {
      if (!background) setDiscovering(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void discover();
    const interval = window.setInterval(() => void discover(true), 2_000);
    return () => window.clearInterval(interval);
  }, [discover, open]);

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
            {loading && !["codex", "claude", "telemetry"].includes(currentSource) ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <FolderKanban className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-200">Current repository</span>
            <span className="mt-0.5 block text-xs text-slate-600">
              Local code, deployment, and infrastructure architecture
            </span>
          </span>
          <Badge>{repository?.metrics.cacheHit ? "cached" : "local"}</Badge>
        </button>

        <div className="mt-1 grid grid-cols-2 gap-1 px-1">
          <button
            type="button"
            onClick={() => onRepository(false, "fastapi")}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-xs text-slate-500 transition-colors hover:bg-white/[0.035] hover:text-slate-300",
              repository?.repository.name === "python-fastapi" &&
                "border-cyan-300/15 bg-cyan-300/[0.05] text-slate-300",
            )}
          >
            <FileCode2 className="size-3.5 text-indigo-300/70" /> FastAPI fixture
          </button>
          <button
            type="button"
            onClick={() => onRepository(false, "polyglot")}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-xs text-slate-500 transition-colors hover:bg-white/[0.035] hover:text-slate-300",
              repository?.repository.name === "polyglot-ai-platform" &&
                "border-cyan-300/15 bg-cyan-300/[0.05] text-slate-300",
            )}
          >
            <Boxes className="size-3.5 text-indigo-300/70" /> Polyglot fixture
          </button>
          <button
            type="button"
            onClick={() => onRepository(false, "infrastructure")}
            className={cn(
              "col-span-2 flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-xs text-slate-500 transition-colors hover:bg-white/[0.035] hover:text-slate-300",
              repository?.repository.name === "infrastructure-ai-platform" &&
                "border-cyan-300/15 bg-cyan-300/[0.05] text-slate-300",
            )}
          >
            <CloudCog className="size-3.5 text-cyan-300/70" /> Infrastructure AI platform
          </button>
          {(
            [
              ["terraform", "Terraform AWS"],
              ["kubernetes", "Kubernetes"],
              ["helm", "Helm chart"],
            ] as const
          ).map(([fixture, label]) => (
            <button
              key={fixture}
              type="button"
              onClick={() => onRepository(false, fixture)}
              className="flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-xs text-slate-500 transition-colors hover:bg-white/[0.035] hover:text-slate-300"
            >
              <CloudCog className="size-3.5 text-indigo-300/70" /> {label}
            </button>
          ))}
        </div>

        {currentSource === "repository" && repository ? (
          <div className="mx-2 mt-2 rounded-lg border border-white/[0.055] bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-wider text-emerald-300/70">
                <ShieldCheck className="size-3.5" /> Static · local only
              </span>
              <button
                type="button"
                onClick={() =>
                  onRepository(
                    true,
                    repository.repository.name === "python-fastapi"
                      ? "fastapi"
                      : repository.repository.name === "polyglot-ai-platform"
                        ? "polyglot"
                        : repository.repository.name === "infrastructure-ai-platform"
                          ? "infrastructure"
                          : repository.repository.name === "terraform-aws"
                            ? "terraform"
                            : repository.repository.name === "kubernetes-app"
                              ? "kubernetes"
                              : repository.repository.name === "helm-app"
                                ? "helm"
                                : undefined,
                  )
                }
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
              <span>Infrastructure · {repository.metrics.infrastructureResources}</span>
              <span>Terraform · {repository.metrics.terraformFiles}</span>
              <span>Kubernetes · {repository.metrics.kubernetesDocuments}</span>
              <span>Imports · {repository.metrics.importEdges}</span>
              <span>Unresolved · {repository.metrics.unresolvedImports}</span>
              <span>Entities · {repository.metrics.architectureEntities}</span>
              <span>Edges · {repository.metrics.architectureEdges}</span>
              <span>Warnings · {repository.metrics.warnings}</span>
              <span>Duration · {repository.metrics.durationMs} ms</span>
            </div>
            <div className="mt-3 border-t border-white/[0.055] pt-2">
              <div className="flex flex-wrap gap-1">
                {repository.summary.languages.slice(0, 5).map((language) => (
                  <Badge
                    key={language.language}
                    className="normal-case tracking-normal text-slate-500"
                  >
                    {language.language} {language.percentage}%
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-[0.6875rem] leading-5 text-slate-600">
                {repository.summary.services} services · {repository.summary.databases} databases ·{" "}
                {repository.summary.externalIntegrations} external integrations ·{" "}
                {repository.summary.architectureConfidence} confidence
              </p>
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
            <Database className="size-3.5" /> Local runtime sources
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

        {capabilities ? (
          <div className="mb-2 grid gap-1 px-1">
            {capabilities.sources.slice(0, 3).map((source) => (
              <div
                key={source.id}
                className="rounded-lg border border-white/[0.05] bg-black/15 px-3 py-2"
              >
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>{source.label}</span>
                  <Badge>
                    {source.observation === "observed"
                      ? "observed"
                      : source.connection === "listening"
                        ? "listening"
                        : source.connection === "not-configured"
                          ? "not configured"
                          : source.connection === "ready"
                            ? "available"
                            : source.availability === "error"
                              ? "error"
                              : "not detected"}
                  </Badge>
                </div>
                <p className="mt-1 text-[0.6875rem] leading-5 text-slate-600">{source.detail}</p>
              </div>
            ))}
          </div>
        ) : null}

        {discoveryError ? (
          <p className="m-2 rounded-lg border border-rose-400/15 bg-rose-400/[0.05] p-3 text-xs leading-5 text-rose-300">
            {discoveryError}
          </p>
        ) : null}
        {discovering && sessions.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-5 text-xs text-slate-500">
            <LoaderCircle className="size-4 animate-spin" /> Discovering local runtime data…
          </div>
        ) : null}

        <div className="grid gap-1">
          {sessions.slice(0, 40).map((session) => {
            const selected =
              (currentSource === (session.source ?? "codex") || currentSource === "repository") &&
              currentSessionId === session.id;
            return (
              <button
                key={`${session.source ?? "codex"}:${session.id}`}
                type="button"
                onClick={() => onSession(session)}
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-white/[0.035]",
                  selected && "border-cyan-300/15 bg-cyan-300/[0.05]",
                )}
              >
                {session.source === "telemetry" ? (
                  <RadioTower className="size-4 text-slate-600" />
                ) : (
                  <TerminalSquare className="size-4 text-slate-600" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-slate-300">
                    {sessionLabel(session)}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[0.625rem] text-slate-600">
                    {(session.source ?? "codex") === "codex"
                      ? "Codex"
                      : session.source === "claude"
                        ? "Claude Code"
                        : "OTLP"}
                    {" · "}
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

        {!sessions.some((session) => session.source === "telemetry") ? (
          <button
            type="button"
            onClick={onConnectTelemetry}
            className="mx-2 mt-3 w-[calc(100%-16px)] rounded-lg border border-cyan-300/10 bg-cyan-300/[0.025] p-3 text-left text-[0.6875rem] leading-5 text-slate-500 hover:text-slate-300"
          >
            Nothing live yet. Sarvadrik is ready to receive OTLP/HTTP traces.{" "}
            <span className="text-cyan-300">Connect telemetry →</span>
          </button>
        ) : null}
        {!sessions.some((session) => session.source === "claude") ? (
          <p className="mx-2 mt-2 rounded-lg border border-white/[0.055] bg-black/20 p-3 text-[0.6875rem] leading-5 text-slate-600">
            Claude Code appears here after its optional local HTTP hooks send an observation.
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="border-t border-rose-400/10 bg-rose-400/[0.04] px-4 py-2.5 text-xs text-rose-300">
          {error}
        </div>
      ) : (
        <div className="border-t border-white/[0.055] px-4 py-2.5 text-[0.6875rem] leading-4 text-slate-600">
          Local-first · no Sarvadrik cloud upload
        </div>
      )}
    </section>
  );
}
