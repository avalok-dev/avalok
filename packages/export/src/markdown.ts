import { formatCount, formatDuration, type SessionRecap } from "./recap";

function escapeMarkdown(text: string) {
  return text.replace(/([\\`*_{}[\]()#+!|<>~])/g, "\\$1");
}

/**
 * A short Markdown summary for a pull request comment or issue. Plain text only: no HTML, no
 * links other than the optional footer, and only the privacy-safe labels the recap already holds.
 */
export function renderRecapMarkdown(recap: SessionRecap, options: { brand?: boolean } = {}) {
  const status =
    recap.status === "error"
      ? "ended with an error"
      : recap.status === "running"
        ? "in progress"
        : "completed";
  const lines: string[] = [
    "### Agent session recap",
    "",
    `**${status}** in ${formatDuration(recap.durationMs)} · ${formatCount(recap.steps)} steps observed · ${recap.failures} failed · ${recap.slowSteps} slow (10 s or more)`,
    "",
  ];
  const facts: [string, number][] = [
    ["Commands", recap.commands],
    ["File operations", recap.fileOperations],
    ["Test runs", recap.testRuns],
    ["Tool calls", recap.toolCalls],
    ["Model calls", recap.modelCalls],
    ["Retries", recap.retries],
  ];
  const shown = facts.filter(([, value]) => value > 0);
  if (shown.length) {
    lines.push("| What | Count |", "| --- | ---: |");
    for (const [name, value] of shown) lines.push(`| ${name} | ${formatCount(value)} |`);
    lines.push("");
  }
  if (recap.whereTimeWent.length) {
    lines.push("**Where the time went**", "");
    recap.whereTimeWent.forEach((entry, index) => {
      lines.push(
        `${index + 1}. ${escapeMarkdown(entry.label)}: ${formatDuration(entry.timeMs)} (${entry.steps} ${entry.steps === 1 ? "step" : "steps"}${entry.failures ? `, ${entry.failures} failed` : ""})`,
      );
    });
    lines.push("");
  }
  if (recap.architectureTouched.length) {
    lines.push(
      `**System parts touched:** ${recap.architectureTouched
        .map((entry) => `${escapeMarkdown(entry.label)} (${entry.steps})`)
        .join(", ")}`,
      "",
    );
  }
  lines.push(
    `_Built from local session data; nothing uploaded.${
      recap.unavailable.length ? ` Not observed: ${recap.unavailable.join(", ")}.` : ""
    }_`,
  );
  if (options.brand ?? true) lines.push("", "Made with [Avalok](https://avalok.dev)");
  return `${lines.join("\n")}\n`;
}
