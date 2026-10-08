import {
  discoverCodexSessions,
  loadCodexSession,
  type CodexSessionData,
  type CodexSessionSummary,
} from "@visual-system/codex-adapter";
import {
  renderWrappedMarkdown,
  renderWrappedSvg,
  summarizeSession,
  summarizeWrapped,
  type WrappedInput,
} from "@visual-system/export";
import type { RecapOptions } from "./options.ts";
import { writeShareable } from "./output-file.ts";

// `avalok wrapped`: counts and timings from the agent sessions on this machine over the last few
// days, as a card people want to share. Local files only; no repository, folder, prompt, title or
// path ever appears in the output. Nothing is uploaded.
//
// Only steps that actually happened inside the window are counted, each on the local day it
// happened. A session file that was started months ago and resumed this week contributes only this
// week's steps, and a session that merely had its file touched contributes nothing.

export interface WrappedDependencies {
  discoverSessions: () => Promise<CodexSessionSummary[]>;
  loadSession: (session: CodexSessionSummary) => Promise<CodexSessionData>;
  now: () => number;
  /** Local calendar day (`YYYY-MM-DD`) of an ISO timestamp. */
  dayOf: (iso: string) => string;
}

const defaultDependencies: WrappedDependencies = {
  discoverSessions: () => discoverCodexSessions(),
  loadSession: loadCodexSession,
  now: () => Date.now(),
  dayOf: (iso) => new Date(iso).toLocaleDateString("en-CA"),
};

const maximumSessions = 200;

export async function runWrapped(options: {
  days: number;
  recap: RecapOptions;
  cwd: string;
  output: { write(text: string): unknown };
  dependencies?: Partial<WrappedDependencies>;
}): Promise<number> {
  const { recap, output } = options;
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const now = dependencies.now();
  const cutoff = now - options.days * 86_400_000;
  const all = await dependencies.discoverSessions().catch(() => []);
  // A file last written before the window cannot hold steps inside it (events precede the write).
  const recent = all
    .filter((session) => session.eventCount !== 0 && Date.parse(session.modifiedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
  if (recent.length === 0) {
    output.write(
      `No Codex sessions with events in the last ${options.days} day${options.days === 1 ? "" : "s"} (${all.length} found on this machine). Try --days 30.\n`,
    );
    return 1;
  }
  const included = recent.slice(0, maximumSessions);
  const inputs: WrappedInput[] = [];
  let unreadable = 0;
  for (const session of included) {
    try {
      const data = await dependencies.loadSession(session);
      const base = Date.parse(data.run.startedAt);
      const byDay = new Map<string, typeof data.run.events>();
      for (const event of data.run.events) {
        const at = base + event.timestamp;
        if (at < cutoff || at > now) continue;
        const day = dependencies.dayOf(new Date(at).toISOString());
        byDay.set(day, [...(byDay.get(day) ?? []), event]);
      }
      for (const [day, events] of byDay) {
        const first = events[0]!;
        const last = events.at(-1)!;
        const slice = {
          ...data.run,
          events,
          totalDurationMs: last.timestamp + (last.durationMs ?? 0) - first.timestamp,
        };
        inputs.push({
          sessionId: session.id,
          day,
          recap: summarizeSession(slice, data.architecture, { anonymize: recap.anonymize }),
        });
      }
    } catch {
      unreadable += 1; // A session file that cannot be read is skipped, never fatal.
    }
  }
  if (inputs.length === 0) {
    output.write(
      unreadable === included.length
        ? "The recent sessions could not be read.\n"
        : `No agent steps happened in the last ${options.days} day${options.days === 1 ? "" : "s"}, although ${included.length} session file${included.length === 1 ? " was" : "s were"} touched in that time. Try --days 30.\n`,
    );
    return 1;
  }
  const stats = summarizeWrapped(inputs);
  const capped =
    recent.length > included.length
      ? ` Only the newest ${included.length} of ${recent.length} sessions were included.`
      : "";
  if (recap.format === "md") {
    const markdown = renderWrappedMarkdown(stats, { brand: recap.brand });
    if (!recap.out) {
      output.write(markdown);
      return 0;
    }
    return writeShareable({
      cwd: options.cwd,
      out: recap.out,
      defaultName: "avalok-wrapped.md",
      content: markdown,
      label: "weekly summary",
      force: recap.force,
      output,
      note: `Counts and timings only; nothing was uploaded.${capped}`,
    });
  }
  return writeShareable({
    cwd: options.cwd,
    out: recap.out,
    defaultName: "avalok-wrapped.svg",
    content: renderWrappedSvg(stats, { brand: recap.brand }),
    label: "weekly card",
    force: recap.force,
    output,
    note: `Counts and timings only: no repositories, folders, prompts or paths. Nothing was uploaded.${capped}`,
  });
}
