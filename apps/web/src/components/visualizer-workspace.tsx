"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@visual-system/runtime-adapter";
import type { CapabilityReport } from "@visual-system/capabilities";
import { RadioTower } from "lucide-react";
import { Button } from "@visual-system/ui";
import { Inspector } from "@visual-system/ui";
import { ArchitectureCanvas } from "./architecture-canvas";
import { ExecutionDock } from "./execution-dock";
import { RunsPanel } from "./runs-panel";
import { SourcePanel } from "./source-panel";
import { TopBar } from "./top-bar";
import { GettingStarted } from "./getting-started";
import { ActivityStatisticsLine } from "./observability-statistics";
import {
  selectConnectionObservation,
  selectTelemetryObservability,
} from "@/lib/observability-view";
import { demoArchitecture, demoRun } from "@/lib/fixtures";
import {
  displayedArchitecture,
  useVisualizationStore,
  type LiveDelta,
  type PublicSessionSummary,
  type VisualizationDataset,
} from "@/store/visualization-store";

type CodexSnapshot = Omit<VisualizationDataset, "source"> & { cursor: number };
type StreamTarget = { source: "codex" | "claude" | "telemetry"; id: string };

export function VisualizerWorkspace() {
  const mode = useVisualizationStore((state) => state.mode);
  const dataset = useVisualizationStore((state) => state.dataset);
  const setMode = useVisualizationStore((state) => state.setMode);
  const selectedEntityId = useVisualizationStore((state) => state.selectedEntityId);
  const selectedConnectionId = useVisualizationStore((state) => state.selectedConnectionId);
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const tick = useVisualizationStore((state) => state.tick);
  const replayRun = useVisualizationStore((state) => state.replayRun);
  const loadDataset = useVisualizationStore((state) => state.loadDataset);
  const applyLiveDelta = useVisualizationStore((state) => state.applyLiveDelta);
  const tailConnected = useVisualizationStore((state) => state.tailConnected);
  const setTailConnected = useVisualizationStore((state) => state.setTailConnected);
  const sourceLoading = useVisualizationStore((state) => state.sourceLoading);
  const setSourceLoading = useVisualizationStore((state) => state.setSourceLoading);
  const sourceError = useVisualizationStore((state) => state.sourceError);
  const setSourceError = useVisualizationStore((state) => state.setSourceError);
  const loadRepository = useVisualizationStore((state) => state.loadRepository);
  const showExecution = useVisualizationStore((state) => state.showExecution);
  const layerFilter = useVisualizationStore((state) => state.layerFilter);
  const selectEntity = useVisualizationStore((state) => state.selectEntity);
  const viewEntityEvents = useVisualizationStore((state) => state.viewEntityEvents);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupView, setSetupView] = useState<"overview" | "telemetry">("overview");
  const [capabilities, setCapabilities] = useState<CapabilityReport>();
  const [streamTarget, setStreamTarget] = useState<StreamTarget>();
  const initialRepositoryRequested = useRef(false);

  const refreshCapabilities = useCallback(async () => {
    const response = await fetch("/api/capabilities", { cache: "no-store" });
    if (response.ok) setCapabilities((await response.json()) as CapabilityReport);
  }, []);

  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    void fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gettingStartedDismissed: true }),
    });
  }, []);

  useEffect(() => {
    if (!snapshot.isPlaying) return;
    let frame = 0;
    let previous = performance.now();
    const animate = (now: number) => {
      tick(Math.min(now - previous, 100));
      previous = now;
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [snapshot.isPlaying, tick]);

  useEffect(() => {
    if (!streamTarget) return;
    const stream = new EventSource(
      streamTarget.source === "codex"
        ? `/api/codex/sessions/${encodeURIComponent(streamTarget.id)}/stream`
        : `/api/runtime/runs/${streamTarget.source}/${encodeURIComponent(streamTarget.id)}/stream`,
    );
    const onSnapshot = (event: MessageEvent<string>) => {
      if (streamTarget.source === "codex") {
        const payload = JSON.parse(event.data) as CodexSnapshot;
        loadDataset(
          {
            ...payload,
            source: "codex",
            ...(payload.session ? { session: { ...payload.session, source: "codex" } } : {}),
          },
          true,
        );
      } else {
        const payload = JSON.parse(event.data) as RuntimeSnapshot;
        loadDataset(
          {
            source: payload.source.id,
            architecture: payload.architecture,
            run: payload.run,
            rawEvents: payload.rawEvents,
            diagnostics: payload.diagnostics,
            session: payload.session,
          },
          true,
        );
      }
      setTailConnected(true);
      setSourceOpen(false);
    };
    const onDelta = (event: MessageEvent<string>) => {
      applyLiveDelta(JSON.parse(event.data) as LiveDelta);
      setTailConnected(true);
    };
    const onAdapterError = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as { message?: string };
      setSourceError(payload.message ?? "The local session stream failed.");
    };
    stream.addEventListener("snapshot", onSnapshot as EventListener);
    stream.addEventListener("delta", onDelta as EventListener);
    stream.addEventListener("adapter-error", onAdapterError as EventListener);
    stream.onopen = () => setTailConnected(true);
    stream.onerror = () => setTailConnected(false);
    return () => {
      stream.close();
      setTailConnected(false);
    };
  }, [applyLiveDelta, loadDataset, setSourceError, setTailConnected, streamTarget]);

  const selectDemo = () => {
    setStreamTarget(undefined);
    loadDataset({
      source: "demo",
      architecture: demoArchitecture,
      run: demoRun,
      rawEvents: {},
      diagnostics: [],
    });
    setSourceOpen(false);
  };

  const selectSession = (session: PublicSessionSummary) => {
    const source = session.source ?? "codex";
    if (session.id === streamTarget?.id && source === streamTarget.source) {
      setSourceLoading(false);
      setSourceOpen(false);
      return;
    }
    setSourceLoading(true);
    setSourceError(undefined);
    setStreamTarget({ source, id: session.id });
  };

  const selectRepository = useCallback(
    async (
      force = false,
      fixture?: "fastapi" | "polyglot" | "terraform" | "kubernetes" | "helm" | "infrastructure",
    ) => {
      setSourceLoading(true);
      setSourceError(undefined);
      try {
        const parameters = new URLSearchParams();
        if (force) parameters.set("rescan", "1");
        if (fixture) parameters.set("fixture", fixture);
        const response = await fetch(`/api/repository${parameters.size ? `?${parameters}` : ""}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as
          import("@visual-system/analyzer").RepositoryAnalysis | { error?: string };
        if (!response.ok || !("graph" in payload)) {
          throw new Error("error" in payload ? payload.error : "Repository analysis failed.");
        }
        loadRepository(payload);
        if (!force) setSourceOpen(false);
      } catch (caught) {
        setSourceError(caught instanceof Error ? caught.message : "Repository analysis failed.");
      }
    },
    [loadRepository, setSourceError, setSourceLoading],
  );

  useEffect(() => {
    if (initialRepositoryRequested.current) return;
    let active = true;
    void fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ cli?: boolean }>)
      .then((health) => {
        if (active && health.cli && !initialRepositoryRequested.current) {
          initialRepositoryRequested.current = true;
          void Promise.all([
            selectRepository(),
            refreshCapabilities(),
            fetch("/api/settings", { cache: "no-store" })
              .then((response) => response.json() as Promise<{ gettingStartedDismissed?: boolean }>)
              .then((settings) => {
                if (active && !settings.gettingStartedDismissed) setSetupOpen(true);
              }),
          ]);
        }
      })
      .catch(() => {
        // Readiness was already established by the CLI; keep Demo usable if this request fails.
      });
    return () => {
      active = false;
    };
  }, [refreshCapabilities, selectRepository]);

  const connectTelemetry = () => {
    setSetupView("telemetry");
    setSetupOpen(true);
    void refreshCapabilities();
  };

  const viewLatestSynthetic = async () => {
    const response = await fetch("/api/runtime/runs", { cache: "no-store" });
    const payload = (await response.json()) as { runs?: PublicSessionSummary[] };
    const session =
      payload.runs?.find(
        (item) =>
          item.source === "telemetry" &&
          // Runs migrated from AgentMap-era data keep the fixture's former service name.
          (item.serviceName === "Avalok Synthetic Fixture" ||
            item.serviceName === "AgentMap Synthetic Fixture"),
      ) ?? payload.runs?.find((item) => item.source === "telemetry");
    if (session) selectSession(session);
    setMode("live");
    closeSetup();
  };

  const visibleArchitecture = useMemo(
    () => displayedArchitecture({ dataset, showExecution, layerFilter }),
    [dataset, showExecution, layerFilter],
  );
  const observability = useMemo(() => selectTelemetryObservability(dataset), [dataset]);
  const selectedEntity = visibleArchitecture.entities.find(
    (entity) => entity.id === selectedEntityId,
  );
  const selectedStatistics = selectedEntity
    ? observability?.nodeById[selectedEntity.id]
    : undefined;
  const selectedConnection = visibleArchitecture.edges.find(
    (edge) => edge.id === selectedConnectionId,
  );
  const connectionObservation = useMemo(
    () =>
      selectedConnection
        ? selectConnectionObservation(
            selectedConnection,
            visibleArchitecture,
            dataset.run.events,
            observability,
          )
        : undefined,
    [selectedConnection, visibleArchitecture, dataset.run.events, observability],
  );
  const connectionSource = visibleArchitecture.entities.find(
    (entity) => entity.id === selectedConnection?.source,
  );
  const connectionTarget = visibleArchitecture.entities.find(
    (entity) => entity.id === selectedConnection?.target,
  );
  const connectedIds = selectedEntity
    ? visibleArchitecture.edges.flatMap((edge) => {
        if (edge.source === selectedEntity.id) return [edge.target];
        if (edge.target === selectedEntity.id) return [edge.source];
        return [];
      })
    : [];
  const connectedEntities = visibleArchitecture.entities.filter((entity) =>
    connectedIds.includes(entity.id),
  );
  const sourceLabel =
    dataset.source === "demo"
      ? "demo/research-agent"
      : dataset.source === "repository"
        ? (dataset.repository?.repository.name ?? "Current repository")
        : (dataset.session?.cwd?.split("/").filter(Boolean).at(-1) ??
          dataset.session?.serviceName ??
          (dataset.source === "claude"
            ? "Claude Code"
            : dataset.source === "telemetry"
              ? "Telemetry"
              : "Codex session"));
  const architectureFiles = selectedEntity
    ? dataset.repository?.files.filter((file) => {
        const architecture = selectedEntity.metadata?.architecture as
          { sourceFiles?: string[] } | undefined;
        return architecture?.sourceFiles?.includes(file.path);
      })
    : undefined;

  return (
    <main className="visualizer-shell grid h-dvh min-h-[700px] grid-cols-[minmax(0,1fr)_320px] grid-rows-[56px_minmax(0,1fr)_176px] overflow-hidden bg-[#080a0f] text-slate-200">
      <TopBar
        mode={mode}
        onModeChange={setMode}
        isPlaying={snapshot.isPlaying}
        sourceLabel={sourceLabel}
        isTailConnected={tailConnected}
        onSourceClick={() => setSourceOpen((open) => !open)}
        onSetupClick={() => {
          setSetupView("overview");
          setSetupOpen(true);
          void refreshCapabilities();
        }}
      />
      <section className="relative min-h-0 min-w-0">
        <ArchitectureCanvas observability={observability} />
        {mode === "map" && visibleArchitecture.entities.length === 0 ? (
          <div className="absolute inset-0 z-20 grid place-items-center p-6">
            <div className="max-w-sm rounded-xl border border-white/[0.08] bg-[#10151d]/95 p-5 text-center shadow-2xl">
              <h2 className="text-sm font-semibold text-slate-100">Repository analyzed</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                No supported static architecture was inferred. Detected languages remain visible in
                Setup, and runtime telemetry can still build an execution view.
              </p>
              <Button size="sm" className="mt-4" onClick={connectTelemetry}>
                Connect telemetry
              </Button>
            </div>
          </div>
        ) : null}
        <SourcePanel
          open={sourceOpen}
          currentSource={dataset.source}
          currentSessionId={dataset.session?.id}
          currentEventCount={dataset.run.events.length}
          repository={dataset.repository}
          loading={sourceLoading}
          error={sourceError}
          onClose={() => setSourceOpen(false)}
          onDemo={selectDemo}
          onRepository={(force, fixture) => void selectRepository(force, fixture)}
          onSession={selectSession}
          {...(capabilities ? { capabilities } : {})}
          onConnectTelemetry={connectTelemetry}
        />
        {mode === "live" && dataset.run.events.length === 0 ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-[#080b10]/45 p-6">
            <div className="max-w-sm rounded-xl border border-white/[0.08] bg-[#10151d]/95 p-5 text-center shadow-2xl">
              <RadioTower className="mx-auto size-5 text-cyan-300" />
              <h2 className="mt-3 text-sm font-semibold text-slate-100">Nothing live yet</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Avalok is ready. Select an available local agent session or connect your application
                with telemetry.
              </p>
              <Button size="sm" className="mt-4" onClick={connectTelemetry}>
                Connect telemetry
              </Button>
            </div>
          </div>
        ) : null}
        {mode === "runs" ? (
          <RunsPanel
            onReplay={replayRun}
            onConnectTelemetry={connectTelemetry}
            {...(observability ? { observability } : {})}
          />
        ) : null}
      </section>
      <Inspector
        entity={selectedEntity}
        {...(connectionSource && connectionTarget
          ? {
              connection: {
                source: connectionSource,
                target: connectionTarget,
                ...(connectionObservation?.status === "observed"
                  ? {
                      observedActivity: (
                        <ActivityStatisticsLine statistics={connectionObservation.statistics} />
                      ),
                    }
                  : { emptyReason: connectionObservation?.status ?? "unobserved" }),
              },
            }
          : {})}
        currentEvent={mode === "live" ? snapshot.currentEvent : undefined}
        connectedEntities={connectedEntities}
        isLive={mode === "live"}
        rawEvent={snapshot.currentEvent ? dataset.rawEvents[snapshot.currentEvent.id] : undefined}
        traceEvents={dataset.run.events.filter(
          (event) => event.traceId === snapshot.currentEvent?.traceId,
        )}
        diagnostics={dataset.diagnostics}
        runLabel={
          dataset.source === "demo"
            ? "Demo fixture"
            : dataset.source === "repository"
              ? dataset.session
                ? `Repository + ${
                    dataset.session.source === "claude"
                      ? "Claude Code"
                      : dataset.session.source === "telemetry"
                        ? "telemetry"
                        : "Codex"
                  } session`
                : "Static repository analysis"
              : dataset.source === "claude"
                ? "Local Claude Code session"
                : dataset.source === "telemetry"
                  ? "Local telemetry trace"
                  : "Local Codex session"
        }
        observedActivity={
          selectedStatistics ? (
            <ActivityStatisticsLine statistics={selectedStatistics} />
          ) : undefined
        }
        repositoryFiles={architectureFiles}
        runtimeActivity={
          selectedEntity ? dataset.reconciliation?.activities[selectedEntity.id] : undefined
        }
        onSelectEntity={selectEntity}
        onViewEvents={selectedEntity ? () => viewEntityEvents(selectedEntity.id) : undefined}
      />
      <ExecutionDock />
      {setupOpen && capabilities ? (
        <GettingStarted
          report={capabilities}
          view={setupView}
          onViewChange={setSetupView}
          onClose={closeSetup}
          onViewMap={() => {
            setMode("map");
            closeSetup();
          }}
          onViewLive={() => void viewLatestSynthetic()}
          onRefresh={() => void refreshCapabilities()}
        />
      ) : null}
    </main>
  );
}
