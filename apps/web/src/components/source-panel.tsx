"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ChevronRight,
  CloudCog,
  FileCode2,
  FlaskConical,
  FolderKanban,
  LoaderCircle,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import type { RepositoryAnalysis } from "@visual-system/analyzer";
import type { CapabilityReport, RuntimeSourceCapability } from "@visual-system/capabilities";
import { Badge, Button, cn } from "@visual-system/ui";
import type { DataSource, PublicSessionSummary } from "@/store/visualization-store";
import {
  isLiveSession,
  relativeTime,
  sessionRelationToRepository,
  sortSessionsNewestFirst,
} from "@/lib/landing";
import { discoverLocalSessions } from "@/lib/sessions-client";

type Fixture = "fastapi" | "polyglot" | "terraform" | "kubernetes" | "helm" | "infrastructure";

const agents = [
  { id: "claude", label: "Claude Code", command: "claude", tone: "text-amber-300 bg-amber-300/10" },
  { id: "codex", label: "Codex", command: "codex", tone: "text-emerald-300 bg-emerald-300/10" },
  {
    id: "telemetry",
    label: "Telemetry",
    command: "",
    tone: "text-violet-300 bg-violet-300/10",
  },
] as const;

const agentOf = (session: PublicSessionSummary) =>
  agents.find((agent) => agent.id === (session.source ?? "codex")) ?? agents[1];

export function sessionLabel(session: PublicSessionSummary) {
  const directory = session.cwd?.split("/").filter(Boolean).at(-1);
  return (
    directory ||
    session.title ||
    session.serviceName ||
    session.fileName?.replace(".jsonl", "") ||
    session.id
  );
}

function SectionTitle({
  step,
  title,
  hint,
  action,
}: {
  step: string;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 mt-5 px-1 first:mt-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-4 place-items-center rounded-full bg-white/[0.06] font-mono text-[0.5625rem] text-slate-400">
            {step}
          </span>
          <h3 className="text-xs font-semibold text-slate-200">{title}</h3>
        </div>
        {action}
      </div>
      <p className="mt-1 pl-6 text-[0.6875rem] leading-4 text-slate-600">{hint}</p>
    </div>
  );
}

