import { deriveDwellState, slowStepMs, type PositionedGraph } from "@visual-system/graph";
import type { ArchitectureGraph, Entity, Run, RuntimeEvent } from "@visual-system/schema";
import { entityLabels, escapeXml, kindLabel, safeLabel } from "./labels";
import { formatDuration } from "./recap";

// A single self-contained HTML file that replays a session: the architecture map, a scrubber, and
// the same "where is time being spent" glow as the dashboard. No network, no external assets.
//
// Real sessions can last hours, so playback uses a compressed "story" timeline: every step gets a
// short on-screen window and long steps are shortened (but still visibly longer than short ones).
// The real time into the session is always shown. Only privacy-safe fields are embedded: entity
// labels, step categories, timing and counts. Never prompts, commands, actions, titles or paths.

export interface PlaybackStep {
  /** Start on the compressed timeline, in milliseconds. */
  startMs: number;
  /** Length on the compressed timeline; 0 for a step with no recorded duration (a brief pulse). */
  playMs: number;
  /** Real offset from the start of the session and real duration, in milliseconds. */
  realOffsetMs: number;
  realDurationMs: number;
  source: number | null;
  target: number | null;
  /** Indexes of architecture entities the step was matched to (repository sessions). */
  extra: number[];
  category: string;
  failed: boolean;
  slow: boolean;
}

export interface PlaybackPlan {
  steps: PlaybackStep[];
  totalMs: number;
  /** How many steps the session has in total, and how many are included. */
  totalSteps: number;
  includedSteps: number;
}

/** On-screen length for a step of the given real duration: short ones are brief, long ones longer but bounded. */
export function playbackLength(realDurationMs: number) {
  if (realDurationMs <= 220) return 0;
  const seconds = realDurationMs / 1000;
  return Math.round(Math.min(4000, Math.max(300, 300 + 700 * Math.log2(1 + seconds))));
}

export function buildPlaybackPlan(
  run: Run,
  entityIds: readonly string[],
  options: { maxSteps?: number } = {},
): PlaybackPlan {
  const maxSteps = options.maxSteps ?? 20_000;
  const index = new Map(entityIds.map((id, position) => [id, position]));
  const firstTimestamp = run.events[0]?.timestamp ?? 0;
  const included = run.events.slice(0, maxSteps);
  const steps: PlaybackStep[] = [];
  let cursor = 0;
  let previousPlay = 0;
  for (const [position, event] of included.entries()) {
    const real = event.durationMs ?? 0;
    const playMs = playbackLength(real);
    // Consecutive steps overlap a little, so a long step keeps glowing while quick ones play.
    if (position > 0) cursor += Math.max(180, Math.round(previousPlay * 0.5));
    const ids = event.metadata?.architectureEntityIds;
    steps.push({
      startMs: cursor,
      playMs,
      realOffsetMs: Math.max(0, event.timestamp - firstTimestamp),
      realDurationMs: real,
      source: event.sourceEntityId !== undefined ? (index.get(event.sourceEntityId) ?? null) : null,
      target: event.targetEntityId !== undefined ? (index.get(event.targetEntityId) ?? null) : null,
      extra: Array.isArray(ids)
        ? ids.flatMap((id) => (typeof id === "string" && index.has(id) ? [index.get(id)!] : []))
        : [],
      category: event.category,
      failed: event.category === "error" || event.metadata?.status === "error",
      slow: real >= slowStepMs,
    });
    previousPlay = playMs;
  }
  const last = steps.at(-1);
  const totalMs = last ? last.startMs + Math.max(last.playMs, 220) + 900 : 0;
  return { steps, totalMs, totalSteps: run.events.length, includedSteps: steps.length };
}

/** The plan as events the shared glow function understands (same algorithm as the dashboard). */
export function planAsEvents(plan: PlaybackPlan, entityIds: readonly string[]): RuntimeEvent[] {
  return plan.steps.map((step, position) => ({
    id: `s${position}`,
    traceId: "plan",
    timestamp: step.startMs,
    durationMs: step.playMs,
    category: "tool" as const,
    action: "step",
    ...(step.source !== null ? { sourceEntityId: entityIds[step.source]! } : {}),
    ...(step.target !== null ? { targetEntityId: entityIds[step.target]! } : {}),
    metadata: {
      slow: step.slow,
      architectureEntityIds: step.extra.map((entry) => entityIds[entry]!),
    },
  }));
}

