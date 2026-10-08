"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, X } from "lucide-react";
import { ElkLayoutEngine, type PositionedGraph } from "@visual-system/graph";
import {
  renderDiagramSvg,
  renderRecapMarkdown,
  renderRecapSvg,
  renderReplayHtml,
  summarizeSession,
  svgSize,
} from "@visual-system/export";
import type { ArchitectureGraph, Run } from "@visual-system/schema";
import { Button, cn } from "@visual-system/ui";

type Kind = "recap" | "replay" | "diagram" | "markdown";

const layoutEngine = new ElkLayoutEngine();

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function svgToPng(svg: string) {
  const { width, height } = svgSize(svg);
  const scale = 2;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG failed."))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Export preview. Everything is generated in the browser from what is on screen; the preview is
 * exactly what gets saved, and nothing is uploaded. Names of system parts are included by default
 * (a recap without them is useless); prompts, run titles and file paths never are.
 */
export function ExportDialog({
  diagramGraph,
  recapGraph,
  run,
  onClose,
}: {
  /** What the map shows right now (layer filter applied). */
  diagramGraph: ArchitectureGraph;
  /** The full graph the run's events refer to. */
  recapGraph: ArchitectureGraph;
  run: Run;
  onClose: () => void;
}) {
  const hasActivity = run.events.length > 0;
  const [kind, setKind] = useState<Kind>(hasActivity ? "recap" : "diagram");
  const [anonymize, setAnonymize] = useState(false);
  const [brand, setBrand] = useState(true);
  const [layout, setLayout] = useState<PositionedGraph>();
  const [replayLayout, setReplayLayout] = useState<PositionedGraph>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const listener = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    void layoutEngine.layout(diagramGraph).then((result) => active && setLayout(result));
    return () => {
      active = false;
    };
  }, [diagramGraph]);

  // The replay uses the full graph the events refer to (not the map's layer filter), so the
  // replay shows the whole story even when the overlay is off.
  useEffect(() => {
    if (kind !== "replay" || !hasActivity) return;
    let active = true;
    void layoutEngine.layout(recapGraph).then((result) => active && setReplayLayout(result));
    return () => {
      active = false;
    };
  }, [hasActivity, kind, recapGraph]);

  const recap = useMemo(
    () => (hasActivity ? summarizeSession(run, recapGraph, { anonymize }) : undefined),
    [anonymize, hasActivity, recapGraph, run],
  );
  const svg = useMemo(() => {
    if (kind === "recap") return recap ? renderRecapSvg(recap, { brand }) : undefined;
    if (kind === "diagram")
      return layout ? renderDiagramSvg(diagramGraph, layout, { anonymize, brand }) : undefined;
    return undefined;
  }, [anonymize, brand, diagramGraph, kind, layout, recap]);
  const replay = useMemo(
    () =>
      kind === "replay" && hasActivity && replayLayout
        ? renderReplayHtml(recapGraph, replayLayout, run, { anonymize, brand })
        : undefined,
    [anonymize, brand, hasActivity, kind, recapGraph, replayLayout, run],
  );
  const markdown = useMemo(
    () => (recap ? renderRecapMarkdown(recap, { brand }) : undefined),
    [brand, recap],
  );
  const preview = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined;
  const base =
    kind === "recap" ? "avalok-recap" : kind === "replay" ? "avalok-replay" : "avalok-diagram";

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(undefined), 3000);
  };
  const saveSvg = () => {
    if (!svg) return;
    download(new Blob([svg], { type: "image/svg+xml" }), `${base}.svg`);
    flash(`Saved ${base}.svg`);
  };
  const saveHtml = () => {
    if (!replay) return;
    download(new Blob([replay.html], { type: "text/html" }), `${base}.html`);
    flash(`Saved ${base}.html`);
  };
  const savePng = async () => {
    if (!svg) return;
    try {
      download(await svgToPng(svg), `${base}.png`);
      flash(`Saved ${base}.png`);
    } catch {
      flash("PNG export is not available in this browser. Save the SVG instead.");
    }
  };
  const copyMarkdown = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      flash("Copied the Markdown summary");
    } catch {
      flash("Copy is blocked here. Select the text and copy it.");
    }
  };

  const tabs: { id: Kind; label: string; disabled: boolean }[] = [
    { id: "recap", label: "Recap card", disabled: !hasActivity },
    { id: "replay", label: "Interactive replay", disabled: !hasActivity },
    { id: "diagram", label: "Diagram", disabled: false },
    { id: "markdown", label: "Markdown", disabled: !hasActivity },
  ];

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-[#06080d]/75 p-6 backdrop-blur-[8px]"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="flex max-h-[calc(100vh-80px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#10151e] shadow-[0_32px_120px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-start justify-between border-b border-white/[0.065] px-6 py-5">
          <div>
            <div className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-cyan-300/70">
              Share
            </div>
            <h1
              id="export-title"
              className="mt-1.5 text-xl font-semibold tracking-tight text-slate-100"
            >
              Export a recap or diagram
            </h1>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close export">
            <X className="size-4" />
          </Button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
          <div
            className="flex flex-wrap items-center gap-2"
            role="tablist"
            aria-label="Export type"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={kind === tab.id}
                disabled={tab.disabled}
                title={tab.disabled ? "Open a session with observed activity first" : undefined}
                onClick={() => setKind(tab.id)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === tab.id
                    ? "border-cyan-300/30 bg-cyan-300/[0.08] text-slate-100"
                    : "border-white/[0.08] text-slate-500 hover:text-slate-200",
                  tab.disabled && "cursor-not-allowed opacity-40 hover:text-slate-500",
                )}
              >
                {tab.label}
              </button>
            ))}
            <div className="ml-auto flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={anonymize}
                  onChange={(event) => setAnonymize(event.target.checked)}
                />
                Anonymize names
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={brand}
                  onChange={(event) => setBrand(event.target.checked)}
                />
                “Made with Avalok” footer
              </label>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-white/[0.08] bg-black/30">
            {kind === "replay" ? (
              replay ? (
                // The preview is the saved file itself, run in a sandbox with no access to this page.
                <iframe
                  title="Preview of the interactive replay that will be saved"
                  sandbox="allow-scripts"
                  srcDoc={replay.html}
                  className="block h-[440px] w-full border-0 bg-[#080a0f]"
                />
              ) : (
                <div className="grid h-56 place-items-center text-xs text-slate-500">
                  Preparing the replay…
                </div>
              )
            ) : kind === "markdown" ? (
              <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5 text-slate-300">
                {markdown}
              </pre>
            ) : preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local data URL preview
              <img
                src={preview}
                alt="Preview of the file that will be saved"
                className="block w-full"
              />
            ) : (
              <div className="grid h-56 place-items-center text-xs text-slate-500">
                {kind === "diagram"
                  ? "Laying out the diagram…"
                  : "Nothing observed to summarize yet."}
              </div>
            )}
          </div>

          {kind === "replay" ? (
            <p className="mt-3 text-[0.6875rem] leading-5 text-slate-500">
              One self-contained HTML file: anyone can open it in a browser, with nothing to
              install. Playback is compressed so long sessions are watchable; real times are shown.
              {replay?.truncated
                ? ` This session has ${replay.totalSteps} steps; the first ${replay.includedSteps} are included.`
                : ""}
            </p>
          ) : null}
          <p className="mt-3 text-[0.6875rem] leading-5 text-slate-500">
            This preview is exactly what will be saved. It includes the names of system parts
            {anonymize ? " only as generic labels (names are anonymized)" : ""}; it never includes
            prompts, run titles, or file paths, and secret-looking values are hidden. Everything is
            created on this machine and nothing is uploaded. Review it before you share it.
          </p>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.065] px-6 py-4">
          <span className="min-h-5 text-xs text-emerald-300" role="status">
            {message ? (
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-3.5" /> {message}
              </span>
            ) : null}
          </span>
          <div className="flex gap-2">
            {kind === "markdown" ? (
              <Button size="sm" onClick={() => void copyMarkdown()} disabled={!markdown}>
                <Copy className="size-3.5" /> Copy Markdown
              </Button>
            ) : kind === "replay" ? (
              <Button size="sm" onClick={saveHtml} disabled={!replay}>
                <Download className="size-3.5" /> Download HTML
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={saveSvg} disabled={!svg}>
                  <Download className="size-3.5" /> Download SVG
                </Button>
                <Button size="sm" onClick={() => void savePng()} disabled={!svg}>
                  <Download className="size-3.5" /> Download PNG
                </Button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
