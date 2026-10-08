import { escapeXml, safeLabel } from "./labels";
import { formatCount, formatDuration, plural, type SessionRecap } from "./recap";

// A weekly "wrapped" card from the agent sessions on this machine: counts and timings only. No
// repository names, folders, prompts, titles or paths are ever included; the only names are the
// agent's own tools (Terminal, Files, MCP servers), passed through the same privacy filter.

export interface WrappedInput {
  /** Identifies the session, so a session that spans several days counts once. */
  sessionId: string;
  /** Local calendar day these steps happened on, `YYYY-MM-DD`. */
  day: string;
  /** The recap of only the steps that happened on that day (and inside the period). */
  recap: SessionRecap;
}

export interface WrappedStats {
  sessions: number;
  activeDays: number;
  /** First and last day with a session (`YYYY-MM-DD`), or null when there are none. */
  firstDay: string | null;
  lastDay: string | null;
  /** Time spent in steps (the sum of recorded step durations), not wall-clock session time. */
  stepTimeMs: number;
  steps: number;
  commands: number;
  fileOperations: number;
  testRuns: number;
  failures: number;
  slowSteps: number;
  longestStepMs: number;
  busiestDay: { day: string; sessions: number; steps: number } | null;
  /** Where the recorded step time went across all sessions, most first. */
  tools: { label: string; timeMs: number; steps: number }[];
}

export function summarizeWrapped(inputs: readonly WrappedInput[], topCount = 3): WrappedStats {
  const days = new Map<string, { sessions: number; steps: number }>();
  const tools = new Map<string, { label: string; timeMs: number; steps: number }>();
  const stats: WrappedStats = {
    sessions: 0,
    activeDays: 0,
    firstDay: null,
    lastDay: null,
    stepTimeMs: 0,
    steps: 0,
    commands: 0,
    fileOperations: 0,
    testRuns: 0,
    failures: 0,
    slowSteps: 0,
    longestStepMs: 0,
    busiestDay: null,
    tools: [],
  };
  const sessionIds = new Set<string>();
  for (const { sessionId, day, recap } of inputs) {
    sessionIds.add(sessionId);
    stats.stepTimeMs += recap.stepTimeMs;
    stats.steps += recap.steps;
    stats.commands += recap.commands;
    stats.fileOperations += recap.fileOperations;
    stats.testRuns += recap.testRuns;
    stats.failures += recap.failures;
    stats.slowSteps += recap.slowSteps;
    stats.longestStepMs = Math.max(stats.longestStepMs, recap.longestStepMs);
    const entry = days.get(day) ?? { sessions: 0, steps: 0 };
    entry.sessions += 1;
    entry.steps += recap.steps;
    days.set(day, entry);
    for (const part of recap.whereTimeWent) {
      const tool = tools.get(part.label) ?? { label: part.label, timeMs: 0, steps: 0 };
      tool.timeMs += part.timeMs;
      tool.steps += part.steps;
      tools.set(part.label, tool);
    }
  }
  stats.sessions = sessionIds.size;
  const sortedDays = [...days.keys()].sort();
  stats.activeDays = sortedDays.length;
  stats.firstDay = sortedDays[0] ?? null;
  stats.lastDay = sortedDays.at(-1) ?? null;
  const busiest = [...days.entries()].sort(
    (a, b) => b[1].steps - a[1].steps || b[1].sessions - a[1].sessions || a[0].localeCompare(b[0]),
  )[0];
  if (busiest) stats.busiestDay = { day: busiest[0], ...busiest[1] };
  stats.tools = [...tools.values()]
    .sort((a, b) => b.timeMs - a.timeMs || b.steps - a.steps || a.label.localeCompare(b.label))
    .slice(0, topCount)
    .map((tool) => ({ ...tool, label: safeLabel(tool.label) }));
  return stats;
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-10-07` -> `Oct 7`. */
export function shortDay(day: string) {
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${months[Number(match[2]) - 1] ?? "?"} ${Number(match[3])}` : day;
}

export function periodLabel(stats: WrappedStats) {
  if (!stats.firstDay || !stats.lastDay) return "No sessions";
  return stats.firstDay === stats.lastDay
    ? shortDay(stats.firstDay)
    : `${shortDay(stats.firstDay)} – ${shortDay(stats.lastDay)}`;
}

const font = "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
const palette = {
  background: "#080a0f",
  panel: "#10151d",
  border: "#1f2733",
  text: "#e2e8f0",
  muted: "#64748b",
  accent: "#67e8f9",
  warning: "#fbbf24",
};

