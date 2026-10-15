"use client";

import type { Entity, RuntimeEvent } from "@visual-system/schema";
import React, { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Braces,
  ChevronDown,
  FileCode2,
  TimerReset,
} from "lucide-react";
import { Badge } from "./primitives/badge";
import { cn } from "./lib/cn";
import { EntityIcon } from "./entity-icon";

export interface InspectorProps {
  entity: Entity | undefined;
  connection?: {
    source: Entity;
    target: Entity;
    observedActivity?: React.ReactNode;
    emptyReason?: "unobserved" | "ambiguous";
  };
  currentEvent: RuntimeEvent | undefined;
  connectedEntities: readonly Entity[];
  isLive: boolean;
  rawEvent?: unknown;
  traceEvents?: readonly RuntimeEvent[];
  diagnostics?: ReadonlyArray<{
    severity: "info" | "warning" | "error";
    code: string;
    message: string;
    line?: number;
    file?: string;
    stage?: string;
  }>;
  runLabel?: string;
  observedActivity?: React.ReactNode;
  repositoryFiles?:
    | ReadonlyArray<{
        path: string;
        role: string;
        imports: string[];
        exports: string[];
      }>
    | undefined;
  runtimeActivity?:
    | {
        observed: boolean;
        eventCount: number;
        files: string[];
        lastTimestamp?: number;
        operations: { read: number; edit: number; create: number; delete: number; other: number };
        hasError: boolean;
      }
    | undefined;
  onSelectEntity?: ((entityId: string) => void) | undefined;
  onViewEvents?: (() => void) | undefined;
}

interface ArchitectureDetails {
  category: string;
  confidence: number;
  confidenceLabel: string;
  technologies: string[];
  languages?: string[];
  ports?: number[];
  routes?: Array<{ path: string; methods: string[]; file: string; line?: number }>;
  sourceFiles: string[];
  fileCount: number;
  dependencies: string[];
  evidence: Array<{ kind: string; file: string; line?: number; description: string }>;
  layer?: string;
  layers?: string[];
  platform?: string;
  infrastructureKind?: string;
  resourceType?: string;
  address?: string;
  namespace?: string;
  visibility?: string;
  childSummaries?: string[];
  images?: string[];
  labels?: Record<string, string>;
  selectors?: Record<string, string>;
  details?: Record<string, string | number | boolean | string[]>;
  metrics?: Array<{
    name: string;
    status: "configured" | "observed" | "estimated";
    source: string;
    unit?: string;
    value: string | number;
  }>;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-slate-600">
        {label}
      </dt>
      <dd className="mt-1.5 text-sm text-slate-300">{children}</dd>
    </div>
  );
}

const titleCase = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

/**
 * React key for a diagnostic row. Unique even when several diagnostics share a code, file and
 * line (for example the same parser limit reported twice, or two files with a problem on line 3).
 */
export function diagnosticKey(
  diagnostic: { code: string; file?: string; line?: number },
  index: number,
) {
  return `${diagnostic.code}|${diagnostic.file ?? ""}|${diagnostic.line ?? ""}|${index}`;
}

