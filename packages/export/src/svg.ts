import type { PositionedGraph } from "@visual-system/graph";
import type { ArchitectureGraph, Entity } from "@visual-system/schema";
import { entityLabels, escapeXml, kindLabel, safeLabel } from "./labels";
import { formatCount, formatDuration, plural, type SessionRecap } from "./recap";

// Self-contained SVG (no scripts, no external fonts, images or links) so a file can be previewed,
// saved, attached to a pull request or committed to a README without leaking anything.

export interface BrandOptions {
  /** "Made with Avalok · avalok.dev" in the footer. On by default; users can turn it off. */
  brand?: boolean;
}

const font = "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const palette = {
  background: "#080a0f",
  panel: "#10151d",
  border: "#1f2733",
  text: "#e2e8f0",
  muted: "#64748b",
  accent: "#67e8f9",
  warning: "#fbbf24",
  danger: "#fb7185",
  good: "#34d399",
};

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

function svgRoot(width: number, height: number, title: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
<title>${escapeXml(title)}</title>
<rect width="${width}" height="${height}" fill="${palette.background}"/>
${body}
</svg>
`;
}

function brandFooter(width: number, height: number, note: string, brand: boolean) {
  return `<text x="32" y="${height - 24}" font-family="${font}" font-size="13" fill="${palette.muted}">${escapeXml(note)}</text>${
    brand
      ? `\n<text x="${width - 32}" y="${height - 24}" text-anchor="end" font-family="${font}" font-size="13" fill="${palette.accent}">Made with Avalok · avalok.dev</text>`
      : ""
  }`;
}

function truncate(text: string, maximum: number) {
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

// ---------------------------------------------------------------------------------------------
// Recap card (1200 x 630, the usual social/PR preview size)
// ---------------------------------------------------------------------------------------------

export function renderRecapSvg(recap: SessionRecap, options: BrandOptions = {}) {
  const width = 1200;
  const height = 630;
  const status =
    recap.status === "error"
      ? { text: "ended with an error", color: palette.danger }
      : recap.status === "running"
        ? { text: "in progress", color: palette.accent }
        : { text: "completed", color: palette.good };

  const tiles: { value: string; label: string; color: string }[] = [
    { value: formatDuration(recap.durationMs), label: "Duration", color: palette.text },
    { value: formatCount(recap.steps), label: "Steps observed", color: palette.text },
    {
      value: String(recap.failures),
      label: "Failed steps",
      color: recap.failures > 0 ? palette.warning : palette.text,
    },
    {
      value: String(recap.slowSteps),
      label: "Slow steps (10 s+)",
      color: recap.slowSteps > 0 ? palette.warning : palette.text,
    },
  ];
  const tileWidth = 262;
  const tileGap = 16;
  const tilesSvg = tiles
    .map((tile, index) => {
      const x = 32 + index * (tileWidth + tileGap);
      return `<g>
<rect x="${x}" y="108" width="${tileWidth}" height="118" rx="14" fill="${palette.panel}" stroke="${palette.border}"/>
<text x="${x + 20}" y="170" font-family="${font}" font-size="46" font-weight="700" fill="${tile.color}">${escapeXml(tile.value)}</text>
<text x="${x + 20}" y="204" font-family="${font}" font-size="15" fill="${palette.muted}">${escapeXml(tile.label)}</text>
</g>`;
    })
    .join("\n");

  const facts = [
    recap.commands > 0 ? plural(recap.commands, "command") : "",
    recap.fileOperations > 0 ? plural(recap.fileOperations, "file operation") : "",
    recap.testRuns > 0 ? plural(recap.testRuns, "test run") : "",
    recap.toolCalls > 0 ? plural(recap.toolCalls, "tool call") : "",
    recap.modelCalls > 0 ? plural(recap.modelCalls, "model call") : "",
    recap.retries > 0 ? plural(recap.retries, "retry", "retries") : "",
    recap.inputTokens !== null || recap.outputTokens !== null
      ? `${formatCount((recap.inputTokens ?? 0) + (recap.outputTokens ?? 0))} tokens`
      : "",
  ].filter(Boolean);

  const maxTime = Math.max(1, ...recap.whereTimeWent.map((entry) => entry.timeMs));
  const barsSvg = recap.whereTimeWent.length
    ? recap.whereTimeWent
        .map((entry, index) => {
          const y = 296 + index * 44;
          const barWidth = Math.max(6, Math.round((entry.timeMs / maxTime) * 520));
          const color = tones[entry.kind];
          return `<g>
<text x="32" y="${y + 14}" font-family="${font}" font-size="16" fill="${palette.text}">${escapeXml(truncate(entry.label, 22))}</text>
<rect x="250" y="${y}" width="520" height="18" rx="9" fill="${palette.panel}"/>
<rect x="250" y="${y}" width="${barWidth}" height="18" rx="9" fill="${color}" opacity="0.85"/>
<text x="786" y="${y + 14}" font-family="${mono}" font-size="15" fill="${palette.muted}">${escapeXml(formatDuration(entry.timeMs))}</text>
</g>`;
        })
        .join("\n")
    : `<text x="32" y="324" font-family="${font}" font-size="16" fill="${palette.muted}">Step durations were not recorded for this session.</text>`;

  const touched = recap.architectureTouched.length
    ? `<text x="880" y="296" font-family="${font}" font-size="15" fill="${palette.muted}">SYSTEM PARTS TOUCHED</text>\n${recap.architectureTouched
        .slice(0, 5)
        .map(
          (entry, index) =>
            `<text x="880" y="${326 + index * 30}" font-family="${font}" font-size="16" fill="${palette.text}">${escapeXml(truncate(entry.label, 22))}</text><text x="1168" y="${326 + index * 30}" text-anchor="end" font-family="${mono}" font-size="14" fill="${palette.muted}">${entry.steps}</text>`,
        )
        .join("\n")}`
    : "";

  const body = `<text x="32" y="64" font-family="${font}" font-size="30" font-weight="700" fill="${palette.text}">Agent session recap</text>
<text x="32" y="90" font-family="${font}" font-size="15" fill="${status.color}">${escapeXml(status.text)}</text>
${tilesSvg}
<text x="32" y="256" font-family="${font}" font-size="15" fill="${palette.muted}">${escapeXml(facts.join("  ·  "))}</text>
<text x="32" y="286" font-family="${font}" font-size="15" fill="${palette.muted}" letter-spacing="1">WHERE THE TIME WENT</text>
${barsSvg}
${touched}
${brandFooter(width, height, recap.unavailable.length ? `Not observed: ${recap.unavailable.join(", ")}. Built from local session data; nothing uploaded.` : "Built from local session data; nothing uploaded.", options.brand ?? true)}`;
  return svgRoot(width, height, "Agent session recap", body);
}

// ---------------------------------------------------------------------------------------------
// Architecture diagram
// ---------------------------------------------------------------------------------------------

export interface DiagramOptions extends BrandOptions {
  anonymize?: boolean;
  /** Entity ids to emphasize (for example the parts a session touched). */
  highlightIds?: ReadonlySet<string>;
}

export function renderDiagramSvg(
  graph: ArchitectureGraph,
  layout: PositionedGraph,
  options: DiagramOptions = {},
) {
  const labels = entityLabels(graph.entities, options.anonymize ?? false);
  const padding = 40;
  const header = 64;
  const footer = 52;
  const width = Math.max(480, Math.ceil(layout.width) + padding * 2);
  const height = Math.max(240, Math.ceil(layout.height) + header + footer + padding);
  const byId = new Map(layout.entities.map((entity) => [entity.id, entity]));
  const highlight = options.highlightIds;
  const anyHighlight = !!highlight && highlight.size > 0;

  const edges = layout.edges
    .map((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) return "";
      const x1 = padding + source.position.x + source.width;
      const y1 = header + source.position.y + source.height / 2;
      const x2 = padding + target.position.x;
      const y2 = header + target.position.y + target.height / 2;
      const handle = Math.max(24, Math.abs(x2 - x1) / 2);
      const lit = anyHighlight && highlight!.has(edge.source) && highlight!.has(edge.target);
      return `<path d="M${x1} ${y1} C${x1 + handle} ${y1} ${x2 - handle} ${y2} ${x2} ${y2}" fill="none" stroke="${lit ? palette.accent : "#334155"}" stroke-width="${lit ? 2 : 1.4}" marker-end="url(#arrow)" opacity="${anyHighlight && !lit ? 0.45 : 0.9}"/>`;
    })
    .join("\n");

  const nodes = layout.entities
    .map((positioned) => {
      const entity = graph.entities.find((candidate) => candidate.id === positioned.id);
      if (!entity) return "";
      const x = padding + positioned.position.x;
      const y = header + positioned.position.y;
      const color = tones[entity.kind];
      const lit = !anyHighlight || highlight!.has(entity.id);
      const label = truncate(labels.get(entity.id) ?? safeLabel(entity.name), 22);
      return `<g opacity="${lit ? 1 : 0.4}">
<rect x="${x}" y="${y}" width="${positioned.width}" height="${positioned.height}" rx="12" fill="${palette.panel}" stroke="${anyHighlight && lit ? color : palette.border}" stroke-width="${anyHighlight && lit ? 1.8 : 1}"/>
<rect x="${x}" y="${y + 14}" width="4" height="${positioned.height - 28}" rx="2" fill="${color}"/>
<text x="${x + 18}" y="${y + positioned.height / 2 - 3}" font-family="${font}" font-size="14" font-weight="600" fill="${palette.text}">${escapeXml(label)}</text>
<text x="${x + 18}" y="${y + positioned.height / 2 + 16}" font-family="${mono}" font-size="10.5" fill="${palette.muted}" letter-spacing="1">${escapeXml(kindLabel(entity.kind).toUpperCase())}</text>
</g>`;
    })
    .join("\n");

  const title = safeLabel(graph.title, 60);
  const body = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#475569"/></marker></defs>
<text x="32" y="40" font-family="${font}" font-size="18" font-weight="700" fill="${palette.text}">${escapeXml(options.anonymize ? "System architecture" : title)}</text>
${edges}
${nodes}
${brandFooter(width, height, "Detected from configuration and observed activity; not a complete picture.", options.brand ?? true)}`;
  return svgRoot(
    width,
    height,
    `${options.anonymize ? "System" : title} architecture diagram`,
    body,
  );
}
