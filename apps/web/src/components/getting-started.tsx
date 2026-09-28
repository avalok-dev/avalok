"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  CloudCog,
  Code2,
  RadioTower,
  ServerCog,
  X,
} from "lucide-react";
import type { CapabilityReport } from "@visual-system/capabilities";
import { Badge, Button, cn } from "@visual-system/ui";

type SetupView = "overview" | "telemetry";
type TelemetryGuide = "generic" | "python" | "node" | "openinference";

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <div className="relative mt-3 overflow-hidden rounded-lg border border-white/[0.07] bg-black/30">
      <pre className="overflow-x-auto p-3 pr-12 font-mono text-[0.6875rem] leading-5 text-slate-400">
        {value}
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-white/[0.07] bg-[#151a23] px-2 py-1 font-mono text-[0.625rem] text-slate-400 hover:text-slate-100"
        aria-label="Copy configuration"
      >
        {copied ? <Check className="size-3" /> : <Clipboard className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function statusLabel(source: CapabilityReport["sources"][number]) {
  if (source.availability === "error") return "Needs attention";
  if (source.observation === "observed") return "Observed";
  if (source.connection === "listening") return "Listening";
  if (source.connection === "not-configured") return "Not configured";
  if (source.connection === "ready") return "Available";
  return source.availability === "available" ? "Available" : "Not detected";
}

export function GettingStarted({
  report,
  view,
  onViewChange,
  onClose,
  onViewMap,
  onViewLive,
  onRefresh,
}: {
  report: CapabilityReport;
  view: SetupView;
  onViewChange: (view: SetupView) => void;
  onClose: () => void;
  onViewMap: () => void;
  onViewLive: () => void;
  onRefresh: () => void;
}) {
  const [guide, setGuide] = useState<TelemetryGuide>("generic");
  const [sending, setSending] = useState(false);
  const [testResult, setTestResult] = useState<string>();
  const telemetry = report.sources.find((source) => source.id === "telemetry")!;
  const endpoint = report.telemetry.endpoint;
  const configurations: Record<TelemetryGuide, { note: string; value: string }> = {
    generic: {
      note: "Any standard OTLP/HTTP trace exporter works: http/protobuf (the usual default) or http/json. The signal-specific URL is used exactly as shown. OTLP/gRPC is not supported.",
      value: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${endpoint}\nOTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf`,
    },
    python: {
      note: "The standard opentelemetry-exporter-otlp-proto-http exporter sends protobuf directly to AgentMap. No Collector or JSON exporter is needed.",
      value: `pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http\n\nexport OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${endpoint}\n# Then start your normal OpenTelemetry-instrumented Python app.`,
    },
    node: {
      note: "Either official JavaScript OTLP HTTP exporter works: exporter-trace-otlp-proto (protobuf) or exporter-trace-otlp-http (JSON). Register it before your application code.",
      value: `npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-proto\n\n# Configure its OTLPTraceExporter URL as:\n${endpoint}`,
    },
    openinference: {
      note: "OpenInference adds AI semantics to OpenTelemetry spans and works over either OTLP/HTTP encoding. AgentMap currently normalizes agent, chain, LLM/model, tool, retriever, embedding, reranker, prompt, guardrail, evaluator, token, and supported GenAI attributes.",
      value: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${endpoint}\nOTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf`,
    },
  };
  const sendTest = async () => {
    setSending(true);
    setTestResult(undefined);
    try {
      const response = await fetch("/api/telemetry/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Test trace failed.");
      setTestResult("Test trace received · synthetic fixture");
      onRefresh();
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : "Test trace failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-[#06080d]/75 p-6 backdrop-blur-[8px]">
      <section className="max-h-[calc(100vh-100px)] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/[0.1] bg-[#10151e] shadow-[0_32px_120px_rgba(0,0,0,0.7)]">
        <header className="flex items-start justify-between border-b border-white/[0.065] px-6 py-5">
          <div>
            <div className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-cyan-300/70">
              {view === "overview" ? "Getting started" : "Local telemetry setup"}
            </div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-100">
              {view === "overview" ? "Your system is ready" : "Connect Telemetry"}
            </h1>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close Getting Started">
            <X className="size-4" />
          </Button>
        </header>

        {view === "overview" ? (
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-6">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-white/[0.07] bg-black/15 p-4 md:col-span-2">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                  <Code2 className="size-4 text-indigo-300" /> {report.repository.name}
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Repository analyzed · {report.repository.files} files ·{" "}
                  {report.repository.entities} architecture entities
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {report.capabilities
                    .filter((item) => item.area === "language")
                    .map((item) => (
                      <Badge
                        key={item.id}
                        className={cn(
                          "normal-case tracking-normal",
                          item.support === "inventory-only" &&
                            "border-amber-300/15 text-amber-300/80",
                        )}
                      >
                        {item.label} ·{" "}
                        {item.support === "supported" ? "supported" : "detected only"}
                      </Badge>
                    ))}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-300/10 bg-emerald-300/[0.035] p-4">
                <div className="text-xs font-medium text-emerald-300">Architecture ready</div>
                <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[0.6875rem] text-slate-500">
                  <span>{report.repository.services} services</span>
                  <span>{report.repository.databases} databases</span>
                  <span>{report.repository.externalIntegrations} integrations</span>
                  <span>{report.repository.entities} entities</span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <section>
                <div className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-wider text-slate-600">
                  <CloudCog className="size-3.5" /> Configured architecture
                </div>
                <div className="mt-2 grid gap-1.5">
                  {report.capabilities.filter((item) => item.area !== "language").length ? (
                    report.capabilities
                      .filter((item) => item.area !== "language")
                      .map((item) => (
                        <div
                          key={item.id}
                          className="rounded-lg border border-white/[0.055] bg-black/15 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 text-xs text-slate-300">
                            <CheckCircle2 className="size-3.5 text-emerald-400" />
                            {item.label}
                          </div>
                          <div className="mt-1 pl-5 text-[0.6875rem] text-slate-600">
                            {item.detail}
                          </div>
                        </div>
                      ))
                  ) : (
                    <p className="rounded-lg border border-white/[0.055] p-3 text-xs leading-5 text-slate-500">
                      No supported infrastructure configuration was detected. Runtime telemetry can
                      still build an execution view.
                    </p>
                  )}
                </div>
              </section>
              <section>
                <div className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-wider text-slate-600">
                  <ServerCog className="size-3.5" /> Runtime sources
                </div>
                <div className="mt-2 grid gap-1.5">
                  {report.sources.slice(0, 3).map((source) => (
                    <div
                      key={source.id}
                      className="rounded-lg border border-white/[0.055] bg-black/15 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3 text-xs text-slate-300">
                        <span>{source.label}</span>
                        <Badge>{statusLabel(source)}</Badge>
                      </div>
                      <div className="mt-1 text-[0.6875rem] leading-5 text-slate-600">
                        {source.detail}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
              <p className="max-w-md text-[0.6875rem] leading-5 text-slate-600">
                Local-first · AgentMap does not upload your repository, local agent sessions, or
                telemetry to an AgentMap cloud service. AgentMap {report.version} · Data:{" "}
                {report.dataPath}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => onViewChange("telemetry")}>
                  <RadioTower className="size-3.5" /> Connect telemetry
                </Button>
                <Button size="sm" onClick={onViewMap}>
                  View System Map <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-white/[0.06] bg-black/15 p-3 sm:col-span-2">
                <div className="font-mono text-[0.625rem] uppercase text-slate-600">
                  OTLP traces endpoint
                </div>
                <div className="mt-1.5 break-all font-mono text-xs text-cyan-300/80">
                  {endpoint}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/15 p-3">
                <div className="font-mono text-[0.625rem] uppercase text-slate-600">Receiver</div>
                <div className="mt-1.5 text-xs text-slate-300">
                  {statusLabel(telemetry)} · {report.telemetry.spansReceived} spans
                </div>
                <div className="mt-1 text-[0.625rem] text-slate-600">
                  OTLP/HTTP protobuf or JSON · no gRPC
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1 rounded-lg border border-white/[0.06] bg-black/15 p-1">
              {(["generic", "python", "node", "openinference"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setGuide(item)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs capitalize text-slate-500",
                    guide === item && "bg-white/[0.07] text-slate-100",
                  )}
                >
                  {item === "node" ? "Node.js" : item === "openinference" ? "OpenInference" : item}
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">{configurations[guide].note}</p>
            <CopyBlock value={configurations[guide].value} />
            <div className="mt-5 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-200">Prove the local path now</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Sends five deterministic, harmless spans labeled Synthetic Fixture. No API key
                    or network access.
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={sending || telemetry.connection !== "listening"}
                  onClick={() => void sendTest()}
                >
                  {sending ? "Sending…" : "Send Test Trace"}
                </Button>
              </div>
              {testResult ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-emerald-300">
                  <CheckCircle2 className="size-3.5" />
                  {testResult}
                  <button
                    type="button"
                    onClick={onViewLive}
                    className="ml-auto text-cyan-300 hover:underline"
                  >
                    View in Live
                  </button>
                </div>
              ) : null}
            </div>
            <div className="mt-5 flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => onViewChange("overview")}>
                Back to summary
              </Button>
              <span className="font-mono text-[0.625rem] text-slate-600">
                Last activity ·{" "}
                {report.telemetry.lastActivity
                  ? new Date(report.telemetry.lastActivity).toLocaleString()
                  : "none"}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
