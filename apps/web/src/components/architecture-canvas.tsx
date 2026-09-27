"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import { deriveGraphRuntimeState, ElkLayoutEngine } from "@visual-system/graph";
import { GraphNode, SignalEdge, type GraphEdgeModel, type GraphNodeModel } from "@visual-system/ui";
import { displayedArchitecture, useVisualizationStore } from "@/store/visualization-store";

const nodeTypes: NodeTypes = { entity: GraphNode };
const edgeTypes: EdgeTypes = { signal: SignalEdge };
const layoutEngine = new ElkLayoutEngine();

const fallbackPositions: Record<string, { x: number; y: number }> = {
  user: { x: 40, y: 250 },
  "web-app": { x: 290, y: 250 },
  api: { x: 540, y: 250 },
  agent: { x: 790, y: 250 },
  internet: { x: 1060, y: 20 },
  model: { x: 1060, y: 130 },
  memory: { x: 1060, y: 240 },
  "github-mcp": { x: 1060, y: 350 },
  postgres: { x: 1060, y: 460 },
  documents: { x: 1320, y: 240 },
};

function useDisplayedArchitecture() {
  const dataset = useVisualizationStore((state) => state.dataset);
  const showExecution = useVisualizationStore((state) => state.showExecution);
  const layerFilter = useVisualizationStore((state) => state.layerFilter);
  return useMemo(
    () => displayedArchitecture({ dataset, showExecution, layerFilter }),
    [dataset, layerFilter, showExecution],
  );
}

function CanvasGraph() {
  const mode = useVisualizationStore((state) => state.mode);
  const snapshot = useVisualizationStore((state) => state.snapshot);
  const architecture = useDisplayedArchitecture();
  const source = useVisualizationStore((state) => state.dataset.source);
  const showExecution = useVisualizationStore((state) => state.showExecution);
  const run = useVisualizationStore((state) => state.dataset.run);
  const selectedEntityId = useVisualizationStore((state) => state.selectedEntityId);
  const selectEntity = useVisualizationStore((state) => state.selectEntity);
  const [positions, setPositions] = useState(fallbackPositions);
  const { fitView } = useReactFlow();

  useEffect(() => {
    let active = true;
    void layoutEngine.layout(architecture).then((layout) => {
      if (!active) return;
      setPositions(
        Object.fromEntries(layout.entities.map((entity) => [entity.id, entity.position])),
      );
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => void fitView({ padding: 0.16, duration: 500 })),
      );
    });
    return () => {
      active = false;
    };
  }, [architecture, fitView]);

  const runtime = useMemo(
    () =>
      deriveGraphRuntimeState(
        architecture,
        run.events,
        mode === "live"
          ? snapshot.currentTimestamp
          : source === "repository" && showExecution
            ? Number.MAX_SAFE_INTEGER
            : -1,
      ),
    [architecture, mode, run.events, showExecution, snapshot.currentTimestamp, source],
  );

  const hasActiveSignal = runtime.activeEntityIds.size + runtime.completedEntityIds.size > 0;
  const overlayActive = mode === "live" || (source === "repository" && showExecution);
  const nodes = useMemo<GraphNodeModel[]>(
    () =>
      architecture.entities.map((entity) => {
        const isActive = runtime.activeEntityIds.has(entity.id);
        const isCompleted = runtime.completedEntityIds.has(entity.id);
        return {
          id: entity.id,
          type: "entity",
          position: positions[entity.id] ?? { x: 0, y: 0 },
          selected: selectedEntityId === entity.id,
          draggable: false,
          data: {
            entity,
            state: isActive ? "active" : isCompleted ? "completed" : "idle",
            dimmed: overlayActive && hasActiveSignal && !isActive && !isCompleted,
          },
        };
      }),
    [architecture.entities, hasActiveSignal, overlayActive, positions, runtime, selectedEntityId],
  );

  const edges = useMemo<GraphEdgeModel[]>(
    () =>
      architecture.edges.map((edge) => {
        const isActive = runtime.activeEdgeIds.has(edge.id);
        const isCompleted = runtime.completedEdgeIds.has(edge.id);
        const activeRuntimeEvent = snapshot.activeEvents.find(
          (event) =>
            event.sourceEntityId &&
            event.targetEntityId &&
            ((event.sourceEntityId === edge.source && event.targetEntityId === edge.target) ||
              (event.sourceEntityId === edge.target && event.targetEntityId === edge.source)),
        );
        return {
          ...edge,
          source: isActive ? (activeRuntimeEvent?.sourceEntityId ?? edge.source) : edge.source,
          target: isActive ? (activeRuntimeEvent?.targetEntityId ?? edge.target) : edge.target,
          type: "signal",
          markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
          data: {
            state: isActive ? "active" : isCompleted ? "completed" : "idle",
            dimmed: overlayActive && hasActiveSignal && !isActive && !isCompleted,
            runtime: edge.metadata?.runtime === true,
          },
        };
      }),
    [architecture.edges, hasActiveSignal, overlayActive, runtime, snapshot.activeEvents],
  );

  const onNodeClick: NodeMouseHandler<GraphNodeModel> = (_, node) => selectEntity(node.id);

  return (
    <ReactFlow<GraphNodeModel, GraphEdgeModel>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={() => selectEntity(undefined)}
      fitView
      fitViewOptions={{ padding: 0.16 }}
      minZoom={0.25}
      maxZoom={1.65}
      nodesFocusable
      edgesFocusable
      aria-label="AI system architecture graph"
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#263142" />
      <Controls
        showInteractive={false}
        position="bottom-left"
        className="!m-3 !overflow-hidden !rounded-lg !border !border-white/[0.08] !bg-[#11151d] !shadow-xl"
      />
    </ReactFlow>
  );
}