export function renderWrappedSvg(stats: WrappedStats, options: { brand?: boolean } = {}) {
  const width = 1200;
  const height = 630;
  const tiles = [
    {
      value: formatCount(stats.sessions),
      label: plural(stats.sessions, "session").replace(/^\S+ /, ""),
    },
    {
      value: formatCount(stats.commands),
      label: plural(stats.commands, "command").replace(/^\S+ /, ""),
    },
    {
      value: formatCount(stats.fileOperations),
      label: plural(stats.fileOperations, "file operation").replace(/^\S+ /, ""),
    },
    {
      value: formatCount(stats.failures),
      label: stats.failures === 1 ? "failed step" : "failed steps",
    },
  ];
  const tileWidth = 262;
  const tilesSvg = tiles
    .map((tile, index) => {
      const x = 32 + index * (tileWidth + 16);
      return `<g><rect x="${x}" y="116" width="${tileWidth}" height="118" rx="14" fill="${palette.panel}" stroke="${palette.border}"/><text x="${x + 20}" y="178" font-family="${font}" font-size="46" font-weight="700" fill="${index === 3 && stats.failures > 0 ? palette.warning : palette.text}">${escapeXml(tile.value)}</text><text x="${x + 20}" y="212" font-family="${font}" font-size="15" fill="${palette.muted}">${escapeXml(tile.label)}</text></g>`;
    })
    .join("\n");
  const facts = [
    stats.stepTimeMs ? `${formatDuration(stats.stepTimeMs)} spent in agent steps` : "",
    stats.activeDays ? `active on ${plural(stats.activeDays, "day")}` : "",
    stats.testRuns ? plural(stats.testRuns, "test run") : "",
    stats.slowSteps ? `${plural(stats.slowSteps, "slow step")} (10 s+)` : "",
  ].filter(Boolean);
  const highlights = [
    stats.longestStepMs
      ? { label: "LONGEST STEP", value: formatDuration(stats.longestStepMs) }
      : undefined,
    stats.busiestDay
      ? {
          label: "BUSIEST DAY",
          value: `${shortDay(stats.busiestDay.day)} · ${plural(stats.busiestDay.steps, "step")}`,
        }
      : undefined,
  ].filter((entry): entry is { label: string; value: string } => entry !== undefined);
  const highlightSvg = highlights
    .map(
      (entry, index) =>
        `<g><text x="${32 + index * 380}" y="284" font-family="${font}" font-size="13" fill="${palette.muted}" letter-spacing="1">${entry.label}</text><text x="${32 + index * 380}" y="316" font-family="${font}" font-size="24" font-weight="600" fill="${palette.text}">${escapeXml(entry.value)}</text></g>`,
    )
    .join("\n");
  const maxTime = Math.max(1, ...stats.tools.map((tool) => tool.timeMs));
  const toolSvg = stats.tools.length
    ? `<text x="32" y="372" font-family="${font}" font-size="13" fill="${palette.muted}" letter-spacing="1">WHERE THE TIME WENT</text>\n${stats.tools
        .map((tool, index) => {
          const y = 392 + index * 44;
          const barWidth = Math.max(6, Math.round((tool.timeMs / maxTime) * 560));
          return `<g><text x="32" y="${y + 14}" font-family="${font}" font-size="16" fill="${palette.text}">${escapeXml(tool.label.length > 22 ? `${tool.label.slice(0, 21)}…` : tool.label)}</text><rect x="250" y="${y}" width="560" height="18" rx="9" fill="${palette.panel}"/><rect x="250" y="${y}" width="${barWidth}" height="18" rx="9" fill="${palette.accent}" opacity="0.8"/><text x="826" y="${y + 14}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" fill="${palette.muted}">${escapeXml(formatDuration(tool.timeMs))}</text></g>`;
        })
        .join("\n")}`
    : "";
  const body = `<text x="32" y="62" font-family="${font}" font-size="30" font-weight="700" fill="${palette.text}">Your agent week</text>
<text x="32" y="90" font-family="${font}" font-size="15" fill="${palette.accent}">${escapeXml(periodLabel(stats))}</text>
${tilesSvg}
<text x="32" y="258" font-family="${font}" font-size="15" fill="${palette.muted}">${escapeXml(facts.join("  ·  "))}</text>
${highlightSvg}
${toolSvg}
<text x="32" y="${height - 24}" font-family="${font}" font-size="13" fill="${palette.muted}">Counts only, computed from local session files; nothing uploaded.</text>${
    (options.brand ?? true)
      ? `\n<text x="${width - 32}" y="${height - 24}" text-anchor="end" font-family="${font}" font-size="13" fill="${palette.accent}">Made with Avalok · avalok.dev</text>`
      : ""
  }`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Your agent week">
<title>Your agent week</title>
<rect width="${width}" height="${height}" fill="${palette.background}"/>
${body}
</svg>
`;
}

export function renderWrappedMarkdown(stats: WrappedStats, options: { brand?: boolean } = {}) {
  const lines = [
    `### Your agent week (${periodLabel(stats)})`,
    "",
    `${plural(stats.sessions, "session")} on ${plural(stats.activeDays, "day")} · ${formatDuration(stats.stepTimeMs)} spent in steps`,
    "",
    "| What | Count |",
    "| --- | ---: |",
    `| Commands | ${formatCount(stats.commands)} |`,
    `| File operations | ${formatCount(stats.fileOperations)} |`,
    `| Test runs | ${formatCount(stats.testRuns)} |`,
    `| Failed steps | ${formatCount(stats.failures)} |`,
    `| Slow steps (10 s or more) | ${formatCount(stats.slowSteps)} |`,
    "",
  ];
  if (stats.longestStepMs) lines.push(`Longest step: ${formatDuration(stats.longestStepMs)}`);
  if (stats.busiestDay)
    lines.push(
      `Busiest day: ${shortDay(stats.busiestDay.day)} (${plural(stats.busiestDay.steps, "step")})`,
    );
  if (stats.tools.length) {
    lines.push("", "**Where the time went**", "");
    stats.tools.forEach((tool, index) =>
      lines.push(
        `${index + 1}. ${tool.label.replace(/([\\`*_{}[\]()#+!|<>~])/g, "\\$1")}: ${formatDuration(tool.timeMs)}`,
      ),
    );
  }
  lines.push("", "_Counts only, computed from local session files; nothing uploaded._");
  if (options.brand ?? true) lines.push("", "Made with [Avalok](https://avalok.dev)");
  return `${lines.join("\n")}\n`;
}