/** Convenience for tests and callers: glow at a position on the compressed timeline. */
export function glowAtPlaybackPosition(
  plan: PlaybackPlan,
  entityIds: readonly string[],
  positionMs: number,
) {
  return deriveDwellState(planAsEvents(plan, entityIds), positionMs, {
    isSlow: (event) => event.metadata?.slow === true,
  });
}

/**
 * The glow algorithm as plain JavaScript for the exported page. It mirrors `deriveDwellState`
 * (packages/graph/src/dwell.ts); a parity test runs both over the same plan and compares them.
 * Steps are [startMs, playMs, source, target, extra[], slow].
 */
export const glowScript = `function glowAt(steps, p) {
  var out = {};
  function consider(i, role, strength, slow, inFlight) {
    var intensity = strength * (role === "caller" ? 0.45 : 1);
    if (intensity <= 0.01) return;
    var e = out[i];
    var better = !e || (role === "dwell" && e.role === "caller") || (role === e.role && intensity > e.intensity);
    if (better) out[i] = { intensity: intensity, role: role, slow: slow, inFlight: inFlight };
  }
  for (var k = 0; k < steps.length; k++) {
    var s = steps[k];
    if (s[0] > p) break;
    var has = s[1] > 220;
    var end = s[0] + (has ? s[1] : 220);
    var fade = has ? 700 : 250;
    var strength, inFlight;
    if (p <= end) { strength = has ? 1 : 0.7; inFlight = true; }
    else if (p <= end + fade) { strength = (has ? 1 : 0.7) * (1 - (p - end) / fade); inFlight = false; }
    else continue;
    var dwell = s[3] !== null ? s[3] : s[2];
    if (dwell !== null) consider(dwell, "dwell", strength, s[5], inFlight);
    if (s[3] !== null && s[2] !== null) consider(s[2], "caller", strength, s[5], inFlight);
    for (var j = 0; j < s[4].length; j++) consider(s[4][j], "dwell", strength, s[5], inFlight);
  }
  return out;
}`;

const font = "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const tones: Record<Entity["kind"], string> = {
  user: "#cbd5e1",
  frontend: "#60a5fa",
  service: "#818cf8",
  agent: "#67e8f9",
  model: "#c084fc",
  memory: "#34d399",
  vector_database: "#fb923c",
  database: "#fb923c",
  tool: "#facc15",
  mcp_server: "#facc15",
  web: "#38bdf8",
  document: "#a3e635",
  api: "#818cf8",
  queue: "#818cf8",
  storage: "#fb923c",
  infrastructure: "#818cf8",
  cloud: "#38bdf8",
  network: "#818cf8",
  cluster: "#67e8f9",
  namespace: "#a3e635",
  workload: "#818cf8",
  container: "#facc15",
  gateway: "#38bdf8",
  load_balancer: "#38bdf8",
  function: "#67e8f9",
  config: "#a3e635",
  identity: "#cbd5e1",
};

export interface ReplayOptions {
  anonymize?: boolean;
  brand?: boolean;
  maxSteps?: number;
}

export interface ReplayResult {
  html: string;
  includedSteps: number;
  totalSteps: number;
  truncated: boolean;
}

