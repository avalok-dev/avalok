import { create } from "zustand";
import type { RepositoryAnalysis } from "@visual-system/analyzer";
import type { AdapterDiagnostic } from "@visual-system/codex-adapter";
import {
  reconcileArchitectureExecution,
  type ReconciliationResult,
} from "@visual-system/reconcile";
import { ReplayEngine, type ReplaySnapshot, type ReplaySpeed } from "@visual-system/replay";
import type { ArchitectureGraph, Run, RuntimeEvent } from "@visual-system/schema";
import { demoArchitecture, demoRun } from "@/lib/fixtures";

export type VisualizerMode = "map" | "live" | "runs";
export type DataSource = "demo" | "codex" | "claude" | "telemetry" | "repository";
export type ArchitectureLayerFilter = "all" | "application" | "infrastructure" | "runtime";

export interface PublicSessionSummary {
  id: string;
  source?: "codex" | "claude" | "telemetry";
  title?: string;
  fileName?: string;
  startedAt: string | null;
  modifiedAt: string;
  bytes?: number;
  lineCount?: number | null;
  eventCount: number | null;
  cwd?: string | null;
  originator?: string | null;
  cliVersion?: string | null;
  status: "active" | "completed" | "error" | "unknown";
  serviceName?: string;
  traceId?: string;
}

export interface VisualizerDiagnostic extends AdapterDiagnostic {
  file?: string;
  stage?: string;
}

export interface VisualizationDataset {
  source: DataSource;
  architecture: ArchitectureGraph;
  run: Run;
  rawEvents: Record<string, unknown>;
  diagnostics: VisualizerDiagnostic[];
  session?: PublicSessionSummary;
  repository?: RepositoryAnalysis;
  executionArchitecture?: ArchitectureGraph;
  executionRun?: Run;
  reconciliation?: ReconciliationResult;
}

export interface LiveDelta {
  events: RuntimeEvent[];
  rawEvents: Record<string, unknown>;
  architecture: ArchitectureGraph;
  metrics: Pick<
    Run,
    | "inputTokens"
    | "outputTokens"
    | "estimatedCostUsd"
    | "toolCallCount"
    | "modelCallCount"
    | "status"
    | "totalDurationMs"
    | "endedAt"
  >;
  diagnostics: AdapterDiagnostic[];
}

const initialDataset: VisualizationDataset = {
  source: "demo",
  architecture: demoArchitecture,
  run: demoRun,
  rawEvents: {},
  diagnostics: [],
};

let engine = new ReplayEngine(demoRun.events, { durationMs: demoRun.totalDurationMs });

function engineFor(run: Run, tailPadding = 0) {
  return new ReplayEngine(run.events, { durationMs: run.totalDurationMs + tailPadding });
}

function graphIdentity(graph: ArchitectureGraph) {
  return JSON.stringify([
    graph.entities.map((entity) => entity.id),
    graph.edges.map((edge) => [edge.id, edge.source, edge.target]),
  ]);
}

function emptyRepositoryRun(repository: RepositoryAnalysis): Run {
  return {
    id: `repository:${repository.fingerprint.slice(0, 12)}`,
    title: `${repository.repository.name} · static analysis`,
    prompt: "Static repository architecture analysis",
    startedAt: repository.analyzedAt,
    endedAt: repository.analyzedAt,
    totalDurationMs: 0,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    toolCallCount: 0,
    modelCallCount: 0,
    status: "completed",
    events: [],
  };
}

function reconciledRepositoryDataset(
  repository: RepositoryAnalysis,
  execution: VisualizationDataset,
): VisualizationDataset {
  const executionArchitecture = execution.executionArchitecture ?? execution.architecture;
  const executionRun = execution.executionRun ?? execution.run;
  const reconciliation = reconcileArchitectureExecution(
    repository.graph,
    executionArchitecture,
    executionRun.events,
    {
      repositoryRoot: repository.repository.rootPath,
      ...(execution.session?.cwd ? { runtimeCwd: execution.session.cwd } : {}),
    },
  );
  return {
    source: "repository",
    architecture: repository.graph,
    run: { ...executionRun, events: reconciliation.events },
    executionRun,
    executionArchitecture,
    reconciliation,
    repository,
    rawEvents: execution.rawEvents,
    diagnostics: [...repository.diagnostics, ...execution.diagnostics],
    ...(execution.session ? { session: execution.session } : {}),
  };
}

