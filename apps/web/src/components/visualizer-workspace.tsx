"use client";

import { useEffect, useState } from "react";
import { Inspector } from "@visual-system/ui";
import { ArchitectureCanvas } from "./architecture-canvas";
import { ExecutionDock } from "./execution-dock";
import { RunsPanel } from "./runs-panel";
import { SourcePanel } from "./source-panel";
import { TopBar } from "./top-bar";
import { demoArchitecture, demoRun } from "@/lib/fixtures";
import {
  displayedArchitecture,
  useVisualizationStore,
  type LiveDelta,
  type PublicSessionSummary,
  type VisualizationDataset,
} from "@/store/visualization-store";

type CodexSnapshot = Omit<VisualizationDataset, "source"> & { cursor: number };

export function VisualizerWorkspace() {
  const mode = useVisualizationStore((state) => state.mode);
  const dataset = useVisualizationStore((state) => state.dataset);
  const setMode = useVisualizationStore((state) => state.setMode);
  const selectedEntityId = useVisualizationStore((state) => state.selectedEntityId);
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
  const selectEntity = useVisualizationStore((state) => state.selectEntity);
  const viewEntityEvents = useVisualizationStore((state) => state.viewEntityEvents);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [streamSessionId, setStreamSessionId] = useState<string>();

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
    if (!streamSessionId) return;
    const stream = new EventSource(
      `/api/codex/sessions/${encodeURIComponent(streamSessionId)}/stream`,
    );
    const onSnapshot = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as CodexSnapshot;
      loadDataset({ ...payload, source: "codex" }, true);
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
  }, [applyLiveDelta, loadDataset, setSourceError, setTailConnected, streamSessionId]);

  const selectDemo = () => {
    setStreamSessionId(undefined);
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
    if (session.id === streamSessionId) {
      setSourceLoading(false);
      setSourceOpen(false);
      return;
    }
    setSourceLoading(true);
    setSourceError(undefined);
    setStreamSessionId(session.id);
  };

  const selectRepository = async (force = false) => {
    setSourceLoading(true);
    setSourceError(undefined);
    try {
      const response = await fetch(`/api/repository${force ? "?rescan=1" : ""}`, {
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
  };

  const visibleArchitecture = displayedArchitecture({ dataset, showExecution });
  const selectedEntity = visibleArchitecture.entities.find(
    (entity) => entity.id === selectedEntityId,
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
        : (dataset.session?.cwd?.split("/").filter(Boolean).at(-1) ?? "Codex session");
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
      />
      <section className="relative min-h-0 min-w-0">
        <ArchitectureCanvas />
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
          onRepository={(force) => void selectRepository(force)}
          onSession={selectSession}
        />
        {mode === "runs" ? <RunsPanel onReplay={replayRun} /> : null}
      </section>
      <Inspector
        entity={selectedEntity}
        currentEvent={mode === "live" ? snapshot.currentEvent : undefined}
        connectedEntities={connectedEntities}
        isLive={mode === "live"}
        rawEvent={snapshot.currentEvent ? dataset.rawEvents[snapshot.currentEvent.id] : undefined}
        diagnostics={dataset.diagnostics}
        runLabel={
          dataset.source === "demo"
            ? "Demo fixture"
            : dataset.source === "repository"
              ? dataset.session
                ? "Repository + Codex session"
                : "Static repository analysis"
              : "Local Codex session"
        }
        repositoryFiles={architectureFiles}
        runtimeActivity={
          selectedEntity ? dataset.reconciliation?.activities[selectedEntity.id] : undefined
        }
        onSelectEntity={selectEntity}
        onViewEvents={selectedEntity ? () => viewEntityEvents(selectedEntity.id) : undefined}
      />
      <ExecutionDock />
    </main>
  );
}
