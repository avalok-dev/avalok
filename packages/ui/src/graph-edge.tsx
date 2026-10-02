import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";

export interface GraphEdgeData extends Record<string, unknown> {
  state: "idle" | "active" | "completed";
  dimmed: boolean;
  runtime?: boolean;
}

export type GraphEdgeModel = Edge<GraphEdgeData, "signal">;

export function SignalEdge(props: EdgeProps<GraphEdgeModel>) {
  const [path] = getBezierPath(props);
  const state = props.data?.state ?? "idle";
  const dimmed = props.data?.dimmed ?? false;
  const runtime = props.data?.runtime ?? false;
  const selected = props.selected ?? false;
  const color = selected
    ? "#a5e5ef"
    : state === "active"
      ? "#67e8f9"
      : state === "completed"
        ? runtime
          ? "#1d7f8c"
          : "#475569"
        : runtime
          ? "#31586a"
          : "#273244";

  return (
    <>
      <BaseEdge
        path={path}
        {...(props.interactionWidth ? { interactionWidth: props.interactionWidth } : {})}
        {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.2 : state === "active" ? 2 : runtime ? 1.4 : 1,
          opacity: selected ? 0.95 : dimmed ? 0.18 : runtime ? 0.92 : 0.68,
          strokeDasharray: runtime && state !== "active" ? "5 5" : undefined,
          transition: "stroke 220ms ease, opacity 220ms ease, stroke-width 220ms ease",
        }}
      />
      {state === "active" ? (
        <circle r="3.5" fill="#cffafe" className="signal-particle">
          <animateMotion dur="0.9s" repeatCount="indefinite" path={path} />
        </circle>
      ) : null}
    </>
  );
}
