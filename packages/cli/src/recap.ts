import { basename, relative, resolve } from "node:path";
import { analyzeRepository, type RepositoryAnalysis } from "@visual-system/analyzer";
import {
  discoverCodexSessions,
  loadCodexSession,
  resolveSessionById,
  type CodexSessionData,
  type CodexSessionSummary,
} from "@visual-system/codex-adapter";
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

// `avalok recap`: a summary of the newest agent session that ran in this repository, from local
// files only. The default output is Markdown on stdout (paste it into a pull request). svg, html and
// diagram are written to a file the user names (or avalok-recap.<ext> in the current directory) and
// never overwrite an existing file without --force. Nothing is uploaded.

export interface RecapDependencies {
  analyze: (target: string) => Promise<RepositoryAnalysis>;
  discoverSessions: () => Promise<CodexSessionSummary[]>;
  findSession: (id: string) => Promise<CodexSessionSummary | undefined>;
  loadSession: (session: CodexSessionSummary) => Promise<CodexSessionData>;
  layout: (graph: ArchitectureGraph) => ReturnType<ElkLayoutEngine["layout"]>;
}

const defaultDependencies: RecapDependencies = {
  analyze: (target) => analyzeRepository(target),
  discoverSessions: () => discoverCodexSessions(),
  findSession: (id) => resolveSessionById(id),
  loadSession: loadCodexSession,
  layout: (graph) => new ElkLayoutEngine().layout(graph),
};

const defaultNames = {
  md: "avalok-recap.md",
  svg: "avalok-recap.svg",
  html: "avalok-replay.html",
  diagram: "avalok-diagram.svg",
} as const;

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
      const inside = relative(analysis.repository.rootPath, written);
      if (inside && !inside.startsWith("..") && !inside.startsWith("/"))
        output.write(
          `To show it in your README:\n  ![Architecture](${inside.replaceAll("\\", "/")})\n`,
        );
    }
    return code;
  }

  let session: CodexSessionSummary | undefined;
  if (recap.session === "latest") {
    const sessions = await dependencies.discoverSessions().catch(() => []);
    session = pickSessionForRepository(analysis.repository.rootPath, sessions);
    if (!session) {
      output.write(
        [
          "No Codex session with events ran inside this repository.",
          `Repository: ${basename(analysis.repository.rootPath)} (${sessions.length} Codex session${sessions.length === 1 ? "" : "s"} found on this machine, none from here).`,
          "Run an agent here first, or pass a session id with --session <id>.",
          "",
        ].join("\n"),
      );
      return 1;
    }
  } else {
    session = await dependencies.findSession(recap.session).catch(() => undefined);
    if (!session) {
      output.write(`No Codex session was found with the id "${recap.session}".\n`);
      return 1;
    }
  }

  const data = await dependencies.loadSession(session);
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
