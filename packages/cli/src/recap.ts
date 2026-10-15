import * as nodePath from "node:path";
import { basename, resolve } from "node:path";
import { analyzeRepository, type RepositoryAnalysis } from "@visual-system/analyzer";
import {
  pickSessionForRepository,
  renderDiagramSvg,
  renderRecapMarkdown,
  renderRecapSvg,
  renderReplayHtml,
  summarizeSession,
} from "@visual-system/export";
import { ElkLayoutEngine } from "@visual-system/graph";
import { reconcileArchitectureExecution } from "@visual-system/reconcile";
import type { ArchitectureGraph } from "@visual-system/schema";
import type { RecapOptions } from "./options.ts";
import { writeShareable } from "./output-file.ts";
import {
  defaultSessionSources,
  findSessionById,
  listAllSessions,
  loadAnySession,
  sourceLabel,
  type AgentSession,
  type LoadedSession,
} from "./session-source.ts";

// `avalok recap`: a summary of the newest agent session that ran in this repository, from local
// data only (Codex session files and the runs Avalok stored from Claude Code hooks and
// OpenTelemetry). The default output is Markdown on stdout (paste it into a pull request). svg, html and
// diagram are written to a file the user names (or avalok-recap.<ext> in the current directory) and
// never overwrite an existing file without --force. Nothing is uploaded.

export interface RecapDependencies {
  analyze: (target: string) => Promise<RepositoryAnalysis>;
  discoverSessions: () => Promise<AgentSession[]>;
  findSession: (id: string) => Promise<AgentSession | undefined>;
  loadSession: (session: AgentSession) => Promise<LoadedSession>;
  layout: (graph: ArchitectureGraph) => ReturnType<ElkLayoutEngine["layout"]>;
}

const sources = defaultSessionSources();
const defaultDependencies: RecapDependencies = {
  analyze: (target) => analyzeRepository(target),
  discoverSessions: () => listAllSessions(sources),
  findSession: (id) => findSessionById(sources, id),
  loadSession: (session) => loadAnySession(sources, session),
  layout: (graph) => new ElkLayoutEngine().layout(graph),
};

const defaultNames = {
  md: "avalok-recap.md",
  svg: "avalok-recap.svg",
  html: "avalok-replay.html",
  diagram: "avalok-diagram.svg",
} as const;

/**
 * The path to put in a README image link, or undefined when the file is not inside the
 * repository. Across drives (Windows) `relative` returns an absolute path, which must never be
 * treated as "inside" (it would print a machine path). The path module is injectable so the
 * Windows behaviour is tested on every OS.
 */
export function readmeEmbedPath(
  repositoryRoot: string,
  writtenFile: string,
  paths: Pick<typeof nodePath, "relative" | "isAbsolute"> = nodePath,
) {
  const inside = paths.relative(repositoryRoot, writtenFile);
  if (!inside || inside.startsWith("..") || paths.isAbsolute(inside)) return undefined;
  return inside.replaceAll("\\", "/");
}

export async function runRecap(options: {
  target: string;
  recap: RecapOptions;
  cwd: string;
  output: { write(text: string): unknown };
  dependencies?: Partial<RecapDependencies>;
}): Promise<number> {
  const { recap, output } = options;
  const dependencies = { ...defaultDependencies, ...options.dependencies };

  let analysis: RepositoryAnalysis;
  try {
    analysis = await dependencies.analyze(options.target);
  } catch (error) {
    output.write(
      `Avalok could not analyze this repository. ${error instanceof Error ? error.message : ""}\n`,
    );
    return 1;
  }

  // The architecture diagram needs no session.
  if (recap.format === "diagram") {
    const layout = await dependencies.layout(analysis.graph);
    const svg = renderDiagramSvg(analysis.graph, layout, {
      anonymize: recap.anonymize,
      brand: recap.brand,
    });
    const code = await emit(options, svg, "architecture diagram");
    if (code === 0) {
      // Put it in your README: the path relative to the repository, when it is inside it.
      const written = resolve(options.cwd, recap.out ?? defaultNames.diagram);
      const embed = readmeEmbedPath(analysis.repository.rootPath, written);
      if (embed) output.write(`To show it in your README:\n  ![Architecture](${embed})\n`);
    }
    return code;
  }

  let session: AgentSession | undefined;
  if (recap.session === "latest") {
    const sessions = await dependencies.discoverSessions().catch(() => []);
    session = pickSessionForRepository(analysis.repository.rootPath, sessions);
    if (!session) {
      const unplaced = sessions.filter((candidate) => !candidate.cwd).length;
      output.write(
        [
          "No agent session with events ran inside this repository.",
          `Repository: ${basename(analysis.repository.rootPath)} (${sessions.length} session${sessions.length === 1 ? "" : "s"} found on this machine, none from here).`,
          ...(unplaced > 0
            ? [
                `${unplaced} of them did not record a folder (usually OpenTelemetry traces), so they are only used when you name one with --session <id>.`,
              ]
            : []),
          "Run an agent here first, or pass a session id with --session <id>.",
          "",
        ].join("\n"),
      );
      return 1;
    }
  } else {
    session = await dependencies.findSession(recap.session).catch(() => undefined);
    if (!session) {
      output.write(`No session was found with the id "${recap.session}".\n`);
      return 1;
    }
  }

  let data: LoadedSession;
  try {
    data = await dependencies.loadSession(session);
  } catch (error) {
    output.write(
      `The ${sourceLabel(session.source)} session could not be read. ${error instanceof Error ? error.message : ""}\n`,
    );
    return 1;
  }
  // The same reconciliation the dashboard uses, so "system parts touched" matches what it shows.
  const reconciled = reconcileArchitectureExecution(
    analysis.graph,
    data.architecture,
    data.run.events,
    {
      repositoryRoot: analysis.repository.rootPath,
      ...(session.cwd ? { runtimeCwd: session.cwd } : {}),
    },
  );
  const run = { ...data.run, events: reconciled.events };
  const graph = reconciled.graph;

  if (recap.format === "md") {
    const markdown = renderRecapMarkdown(
      summarizeSession(run, graph, { anonymize: recap.anonymize }),
      { brand: recap.brand },
    );
    if (!recap.out) {
      output.write(markdown);
      return 0;
    }
    return emit(options, markdown, "Markdown summary");
  }
  if (recap.format === "svg") {
    const svg = renderRecapSvg(summarizeSession(run, graph, { anonymize: recap.anonymize }), {
      brand: recap.brand,
    });
    return emit(options, svg, "recap card");
  }
  const layout = await dependencies.layout(graph);
  const replay = renderReplayHtml(graph, layout, run, {
    anonymize: recap.anonymize,
    brand: recap.brand,
  });
  const code = await emit(options, replay.html, "interactive replay");
  if (code === 0 && replay.truncated)
    output.write(
      `Note: this session has ${replay.totalSteps} steps; the first ${replay.includedSteps} are included.\n`,
    );
  return code;
}

function emit(options: Parameters<typeof runRecap>[0], content: string, label: string) {
  return writeShareable({
    cwd: options.cwd,
    out: options.recap.out,
    defaultName: defaultNames[options.recap.format],
    content,
    label,
    force: options.recap.force,
    output: options.output,
  });
}