export function ArchitectureCanvas() {
  const architecture = useDisplayedArchitecture();
  const source = useVisualizationStore((state) => state.dataset.source);
  const session = useVisualizationStore((state) => state.dataset.session);
  const showExecution = useVisualizationStore((state) => state.showExecution);
  const toggleExecutionOverlay = useVisualizationStore((state) => state.toggleExecutionOverlay);
  const layerFilter = useVisualizationStore((state) => state.layerFilter);
  const setLayerFilter = useVisualizationStore((state) => state.setLayerFilter);
  return (
    <div className="relative h-full min-h-0 bg-[#090c12]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3">
        <div className="rounded-md border border-white/[0.055] bg-[#0c1017]/80 px-2.5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-slate-600 backdrop-blur">
          {source === "repository"
            ? showExecution
              ? "Unified system map"
              : "Architecture graph"
            : "Execution graph"}{" "}
          / {architecture.title}
        </div>
        <div className="flex items-center gap-2">
          {source === "repository" ? (
            <div
              className="pointer-events-auto flex rounded-md border border-white/[0.055] bg-[#0c1017]/90 p-0.5 backdrop-blur"
              aria-label="Architecture layer"
            >
              {(["all", "application", "infrastructure", "runtime"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setLayerFilter(filter)}
                  aria-pressed={layerFilter === filter}
                  className={
                    layerFilter === filter
                      ? "rounded px-2 py-1 font-mono text-[0.625rem] capitalize text-cyan-200 bg-cyan-300/[0.09]"
                      : "rounded px-2 py-1 font-mono text-[0.625rem] capitalize text-slate-600 transition-colors hover:text-slate-300"
                  }
                >
                  {filter}
                </button>
              ))}
            </div>
          ) : null}
          {source === "repository" && session ? (
            <button
              type="button"
              onClick={toggleExecutionOverlay}
              className="pointer-events-auto rounded-md border border-cyan-300/15 bg-[#0c1017]/90 px-2.5 py-1.5 font-mono text-[0.6875rem] text-cyan-300/80 backdrop-blur transition-colors hover:bg-cyan-300/[0.07]"
              aria-pressed={showExecution}
            >
              Show execution · {showExecution ? "On" : "Off"}
            </button>
          ) : null}
          <div className="rounded-md border border-white/[0.055] bg-[#0c1017]/80 px-2.5 py-1.5 font-mono text-[0.6875rem] text-slate-600 backdrop-blur">
            {architecture.entities.length} entities · {architecture.edges.length} connections
          </div>
        </div>
      </div>
      <ReactFlowProvider>
        <CanvasGraph />
      </ReactFlowProvider>
    </div>
  );
}