function agentStatus(source: RuntimeSourceCapability | undefined) {
  if (!source) return { dot: "bg-slate-600", text: "checking…" };
  if (source.count > 0)
    return {
      dot: "bg-emerald-400",
      text: `${source.count} ${source.id === "telemetry" ? "spans" : source.count === 1 ? "session" : "sessions"} found`,
    };
  if (source.availability === "error") return { dot: "bg-rose-400", text: "could not be read" };
  if (source.availability === "available")
    return { dot: "bg-amber-300", text: "installed · no sessions yet" };
  return { dot: "bg-slate-600", text: "not found on this machine" };
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
  onRepository: (force?: boolean, fixture?: Fixture) => void;
  onSession: (session: PublicSessionSummary) => void;
  capabilities?: CapabilityReport;
  onConnectTelemetry: () => void;
}) {
  const [sessions, setSessions] = useState<PublicSessionSummary[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string>();
  const [scope, setScope] = useState<"repository" | "all">();
  const [examplesOpen, setExamplesOpen] = useState(false);

  const discover = useCallback(async (background = false) => {
    if (!background) setDiscovering(true);
    setDiscoveryError(undefined);
    try {
      const { sessions: discovered, failed } = await discoverLocalSessions();
      if (failed.length === 2)
        throw new Error("Avalok's local server did not answer. Is `avalok` still running?");
      setSessions(sortSessionsNewestFirst(discovered));
      if (failed.length === 1)
        setDiscoveryError(
          failed[0] === "codex"
            ? "Codex sessions could not be listed. Other sessions are shown."
            : "Claude Code and OpenTelemetry sessions could not be listed. Codex sessions are shown.",
        );
    } catch (caught) {
      setDiscoveryError(caught instanceof Error ? caught.message : "Discovery failed.");
    } finally {
      if (!background) setDiscovering(false);
    }
  }, []);

  const repositoryRoot = repository?.repository.rootPath;
  const repositoryName = repository?.repository.name ?? "this repository";
  const { related, others } = useMemo(() => {
    const related: PublicSessionSummary[] = [];
    const others: PublicSessionSummary[] = [];
    for (const session of sessions)
      (sessionRelationToRepository(session, repositoryRoot) === "other" ? others : related).push(
        session,
      );
    return { related, others };
  }, [sessions, repositoryRoot]);
  // Until the user chooses, show this repository's sessions if it has any, otherwise everything.
  const effectiveScope = scope ?? (related.length > 0 ? "repository" : "all");
  const visible = (effectiveScope === "repository" ? related : sessions).slice(0, 40);

  useEffect(() => {
    if (!open) return;
    void discover();
    const interval = window.setInterval(() => void discover(true), 2_000);
    return () => window.clearInterval(interval);
  }, [discover, open]);

  if (!open) return null;

  const statusOf = (id: string) => capabilities?.sources.find((source) => source.id === id);
  const rescanFixture: Fixture | undefined =
    repository?.repository.name === "python-fastapi"
      ? "fastapi"
      : repository?.repository.name === "polyglot-ai-platform"
        ? "polyglot"
        : repository?.repository.name === "infrastructure-ai-platform"
          ? "infrastructure"
          : repository?.repository.name === "terraform-aws"
            ? "terraform"
            : repository?.repository.name === "kubernetes-app"
              ? "kubernetes"
              : repository?.repository.name === "helm-app"
                ? "helm"
                : undefined;
  const fixtureButton = "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs";

  return (
    <section className="absolute left-3 top-3 z-30 flex max-h-[calc(100%-24px)] w-[400px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-[#0d1119]/95 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between border-b border-white/[0.07] px-4 py-3.5">
        <div>
          <div className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-slate-600">
            Source
          </div>
          <h2 className="mt-1 text-sm font-semibold text-slate-100">What do you want to see?</h2>
          <p className="mt-1 max-w-[300px] text-[0.6875rem] leading-4 text-slate-500">
            The map shows your code's architecture. Open an agent session to see what it did on it.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close source selector">
          <X className="size-4" />
        </Button>
      </div>

      <div className="overflow-y-auto p-3">
        <SectionTitle
          step="1"
          title="Agent sessions"
          hint="Found automatically on this machine. Nothing to install or configure."
          action={
            <button
              type="button"
              onClick={() => void discover()}
              className="text-slate-600 transition-colors hover:text-slate-300"
              aria-label="Refresh local sessions"
            >
              <RefreshCw className={cn("size-3.5", discovering && "animate-spin")} />
            </button>
          }
        />

        <div className="grid grid-cols-3 gap-1.5">
          {agents.map((agent) => {
            const status = agentStatus(statusOf(agent.id));
            return (
              <div
                key={agent.id}
                className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} />
                  <span className="truncate">{agent.label}</span>
                </div>
                <p className="mt-1 text-[0.625rem] leading-3.5 text-slate-600">{status.text}</p>
              </div>
            );
          })}
        </div>

        <div
          role="tablist"
          aria-label="Which sessions to list"
          className="mt-3 flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5"
        >
          {(
            [
              ["repository", `In ${repositoryName}`, related.length],
              ["all", "All on this machine", sessions.length],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={effectiveScope === id}
              onClick={() => setScope(id)}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[0.6875rem] text-slate-500 transition-colors hover:text-slate-200",
                effectiveScope === id && "bg-white/[0.07] text-slate-100",
              )}
            >
              <span className="truncate">{label}</span>
              <span className="font-mono text-[0.625rem] text-slate-600">{count}</span>
            </button>
          ))}
        </div>

        {discoveryError ? (
          <p className="mt-2 rounded-lg border border-rose-400/15 bg-rose-400/[0.05] p-3 text-xs leading-5 text-rose-300">
            {discoveryError}
          </p>
        ) : null}
        {discovering && sessions.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-5 text-xs text-slate-500">
            <LoaderCircle className="size-4 animate-spin" /> Looking for agent sessions…
          </div>
        ) : null}

        <div className="mt-2 grid gap-1">
          {visible.map((session) => {
            const agent = agentOf(session);
            const source = session.source ?? "codex";
            const live = isLiveSession(session);
            const relation = sessionRelationToRepository(session, repositoryRoot);
            const selected =
              (currentSource === source || currentSource === "repository") &&
              currentSessionId === session.id;
            return (
              <button
                key={`${source}:${session.id}`}
                type="button"
                onClick={() => onSession(session)}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-white/[0.035]",
                  selected && "border-cyan-300/15 bg-cyan-300/[0.05]",
                )}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.5625rem] uppercase tracking-wider",
                        agent.tone,
                      )}
                    >
                      {agent.label}
                    </span>
                    <span className="truncate text-xs font-medium text-slate-200">
                      {session.preview ?? sessionLabel(session)}
                    </span>
                  </span>
                  <span className="mt-1 block truncate font-mono text-[0.625rem] text-slate-600">
                    {relativeTime(session.modifiedAt)}
                    {selected
                      ? ` · ${currentEventCount} events`
                      : typeof session.eventCount === "number" && session.eventCount > 0
                        ? ` · ${session.eventCount} events`
                        : ""}
                    {session.preview ? ` · ${sessionLabel(session)}` : ""}
                    {relation === "parent" ? " · parent folder" : ""}
                    {relation === "other" && effectiveScope === "all" ? " · other project" : ""}
                  </span>
                </span>
                {selected && loading ? (
                  <LoaderCircle className="size-3.5 animate-spin text-cyan-300" />
                ) : live ? (
                  <span className="flex items-center gap-1.5 font-mono text-[0.5625rem] uppercase tracking-wider text-emerald-300">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                    </span>
                    running
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {!discovering && visible.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-white/[0.09] bg-black/15 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <TerminalSquare className="size-3.5 text-slate-500" />
              {effectiveScope === "repository"
                ? `No agent has run in ${repositoryName} yet`
                : "No agent sessions on this machine yet"}
            </div>
            <p className="mt-1.5 text-[0.6875rem] leading-5 text-slate-500">
              Start <code className="rounded bg-white/[0.06] px-1 text-slate-300">claude</code> or{" "}
              <code className="rounded bg-white/[0.06] px-1 text-slate-300">codex</code> in{" "}
              {effectiveScope === "repository" ? "this folder" : "any project"} and its session
              appears here by itself. No hooks or setup needed.
            </p>
            {effectiveScope === "repository" && others.length > 0 ? (
              <button
                type="button"
                onClick={() => setScope("all")}
                className="mt-2 text-[0.6875rem] text-cyan-300 hover:text-cyan-200"
              >
                Show {others.length} session{others.length === 1 ? "" : "s"} from other projects →
              </button>
            ) : null}
          </div>
        ) : null}

        {!sessions.some((session) => session.source === "telemetry") ? (
          <button
            type="button"
            onClick={onConnectTelemetry}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.6875rem] text-slate-600 transition-colors hover:text-slate-300"
          >
            <RadioTower className="size-3.5 shrink-0" />
            <span>
              Instrumented your own app with OpenTelemetry?{" "}
              <span className="text-cyan-300">See how →</span>
            </span>
          </button>
        ) : null}

        <SectionTitle
          step="2"
          title="Architecture"
          hint="What your code is made of: services, databases, infrastructure. Static and local."
        />
        <button
          type="button"
          onClick={() => onRepository(false)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
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
            <span className="block truncate text-sm font-medium text-slate-200">
              {repository ? repositoryName : "Current repository"}
            </span>
            <span className="mt-0.5 block text-xs text-slate-600">
              Map of the code in this folder
            </span>
          </span>
          <Badge>{repository?.metrics.cacheHit ? "cached" : "local"}</Badge>
        </button>
        <button
          type="button"
          onClick={onDemo}
          className={cn(
            "mt-1 flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
            currentSource === "demo"
              ? "border-cyan-300/20 bg-cyan-300/[0.06]"
              : "border-transparent hover:bg-white/[0.035]",
          )}
        >
          <span className="grid size-9 place-items-center rounded-lg border border-white/[0.07] bg-black/20 text-cyan-300">
            <FlaskConical className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-200">Demo</span>
            <span className="mt-0.5 block text-xs text-slate-600">
              A sample agent run, no setup needed
            </span>
          </span>
          <Badge>built in</Badge>
        </button>

        {currentSource === "repository" && repository ? (
          <div className="mt-2 rounded-lg border border-white/[0.055] bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-wider text-emerald-300/70">
                <ShieldCheck className="size-3.5" /> Static · local only
              </span>
              <button
                type="button"
                onClick={() => onRepository(true, rescanFixture)}
                className="flex items-center gap-1 font-mono text-[0.625rem] text-slate-500 hover:text-slate-300"
              >
                <RefreshCw className="size-3" /> Rescan
              </button>
            </div>
            <p className="mt-2 text-[0.6875rem] leading-5 text-slate-500">
              {repository.summary.services} services · {repository.summary.databases} databases ·{" "}
              {repository.summary.externalIntegrations} external integrations ·{" "}
              {repository.summary.architectureConfidence} confidence
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {repository.summary.languages.slice(0, 5).map((language) => (
                <Badge
                  key={language.language}
                  className="normal-case tracking-normal text-slate-500"
                >
                  {language.language} {language.percentage}%
                </Badge>
              ))}
            </div>
            <details className="mt-2 text-[0.625rem] text-slate-600">
              <summary className="cursor-pointer select-none font-mono hover:text-slate-400">
                Scan details
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
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
            </details>
            {repository.partial ? (
              <p className="mt-2 text-[0.6875rem] text-amber-300/70">
                Analysis partial · {repository.partialReasons.join(" ")}
              </p>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setExamplesOpen((value) => !value)}
          aria-expanded={examplesOpen}
          className="mt-4 flex w-full items-center gap-1.5 px-1 text-left font-mono text-[0.625rem] uppercase tracking-[0.14em] text-slate-600 hover:text-slate-400"
        >
          <ChevronRight
            className={cn("size-3 transition-transform", examplesOpen && "rotate-90")}
          />
          Example repositories
        </button>
        {examplesOpen ? (
          <div className="mt-1 grid grid-cols-2 gap-1">
            {(
              [
                ["fastapi", "FastAPI app", FileCode2],
                ["polyglot", "Polyglot platform", Boxes],
                ["infrastructure", "Infrastructure AI platform", CloudCog],
                ["terraform", "Terraform AWS", CloudCog],
                ["kubernetes", "Kubernetes", CloudCog],
                ["helm", "Helm chart", CloudCog],
              ] as const
            ).map(([fixture, label, Icon]) => (
              <button
                key={fixture}
                type="button"
                onClick={() => onRepository(false, fixture)}
                className={cn(
                  fixtureButton,
                  "text-slate-500 transition-colors hover:bg-white/[0.035] hover:text-slate-300",
                  fixture === "infrastructure" && "col-span-2",
                  rescanFixture === fixture && "bg-cyan-300/[0.05] text-slate-300",
                )}
              >
                <Icon className="size-3.5 shrink-0 text-indigo-300/70" /> {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="border-t border-rose-400/10 bg-rose-400/[0.04] px-4 py-2.5 text-xs text-rose-300">
          {error}
        </div>
      ) : (
        <div className="border-t border-white/[0.055] px-4 py-2.5 text-[0.6875rem] leading-4 text-slate-600">
          Local-first · read-only · no Avalok cloud upload
        </div>
      )}
    </section>
  );
}