function activeEntityForEvent(event: RuntimeEvent | undefined) {
  const reconciled = Array.isArray(event?.metadata?.architectureEntityIds)
    ? event.metadata.architectureEntityIds.find(
        (entityId): entityId is string => typeof entityId === "string",
      )
    : undefined;
  return reconciled ?? event?.targetEntityId ?? event?.sourceEntityId;
}

interface VisualizationState {
  mode: VisualizerMode;
  dataset: VisualizationDataset;
  selectedEntityId: string | undefined;
  selectedConnectionId: string | undefined;
  snapshot: ReplaySnapshot;
  autoFollow: boolean;
  liveFollowing: boolean;
  tailConnected: boolean;
  sourceLoading: boolean;
  sourceError: string | undefined;
  showExecution: boolean;
  layerFilter: ArchitectureLayerFilter;
  setMode: (mode: VisualizerMode) => void;
  selectEntity: (entityId: string | undefined) => void;
  selectConnection: (connectionId: string | undefined) => void;
  togglePlayback: () => void;
  reset: () => void;
  seek: (timestamp: number) => void;
  setSpeed: (speed: ReplaySpeed) => void;
  tick: (deltaMs: number) => void;
  replayRun: () => void;
  loadDataset: (dataset: VisualizationDataset, followLive?: boolean) => void;
  loadRepository: (analysis: RepositoryAnalysis) => void;
  applyLiveDelta: (delta: LiveDelta) => void;
  jumpToLive: () => void;
  toggleExecutionOverlay: () => void;
  setLayerFilter: (filter: ArchitectureLayerFilter) => void;
  viewEntityEvents: (entityId: string) => void;
  setTailConnected: (connected: boolean) => void;
  setSourceLoading: (loading: boolean) => void;
  setSourceError: (error: string | undefined) => void;
}