export function Inspector({
  entity,
  connection,
  currentEvent,
  connectedEntities,
  isLive,
  rawEvent,
  traceEvents = [],
  diagnostics = [],
  runLabel = "Run",
  observedActivity,
  repositoryFiles = [],
  runtimeActivity,
  onSelectEntity,
  onViewEvents,
}: InspectorProps) {
  const [eventView, setEventView] = useState<"normalized" | "raw">("normalized");
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string>();
  const architecture = entity?.metadata?.architecture as ArchitectureDetails | undefined;
  const selectedFile = repositoryFiles.find((file) => file.path === selectedFilePath);
  const eventArchitectureIds = Array.isArray(currentEvent?.metadata?.architectureEntityIds)
    ? currentEvent.metadata.architectureEntityIds.filter(
        (entityId): entityId is string => typeof entityId === "string",
      )
    : [];
  const spanEvents = new Map(
    traceEvents.flatMap((event) => (event.spanId ? [[event.spanId, event] as const] : [])),
  );
  const ancestors: RuntimeEvent[] = [];
  let parentSpanId = currentEvent?.parentSpanId;
  while (parentSpanId && ancestors.length < 12) {
    const parent = spanEvents.get(parentSpanId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentSpanId = parent.parentSpanId;
  }
  const childCount = currentEvent?.spanId
    ? traceEvents.filter((event) => event.parentSpanId === currentEvent.spanId).length
    : 0;
  if (connection) {
    return (
      <aside
        className="h-full overflow-y-auto border-l border-white/[0.065] bg-[#0c0f15]/88 p-5"
        aria-label="Connection inspector"
      >
        <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-slate-600">
          Inspector / connection
        </div>
        <h2 className="mt-5 text-base font-semibold leading-6 text-slate-100">
          {connection.source.name} <ArrowRight className="inline size-4 text-cyan-300/75" />{" "}
          {connection.target.name}
        </h2>
        <dl className="mt-6 grid gap-5">
          <Detail label="Source">{connection.source.name}</Detail>
          <Detail label="Destination">{connection.target.name}</Detail>
          <Detail label="Observed connection statistics">
            {connection.observedActivity ?? (
              <span className="text-xs leading-5 text-slate-500">
                {connection.emptyReason === "ambiguous"
                  ? "Connection identities are ambiguous, so observed activity cannot be assigned reliably."
                  : "No observed statistics for this connection in the selected run."}
              </span>
            )}
          </Detail>
        </dl>
      </aside>
    );
  }
  if (!entity && !currentEvent) {
    return (
      <aside className="flex h-full flex-col border-l border-white/[0.065] bg-[#0c0f15]/88 p-5">
        <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-slate-600">
          Inspector
        </div>
        <div className="mt-16 text-center">
          <div className="mx-auto grid size-11 place-items-center rounded-xl border border-dashed border-white/10 text-slate-600">
            <ArrowUpRight className="size-4" />
          </div>
          <p className="mt-4 text-sm text-slate-400">Select a component to inspect it.</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Live events appear here during replay.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="h-full overflow-y-auto border-l border-white/[0.065] bg-[#0c0f15]/88 p-5">
      {entity ? (
        <>
          <div className="flex items-start gap-3">
            <div className="grid size-10 place-items-center rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-300">
              <EntityIcon kind={entity.kind} className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold text-slate-100">{entity.name}</h2>
              <Badge className="mt-1.5">{titleCase(entity.kind)}</Badge>
              {architecture ? (
                <Badge className="ml-1.5 mt-1.5 border-indigo-300/15 bg-indigo-300/[0.05] text-indigo-200/80">
                  {titleCase(architecture.confidenceLabel)} ·{" "}
                  {Math.round(architecture.confidence * 100)}%
                </Badge>
              ) : null}
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-500">{entity.description}</p>
          <dl className="mt-6 grid gap-5">
            <Detail label="Provider">{entity.provider ?? "Local"}</Detail>
            {architecture?.layer ? (
              <Detail label="Layer">
                {titleCase(architecture.layers?.join(" + ") ?? architecture.layer)}
              </Detail>
            ) : null}
            {architecture?.resourceType ? (
              <Detail label="Infrastructure">
                <div className="grid gap-1 text-xs text-slate-400">
                  <span>
                    {architecture.platform ? `${titleCase(architecture.platform)} · ` : ""}
                    {architecture.resourceType}
                  </span>
                  {architecture.address ? (
                    <span className="break-all font-mono text-cyan-300/75">
                      {architecture.address}
                    </span>
                  ) : null}
                  {architecture.namespace ? (
                    <span>Namespace · {architecture.namespace}</span>
                  ) : null}
                  {architecture.visibility ? (
                    <span>View · {titleCase(architecture.visibility)}</span>
                  ) : null}
                </div>
              </Detail>
            ) : null}
            <Detail label="Status">
              <span className="inline-flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {runtimeActivity?.hasError
                  ? "Error observed"
                  : runtimeActivity?.observed
                    ? isLive
                      ? "Active / observed"
                      : "Observed"
                    : architecture
                      ? "Detected"
                      : isLive
                        ? "Observed"
                        : "Available"}
              </span>
            </Detail>
            <Detail label="Run">{runLabel}</Detail>
            {observedActivity ? (
              <Detail label="Observed node statistics">{observedActivity}</Detail>
            ) : null}
            {entity.metadata?.averageLatency ? (
              <Detail label="Avg latency">{String(entity.metadata.averageLatency)}</Detail>
            ) : null}
            {architecture?.technologies.length ? (
              <Detail label="Technology">
                <div className="flex flex-wrap gap-1.5">
                  {architecture.technologies.map((technology) => (
                    <Badge key={technology} className="normal-case tracking-normal text-slate-400">
                      {technology}
                    </Badge>
                  ))}
                </div>
              </Detail>
            ) : null}
            {architecture?.languages?.length ? (
              <Detail label="Languages">
                <div className="flex flex-wrap gap-1.5">
                  {architecture.languages.map((language) => (
                    <Badge key={language} className="normal-case tracking-normal text-slate-400">
                      {titleCase(language)}
                    </Badge>
                  ))}
                </div>
              </Detail>
            ) : null}
            {architecture?.ports?.length ? (
              <Detail label="Ports">
                <span className="font-mono text-xs text-slate-400">
                  {architecture.ports.join(", ")}
                </span>
              </Detail>
            ) : null}
            {architecture?.routes?.length ? (
              <Detail label={`Routes (${architecture.routes.length})`}>
                <div className="grid gap-1.5">
                  {architecture.routes.slice(0, 20).map((route) => (
                    <div
                      key={`${route.methods.join(",")}:${route.path}`}
                      className="font-mono text-xs text-slate-500"
                    >
                      <span className="text-cyan-300/70">{route.methods.join(", ") || "HTTP"}</span>{" "}
                      {route.path}
                    </div>
                  ))}
                </div>
              </Detail>
            ) : null}
            {entity.metrics?.length || architecture?.metrics?.length ? (
              <Detail label="Resource metrics">
                <div className="grid gap-2">
                  {(entity.metrics ?? architecture?.metrics ?? []).map((metric, index) => (
                    <div
                      key={`${metric.name}-${metric.source}-${index}`}
                      className="rounded-md border border-white/[0.055] bg-black/20 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-300">{titleCase(metric.name)}</span>
                        <Badge className="normal-case tracking-normal text-slate-500">
                          {metric.status}
                        </Badge>
                      </div>
                      <div className="mt-1 font-mono text-xs text-cyan-300/75">
                        {metric.value}
                        {metric.unit ? ` ${metric.unit}` : ""}
                      </div>
                      <div className="mt-1 truncate font-mono text-[0.625rem] text-slate-600">
                        {metric.source}
                      </div>
                    </div>
                  ))}
                </div>
              </Detail>
            ) : null}
            {architecture?.images?.length ? (
              <Detail label="Images">
                <div className="grid gap-1 font-mono text-xs text-slate-500">
                  {architecture.images.map((image) => (
                    <span key={image} className="break-all">
                      {image}
                    </span>
                  ))}
                </div>
              </Detail>
            ) : null}
            {architecture?.childSummaries?.length ? (
              <Detail label={`Hierarchy (${architecture.childSummaries.length})`}>
                <div className="grid gap-1.5">
                  {architecture.childSummaries.slice(0, 20).map((child) => (
                    <div
                      key={child}
                      className="rounded-md border border-white/[0.05] bg-black/15 px-2.5 py-2 text-xs text-slate-500"
                    >
                      {child}
                    </div>
                  ))}
                </div>
              </Detail>
            ) : null}
            {architecture?.details && Object.keys(architecture.details).length ? (
              <Detail label="Configuration">
                <div className="grid gap-1.5 rounded-lg border border-white/[0.055] bg-black/20 p-3">
                  {Object.entries(architecture.details)
                    .slice(0, 20)
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2 text-xs"
                      >
                        <span className="font-mono text-slate-600">{key}</span>
                        <span className="break-all text-slate-400">
                          {Array.isArray(value) ? value.join(", ") : String(value)}
                        </span>
                      </div>
                    ))}
                </div>
              </Detail>
            ) : null}
            <Detail label="Connected to">
              <div className="flex flex-wrap gap-1.5">
                {connectedEntities.map((connected) => (
                  <Badge key={connected.id} className="normal-case tracking-normal text-slate-400">
                    {connected.name}
                  </Badge>
                ))}
              </div>
            </Detail>
            {entity.source ? (
              <Detail label="Source">
                <span className="font-mono text-xs text-cyan-300/85">
                  {entity.source.file}
                  {entity.source.line ? `:${entity.source.line}` : ""}
                </span>
              </Detail>
            ) : null}
            {architecture ? (
              <Detail label="Evidence">
                <div className="grid gap-2">
                  {architecture.evidence
                    .slice(0, evidenceExpanded ? architecture.evidence.length : 3)
                    .map((evidence, index) => (
                      <div
                        key={`${evidence.file}-${evidence.line ?? index}`}
                        className="rounded-md border border-white/[0.055] bg-black/20 p-2.5"
                      >
                        <div className="font-mono text-[0.625rem] text-cyan-300/70">
                          {evidence.file}
                          {evidence.line ? `:${evidence.line}` : ""}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          {evidence.description}
                        </div>
                      </div>
                    ))}
                  {architecture.evidence.length > 3 ? (
                    <button
                      type="button"
                      onClick={() => setEvidenceExpanded((expanded) => !expanded)}
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
                    >
                      <ChevronDown
                        className={cn(
                          "size-3.5 transition-transform",
                          evidenceExpanded && "rotate-180",
                        )}
                      />
                      {evidenceExpanded
                        ? "Show less"
                        : `Show ${architecture.evidence.length - 3} more`}
                    </button>
                  ) : null}
                </div>
              </Detail>
            ) : null}
            {repositoryFiles.length > 0 ? (
              <Detail label={`Files (${repositoryFiles.length})`}>
                <div className="grid gap-1">
                  {repositoryFiles.slice(0, 20).map((file) => (
                    <button
                      type="button"
                      key={file.path}
                      onClick={() => setSelectedFilePath(file.path)}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-white/[0.035] hover:text-slate-300",
                        selectedFilePath === file.path && "bg-white/[0.045] text-cyan-300/80",
                      )}
                    >
                      <FileCode2 className="size-3.5 shrink-0" />
                      <span className="truncate font-mono">{file.path}</span>
                    </button>
                  ))}
                </div>
              </Detail>
            ) : null}
            {selectedFile ? (
              <Detail label="Selected file">
                <div className="rounded-lg border border-white/[0.055] bg-black/20 p-3 text-xs leading-5 text-slate-500">
                  <div className="break-all font-mono text-cyan-300/80">{selectedFile.path}</div>
                  <div className="mt-2">Role · {titleCase(selectedFile.role)}</div>
                  <div>
                    Imports ·{" "}
                    {selectedFile.imports.length ? selectedFile.imports.join(", ") : "None"}
                  </div>
                  <div>
                    Exports ·{" "}
                    {selectedFile.exports.length ? selectedFile.exports.join(", ") : "None"}
                  </div>
                </div>
              </Detail>
            ) : null}
            {runtimeActivity ? (
              <Detail label="Runtime">
                <div className="rounded-lg border border-white/[0.055] bg-black/20 p-3 text-xs leading-5 text-slate-500">
                  <div>Touched in selected run · {runtimeActivity.observed ? "Yes" : "No"}</div>
                  <div>Events · {runtimeActivity.eventCount}</div>
                  {runtimeActivity.lastTimestamp !== undefined ? (
                    <div>
                      Last activity · {(runtimeActivity.lastTimestamp / 1000).toFixed(2)} sec
                    </div>
                  ) : null}
                  <div className="mt-2 font-mono text-[0.625rem] text-slate-600">
                    READ {runtimeActivity.operations.read} · EDIT {runtimeActivity.operations.edit}{" "}
                    · CREATE {runtimeActivity.operations.create} · DELETE{" "}
                    {runtimeActivity.operations.delete}
                  </div>
                  {runtimeActivity.eventCount > 0 && onViewEvents ? (
                    <button
                      type="button"
                      onClick={onViewEvents}
                      className="mt-2 flex items-center gap-1.5 text-cyan-300/75 hover:text-cyan-200"
                    >
                      View events <ArrowRight className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </Detail>
            ) : null}
          </dl>
        </>
      ) : null}

      {currentEvent ? (
        <section className="mt-7 border-t border-white/[0.065] pt-5">
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-slate-600">
              Current event
            </div>
            <Badge className="border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-300">
              {currentEvent.category}
            </Badge>
          </div>
          <div className="mt-3 flex rounded-md border border-white/[0.06] bg-black/20 p-0.5">
            {(["normalized", "raw"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setEventView(view)}
                disabled={view === "raw" && rawEvent === undefined}
                className={cn(
                  "flex-1 rounded px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-slate-600 transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                  eventView === view && "bg-white/[0.07] text-slate-300",
                )}
              >
                {view}
              </button>
            ))}
          </div>
          {eventArchitectureIds[0] && onSelectEntity ? (
            <button
              type="button"
              onClick={() => onSelectEntity(eventArchitectureIds[0] as string)}
              className="mt-3 flex items-center gap-1.5 text-xs text-cyan-300/75 hover:text-cyan-200"
            >
              View in architecture <ArrowRight className="size-3.5" />
            </button>
          ) : null}
          {eventView === "raw" && rawEvent !== undefined ? (
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-white/[0.055] bg-black/25 p-3 font-mono text-[0.6875rem] leading-5 text-slate-400">
              {JSON.stringify(rawEvent, null, 2)}
            </pre>
          ) : (
            <>
              <h3 className="mt-3 text-sm font-semibold text-slate-100">
                {titleCase(currentEvent.action)}
              </h3>
              <div className="mt-2 flex items-center gap-2 font-mono text-xs text-slate-500">
                <TimerReset className="size-3.5" /> {currentEvent.durationMs ?? 0} ms
              </div>
              {currentEvent.spanId ? (
                <div className="mt-3 rounded-lg border border-white/[0.055] bg-black/20 p-3">
                  <div className="font-mono text-[0.625rem] uppercase tracking-wider text-slate-600">
                    Trace hierarchy
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {ancestors.map((event) => (
                      <span key={event.id} className="contents">
                        <Badge className="normal-case tracking-normal">{event.action}</Badge>
                        <ArrowRight className="size-3 text-slate-700" />
                      </span>
                    ))}
                    <Badge className="border-cyan-300/15 bg-cyan-300/[0.06] normal-case tracking-normal text-cyan-300">
                      {currentEvent.action}
                    </Badge>
                  </div>
                  <div className="mt-2 break-all font-mono text-[0.625rem] text-slate-600">
                    span {currentEvent.spanId}
                    {currentEvent.parentSpanId
                      ? ` · parent ${currentEvent.parentSpanId}`
                      : " · root"}
                    {childCount > 0
                      ? ` · ${childCount} direct child${childCount === 1 ? "" : "ren"}`
                      : ""}
                  </div>
                </div>
              ) : null}
              {currentEvent.metadata ? (
                <dl className="mt-4 grid gap-3 rounded-lg border border-white/[0.055] bg-black/20 p-3">
                  {Object.entries(currentEvent.metadata).map(([key, value]) => (
                    <div key={key}>
                      <dt className="font-mono text-[0.625rem] uppercase tracking-wider text-slate-600">
                        {key}
                      </dt>
                      <dd className="mt-1 break-words text-xs leading-5 text-slate-400">
                        {typeof value === "string" ? value : JSON.stringify(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {diagnostics.length > 0 ? (
        <section className="mt-7 border-t border-white/[0.065] pt-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-slate-600">
              <AlertTriangle className="size-3.5" /> Diagnostics
            </div>
            <Badge>{diagnostics.length}</Badge>
          </div>
          <div className="mt-3 grid gap-2">
            {diagnostics.slice(-8).map((diagnostic, index) => (
              <div
                key={diagnosticKey(diagnostic, index)}
                className="rounded-lg border border-amber-300/10 bg-amber-300/[0.035] p-2.5"
              >
                <div className="flex items-center gap-2 font-mono text-[0.625rem] text-amber-300/70">
                  <Braces className="size-3" /> {diagnostic.code}
                  {diagnostic.file ? ` · ${diagnostic.file}` : ""}
                  {diagnostic.line ? `:${diagnostic.line}` : ""}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{diagnostic.message}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
