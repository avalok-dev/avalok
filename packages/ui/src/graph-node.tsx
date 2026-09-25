import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Entity } from "@visual-system/schema";
import { Activity, Check } from "lucide-react";
import { EntityIcon } from "./entity-icon";
import { cn } from "./lib/cn";

export interface GraphNodeData extends Record<string, unknown> {
  entity: Entity;
  state: "idle" | "active" | "completed";
  dimmed: boolean;
}

export type GraphNodeModel = Node<GraphNodeData, "entity">;

const kindTone: Record<Entity["kind"], string> = {
  user: "node-tone-user",
  frontend: "node-tone-frontend",
  service: "node-tone-service",
  agent: "node-tone-agent",
  model: "node-tone-model",
  memory: "node-tone-memory",
  vector_database: "node-tone-data",
  database: "node-tone-data",
  tool: "node-tone-tool",
  mcp_server: "node-tone-tool",
  web: "node-tone-web",
  document: "node-tone-document",
  api: "node-tone-service",
  queue: "node-tone-service",
  storage: "node-tone-data",
  infrastructure: "node-tone-service",
};

export function GraphNode({ data, selected }: NodeProps<GraphNodeModel>) {
  const { entity, state, dimmed } = data;
  return (
    <div
      className={cn(
        "graph-node group relative h-[84px] w-[184px] rounded-[14px] border bg-[#11151d]/95 px-3.5 py-3 text-left shadow-[0_14px_38px_rgba(0,0,0,0.26)] transition-all duration-300",
        kindTone[entity.kind],
        state === "active" && "is-active",
        state === "completed" && "is-completed",
        dimmed && "opacity-35 saturate-50",
        selected && "ring-1 ring-cyan-300/75 ring-offset-2 ring-offset-[#080a0f]",
      )}
      aria-label={`${entity.name}, ${entity.kind.replaceAll("_", " ")}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1.5 !border-0 !bg-slate-500"
      />
      <div className="flex items-start gap-3">
        <div className="node-icon grid size-9 shrink-0 place-items-center rounded-[10px] border border-current/20 bg-current/[0.07]">
          <EntityIcon kind={entity.kind} className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-sm font-semibold tracking-[-0.01em] text-slate-100">
            {entity.name}
          </div>
          <div className="mt-1 truncate font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-slate-500">
            {entity.kind.replaceAll("_", " ")}
          </div>
        </div>
        {state === "active" ? (
          <Activity className="size-3.5 animate-pulse text-cyan-300" aria-label="Active" />
        ) : state === "completed" ? (
          <Check className="size-3.5 text-cyan-500/75" aria-label="Completed" />
        ) : null}
      </div>
      <div className="absolute inset-x-3.5 bottom-2.5 h-px overflow-hidden rounded bg-white/[0.055]">
        <div
          className={cn("h-full w-0 bg-current transition-all", state === "active" && "w-full")}
        />
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-1.5 !border-0 !bg-slate-500"
      />
    </div>
  );
}