export const useVisualizationStore = create<VisualizationState>((set, get) => ({
  mode: "map",
  dataset: initialDataset,
  selectedEntityId: "agent",
  selectedConnectionId: undefined,
  snapshot: engine.snapshot(),
  autoFollow: false,
  liveFollowing: false,
  tailConnected: false,
  sourceLoading: false,
  sourceError: undefined,
  showExecution: false,
  layerFilter: "all",
  setMode: (mode) => {
    if (mode === "live") {
      const snapshot = engine.play();
      set({ mode, snapshot, autoFollow: true, selectedConnectionId: undefined });
    } else {
      if (mode === "map") engine.pause();
      set({ mode, snapshot: engine.snapshot(), autoFollow: false });
    }
  },
  selectEntity: (selectedEntityId) =>
    set({ selectedEntityId, selectedConnectionId: undefined, autoFollow: false }),
  selectConnection: (selectedConnectionId) => {
    if (!selectedConnectionId) {
      set({ selectedConnectionId: undefined });
      return;
    }
    const state = get();
    const telemetry =
      state.dataset.source === "telemetry" || state.dataset.session?.source === "telemetry";
    const visible = displayedArchitecture(state).edges.some(
      (edge) => edge.id === selectedConnectionId,
    );
    if (!telemetry || !visible) return;
    set({ selectedConnectionId, selectedEntityId: undefined, autoFollow: false });
  },
  togglePlayback: () => {
    const isPlaying = get().snapshot.isPlaying;
    const snapshot = isPlaying ? engine.pause() : engine.play();
    set({
      mode: "live",
      snapshot,
      autoFollow: !isPlaying,
      liveFollowing: false,
      selectedConnectionId: undefined,
    });
  },
  reset: () =>
    set({
      snapshot: engine.reset(),
      autoFollow: false,
      liveFollowing: false,
      selectedConnectionId: undefined,
    }),
  seek: (timestamp) =>
    set({
      mode: "live",
      snapshot: engine.seek(timestamp),
      autoFollow: false,
      liveFollowing: false,
      selectedConnectionId: undefined,
    }),
  setSpeed: (speed) => set({ snapshot: engine.setSpeed(speed) }),
  tick: (deltaMs) => {
    const state = get();
    if (!state.snapshot.isPlaying) return;
    const snapshot = engine.advance(deltaMs);
    const activeEntityId = activeEntityForEvent(snapshot.currentEvent);
    set({
      snapshot,
      selectedEntityId:
        state.autoFollow && activeEntityId ? activeEntityId : state.selectedEntityId,
    });
  },
  replayRun: () => {
    engine.reset();
    const dataset = get().dataset;
    const selectedEntityId =
      dataset.source === "repository"
        ? dataset.architecture.entities[0]?.id
        : dataset.architecture.entities.find((entity) => entity.kind === "user")?.id;
    set({
      mode: "live",
      snapshot: engine.play(),
      selectedEntityId,
      selectedConnectionId: undefined,
      autoFollow: true,
    });
  },
  loadDataset: (incoming, followLive = false) => {
    const current = get().dataset;
    const dataset =
      ["codex", "claude", "telemetry"].includes(incoming.source) &&
      current.source === "repository" &&
      current.repository
        ? reconciledRepositoryDataset(current.repository, incoming)
        : incoming;
    engine = engineFor(dataset.run, followLive ? 800 : 0);
    if (followLive) {
      engine.seek(dataset.run.events.at(-1)?.timestamp ?? dataset.run.totalDurationMs);
      engine.play();
    }
    set({
      dataset,
      mode: followLive ? "live" : "map",
      snapshot: engine.snapshot(),
      selectedEntityId:
        dataset.source === "repository"
          ? dataset.architecture.entities[0]?.id
          : dataset.architecture.entities.find((entity) => entity.kind === "agent")?.id,
      selectedConnectionId: undefined,
      autoFollow: followLive,
      liveFollowing: followLive,
      showExecution: dataset.source === "repository" && Boolean(dataset.session),
      layerFilter: "all",
      sourceLoading: false,
      sourceError: undefined,
    });
  },
  loadRepository: (repository) => {
    const current = get().dataset;
    const hasExecution =
      ["codex", "claude", "telemetry"].includes(current.source) ||
      (current.source === "repository" && current.executionArchitecture && current.executionRun);
    const dataset: VisualizationDataset = hasExecution
      ? reconciledRepositoryDataset(repository, current)
      : {
          source: "repository",
          architecture: repository.graph,
          run: emptyRepositoryRun(repository),
          rawEvents: {},
          diagnostics: repository.diagnostics,
          repository,
        };
    engine = engineFor(dataset.run);
    set({
      dataset,
      mode: "map",
      snapshot: engine.snapshot(),
      selectedEntityId: dataset.architecture.entities[0]?.id,
      selectedConnectionId: undefined,
      autoFollow: false,
      liveFollowing: false,
      showExecution: Boolean(dataset.session),
      layerFilter: "all",
      sourceLoading: false,
      sourceError: undefined,
    });
  },
  applyLiveDelta: (delta) => {
    const state = get();
    const baseRun = state.dataset.executionRun ?? state.dataset.run;
    const eventsById = new Map(baseRun.events.map((event) => [event.id, event]));
    for (const event of delta.events) eventsById.set(event.id, event);
    const events = [...eventsById.values()].sort(
      (left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    );
    const executionRun: Run = { ...baseRun, ...delta.metrics, events };
    const previousExecutionArchitecture =
      state.dataset.executionArchitecture ?? state.dataset.architecture;
    const executionArchitecture =
      graphIdentity(previousExecutionArchitecture) === graphIdentity(delta.architecture)
        ? previousExecutionArchitecture
        : delta.architecture;
    let dataset: VisualizationDataset;
    if (state.dataset.source === "repository" && state.dataset.repository) {
      dataset = reconciledRepositoryDataset(state.dataset.repository, {
        ...state.dataset,
        source:
          state.dataset.executionRun && state.dataset.session?.source
            ? state.dataset.session.source
            : state.dataset.source === "repository"
              ? "codex"
              : state.dataset.source,
        architecture: executionArchitecture,
        run: executionRun,
        executionArchitecture,
        executionRun,
        rawEvents: { ...state.dataset.rawEvents, ...delta.rawEvents },
        diagnostics: delta.diagnostics,
      });
    } else {
      dataset = {
        ...state.dataset,
        architecture: executionArchitecture,
        run: executionRun,
        rawEvents: { ...state.dataset.rawEvents, ...delta.rawEvents },
        diagnostics: [...state.dataset.diagnostics, ...delta.diagnostics],
      };
    }
    const speed = state.snapshot.speed;
    engine = engineFor(dataset.run, state.liveFollowing ? 800 : 0);
    engine.setSpeed(speed);
    const target = state.liveFollowing
      ? (dataset.run.events.at(-1)?.timestamp ?? dataset.run.totalDurationMs)
      : Math.min(state.snapshot.currentTimestamp, dataset.run.totalDurationMs);
    engine.seek(target);
    if (state.liveFollowing) engine.play();
    const snapshot = engine.snapshot();
    const activeEntityId = activeEntityForEvent(snapshot.currentEvent);
    const previousConnection = displayedArchitecture(state).edges.find(
      (edge) => edge.id === state.selectedConnectionId,
    );
    const nextConnection = displayedArchitecture({ ...state, dataset }).edges.find(
      (edge) => edge.id === state.selectedConnectionId,
    );
    const selectedConnectionId =
      previousConnection &&
      nextConnection &&
      previousConnection.source === nextConnection.source &&
      previousConnection.target === nextConnection.target
        ? state.selectedConnectionId
        : undefined;
    set({
      dataset,
      snapshot,
      selectedEntityId:
        state.autoFollow && state.liveFollowing && activeEntityId
          ? activeEntityId
          : state.selectedEntityId,
      selectedConnectionId,
      autoFollow: state.liveFollowing && state.autoFollow,
    });
  },
  jumpToLive: () => {
    const state = get();
    engine = engineFor(state.dataset.run, 800);
    engine.seek(state.dataset.run.events.at(-1)?.timestamp ?? state.dataset.run.totalDurationMs);
    engine.play();
    set({
      snapshot: engine.snapshot(),
      mode: "live",
      liveFollowing: true,
      autoFollow: true,
      selectedConnectionId: undefined,
    });
  },
  toggleExecutionOverlay: () =>
    set((state) => ({ showExecution: !state.showExecution, selectedConnectionId: undefined })),
  setLayerFilter: (layerFilter) =>
    set({ layerFilter, selectedEntityId: undefined, selectedConnectionId: undefined }),
  viewEntityEvents: (entityId) => {
    const state = get();
    const activity = state.dataset.reconciliation?.activities[entityId];
    const event = activity?.eventIds.length
      ? state.dataset.run.events.find((candidate) => candidate.id === activity.eventIds[0])
      : undefined;
    if (!event) return;
    set({
      mode: "live",
      snapshot: engine.seek(event.timestamp),
      selectedEntityId: entityId,
      selectedConnectionId: undefined,
      autoFollow: false,
      liveFollowing: false,
      showExecution: true,
    });
  },
  setTailConnected: (tailConnected) => set({ tailConnected }),
  setSourceLoading: (sourceLoading) => set({ sourceLoading }),
  setSourceError: (sourceError) => set({ sourceError, sourceLoading: false }),
}));

export function displayedArchitecture(
  state: Pick<VisualizationState, "dataset" | "showExecution" | "layerFilter">,
) {
  const graph =
    state.dataset.source === "repository" && state.showExecution && state.dataset.reconciliation
      ? state.dataset.reconciliation.graph
      : state.dataset.architecture;
  if (state.dataset.source !== "repository") return graph;
  const visible = graph.entities.filter((entity) => {
    const architecture = entity.metadata?.architecture as
      { layer?: string; layers?: string[]; visibility?: string } | undefined;
    const runtime = entity.metadata?.runtime as
      { observed?: boolean; external?: boolean } | undefined;
    if (state.layerFilter === "runtime")
      return runtime?.observed === true || runtime?.external === true;
    const layers =
      architecture?.layers ?? (architecture?.layer ? [architecture.layer] : ["application"]);
    if (state.layerFilter === "application") return layers.includes("application");
    if (state.layerFilter === "infrastructure") return layers.includes("infrastructure");
    return architecture?.visibility !== "detail";
  });
  const ids = new Set(visible.map((entity) => entity.id));
  return {
    ...graph,
    entities: visible,
    edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}