/** JSON that is safe inside a <script> element (no `</script>` or HTML comment breakout). */
function scriptJson(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

export function renderReplayHtml(
  graph: ArchitectureGraph,
  layout: PositionedGraph,
  run: Run,
  options: ReplayOptions = {},
): ReplayResult {
  const labels = entityLabels(graph.entities, options.anonymize ?? false);
  const padding = 40;
  const nodes = layout.entities.flatMap((positioned) => {
    const entity = graph.entities.find((candidate) => candidate.id === positioned.id);
    return entity ? [{ entity, positioned }] : [];
  });
  const entityIds = nodes.map(({ entity }) => entity.id);
  const plan = buildPlaybackPlan(run, entityIds, {
    ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
  });
  const indexOf = new Map(entityIds.map((id, position) => [id, position]));
  const width = Math.max(480, Math.ceil(layout.width) + padding * 2);
  const height = Math.max(240, Math.ceil(layout.height) + padding * 2);

  const data = {
    steps: plan.steps.map((step) => [
      step.startMs,
      step.playMs,
      step.source,
      step.target,
      step.extra,
      step.slow,
    ]),
    meta: plan.steps.map((step) => [
      step.realOffsetMs,
      step.realDurationMs,
      step.category,
      step.failed ? 1 : 0,
    ]),
    names: nodes.map(({ entity }) => labels.get(entity.id) ?? safeLabel(entity.name)),
    totalMs: plan.totalMs,
    totalSteps: plan.totalSteps,
    includedSteps: plan.includedSteps,
    edges: layout.edges.flatMap((edge) => {
      const source = indexOf.get(edge.source);
      const target = indexOf.get(edge.target);
      return source !== undefined && target !== undefined ? [[source, target]] : [];
    }),
    realTotal: formatDuration(run.totalDurationMs),
  };

  const edgeSvg = data.edges
    .map(([s, t], position) => {
      const a = nodes[s!]!.positioned;
      const b = nodes[t!]!.positioned;
      const x1 = padding + a.position.x + a.width;
      const y1 = padding + a.position.y + a.height / 2;
      const x2 = padding + b.position.x;
      const y2 = padding + b.position.y + b.height / 2;
      const handle = Math.max(24, Math.abs(x2 - x1) / 2);
      return `<path class="edge" data-e="${position}" d="M${x1} ${y1} C${x1 + handle} ${y1} ${x2 - handle} ${y2} ${x2} ${y2}" marker-end="url(#arrow)"/>`;
    })
    .join("\n");
  const nodeSvg = nodes
    .map(({ entity, positioned }, position) => {
      const x = padding + positioned.position.x;
      const y = padding + positioned.position.y;
      const color = tones[entity.kind];
      const label = labels.get(entity.id) ?? safeLabel(entity.name);
      const shown = label.length > 22 ? `${label.slice(0, 21)}…` : label;
      return `<g class="node" data-n="${position}" style="--c:${color}"><rect x="${x}" y="${y}" width="${positioned.width}" height="${positioned.height}" rx="12"/><rect class="bar" x="${x}" y="${y + 14}" width="4" height="${positioned.height - 28}" rx="2"/><text class="name" x="${x + 18}" y="${y + positioned.height / 2 - 3}">${escapeXml(shown)}</text><text class="kind" x="${x + 18}" y="${y + positioned.height / 2 + 16}">${escapeXml(kindLabel(entity.kind).toUpperCase())}</text></g>`;
    })
    .join("\n");

  const title = options.anonymize ? "System replay" : `${safeLabel(graph.title, 60)} replay`;
  const truncated = plan.includedSteps < plan.totalSteps;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeXml(title)}</title>
<style>
:root{--bg:#080a0f;--panel:#10151d;--border:#1f2733;--text:#e2e8f0;--muted:#64748b;--accent:#67e8f9;--warn:#fbbf24;--bad:#fb7185}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ${font};min-height:100vh;display:flex;flex-direction:column}
header{padding:16px 24px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;gap:8px 24px;align-items:baseline}
h1{margin:0;font-size:18px}
header p{margin:0;color:var(--muted);font-size:13px}
main{flex:1;display:flex;flex-direction:column;min-height:0}
.stage{flex:1;min-height:320px;padding:8px 16px;overflow:auto}
svg{display:block;width:100%;height:auto;max-height:68vh}
.node rect{fill:var(--panel);stroke:var(--border);stroke-width:1;transition:stroke .2s}
.node .bar{fill:var(--c);stroke:none}
.node .name{fill:var(--text);font:600 14px ${font}}
.node .kind{fill:var(--muted);font:10.5px ${mono};letter-spacing:1px}
.node{transition:opacity .2s}
.dim .node{opacity:.45}
.dim .node[data-role]{opacity:1}
.node[data-role=dwell] rect:first-child{stroke:var(--c);stroke-width:calc(1px + var(--g,0) * 1.5px)}
.node[data-role=dwell]{filter:drop-shadow(0 0 calc(4px + var(--g,0) * 18px) var(--c))}
.node[data-role=dwell][data-slow="1"] rect:first-child{stroke:var(--warn)}
.node[data-role=dwell][data-slow="1"]{filter:drop-shadow(0 0 calc(5px + var(--g,0) * 22px) rgba(251,191,36,.8))}
.node[data-role=caller]{filter:drop-shadow(0 0 calc(3px + var(--g,0) * 10px) var(--c))}
.node[data-inflight="1"][data-role=dwell]{animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{50%{opacity:.82}}
.edge{fill:none;stroke:#334155;stroke-width:1.4;opacity:.9}
.edge.on{stroke:var(--accent);stroke-width:2.2;stroke-dasharray:6 5;animation:flow .8s linear infinite}
@keyframes flow{to{stroke-dashoffset:-11}}
.controls{border-top:1px solid var(--border);background:var(--panel);padding:12px 24px;display:flex;flex-wrap:wrap;gap:12px 16px;align-items:center}
button,select{background:#0b1017;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 14px;font:13px ${font};cursor:pointer}
button:hover,select:hover{border-color:#334155}
button.primary{background:var(--accent);color:#06222a;border-color:var(--accent);font-weight:600;min-width:84px}
input[type=range]{flex:1;min-width:200px;accent-color:var(--accent)}
.now{font:13px ${mono};color:var(--muted);min-width:180px}
.step{padding:10px 24px;font-size:13px;color:var(--text);min-height:44px;border-top:1px solid var(--border)}
.step .bad{color:var(--bad)} .step .slow{color:var(--warn)} .step .muted{color:var(--muted)}
footer{padding:10px 24px;color:var(--muted);font-size:12px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 24px;border-top:1px solid var(--border)}
footer .brand{color:var(--accent)}
@media (prefers-reduced-motion:reduce){.node[data-inflight="1"][data-role=dwell],.edge.on{animation:none}}
</style>
</head>
<body>
<header>
<h1>${escapeXml(title)}</h1>
<p>Replay of a local agent session · ${escapeXml(data.realTotal)} real time · ${plan.includedSteps} steps shown${truncated ? ` of ${plan.totalSteps} (the rest are not included)` : ""}</p>
</header>
<main>
<div class="stage" id="stage">
<svg id="map" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#475569"/></marker></defs>
${edgeSvg}
${nodeSvg}
</svg>
</div>
<div class="step" id="step" aria-live="polite"></div>
<div class="controls">
<button class="primary" id="play" type="button" aria-label="Play or pause">Play</button>
<button id="restart" type="button">Restart</button>
<input id="scrub" type="range" min="0" max="${plan.totalMs}" value="0" step="1" aria-label="Position in the replay">
<label class="muted">Speed <select id="speed" aria-label="Playback speed"><option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option><option value="4">4x</option></select></label>
<span class="now" id="now"></span>
</div>
</main>
<footer>
<span>Playback is compressed: long steps are shortened so you can follow the story. Times shown are real. Only names of system parts are included; no prompts, commands or file paths. Detected and observed activity; not a complete picture.</span>
${(options.brand ?? true) ? '<span class="brand">Made with Avalok · avalok.dev</span>' : ""}
</footer>
<script type="application/json" id="data">${scriptJson(data)}</script>
<script>
(function () {
${glowScript}
var D = JSON.parse(document.getElementById("data").textContent);
var nodes = document.querySelectorAll(".node");
var edges = document.querySelectorAll(".edge");
var svg = document.getElementById("map");
var scrub = document.getElementById("scrub");
var playBtn = document.getElementById("play");
var nowEl = document.getElementById("now");
var stepEl = document.getElementById("step");
var speedEl = document.getElementById("speed");
var pos = 0, playing = false, last = 0;
function fmt(ms) {
  var s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  var m = Math.floor(s / 60);
  if (m < 60) return m + "m " + ("0" + (s % 60)).slice(-2) + "s";
  var h = Math.floor(m / 60);
  return h + "h " + ("0" + (m % 60)).slice(-2) + "m";
}
function span(cls, text) { var el = document.createElement("span"); if (cls) el.className = cls; el.textContent = text; return el; }
function setStep(parts) { while (stepEl.firstChild) stepEl.removeChild(stepEl.firstChild); for (var q = 0; q < parts.length; q++) stepEl.appendChild(parts[q]); }
function render() {
  var glow = glowAt(D.steps, pos);
  var any = false;
  for (var i = 0; i < nodes.length; i++) {
    var g = glow[i], n = nodes[i];
    if (g) {
      any = true;
      n.setAttribute("data-role", g.role);
      n.setAttribute("data-inflight", g.inFlight ? "1" : "0");
      n.setAttribute("data-slow", g.slow ? "1" : "0");
      n.style.setProperty("--g", g.intensity.toFixed(3));
    } else {
      n.removeAttribute("data-role"); n.removeAttribute("data-inflight"); n.removeAttribute("data-slow"); n.style.removeProperty("--g");
    }
  }
  svg.classList.toggle("dim", any);
  var live = {};
  var current = -1;
  for (var k = 0; k < D.steps.length; k++) {
    var s = D.steps[k];
    if (s[0] > pos) break;
    current = k;
    if (pos <= s[0] + Math.max(s[1], 220) && s[2] !== null && s[3] !== null) live[s[2] + "-" + s[3]] = 1;
  }
  for (var e = 0; e < edges.length; e++) edges[e].classList.toggle("on", !!live[D.edges[e][0] + "-" + D.edges[e][1]]);
  if (current < 0) {
    setStep([span("muted", "Press Play, or drag the slider.")]);
    nowEl.textContent = "0s into the session";
  } else {
    var s2 = D.steps[current], m = D.meta[current];
    var who = (s2[2] !== null ? D.names[s2[2]] : "") + (s2[2] !== null && s2[3] !== null ? " → " : "") + (s2[3] !== null ? D.names[s2[3]] : "");
    var parts = [span("", who || "Step"), span("muted", " · " + m[2] + (m[1] > 0 ? " · took " + fmt(m[1]) : ""))];
    if (m[3]) parts.push(span("bad", " failed"));
    if (s2[5]) parts.push(span("slow", " slow step"));
    setStep(parts);
    nowEl.textContent = fmt(m[0]) + " into the session";
  }
  scrub.value = String(Math.round(pos));
  playBtn.textContent = playing ? "Pause" : (pos >= D.totalMs ? "Replay" : "Play");
}
function tick(t) {
  if (!playing) return;
  var dt = Math.min(100, t - last); last = t;
  pos += dt * Number(speedEl.value);
  if (pos >= D.totalMs) { pos = D.totalMs; playing = false; }
  render();
  if (playing) requestAnimationFrame(tick);
}
playBtn.addEventListener("click", function () {
  if (playing) { playing = false; render(); return; }
  if (pos >= D.totalMs) pos = 0;
  playing = true; last = performance.now(); render(); requestAnimationFrame(tick);
});
document.getElementById("restart").addEventListener("click", function () { pos = 0; playing = false; render(); });
scrub.addEventListener("input", function () { pos = Number(scrub.value); render(); });
document.addEventListener("keydown", function (e) {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) return;
  if (e.key === " ") { e.preventDefault(); playBtn.click(); }
  if (e.key === "ArrowRight") { pos = Math.min(D.totalMs, pos + 1500); render(); }
  if (e.key === "ArrowLeft") { pos = Math.max(0, pos - 1500); render(); }
});
render();
})();
</script>
</body>
</html>
`;
  return {
    html,
    includedSteps: plan.includedSteps,
    totalSteps: plan.totalSteps,
    truncated,
  };
}
