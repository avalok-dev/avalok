import type { Server } from "node:http";
import { analyzeRepository, type RepositoryAnalysis } from "@visual-system/analyzer";
import {
  sarvadrikDataPaths,
  compactUserPath,
  migrateLegacyData,
  type MigrationResult,
} from "@visual-system/capabilities";
import { discoverCodexSessions } from "@visual-system/codex-adapter";
import { createCollectorServer } from "@visual-system/collector";
import { LocalRuntimeStore } from "@visual-system/telemetry-adapter";
import { launchDashboard, waitForDashboard, type DashboardHandle } from "./dashboard.ts";
import { productIdentity } from "./identity.ts";
import { cliDefaults, type CliOptions } from "./options.ts";
import { availableDashboardPort, openBrowser, resolveTarget, StartupError } from "./system.ts";

export interface SourceStatus {
  codex: { detected: boolean; count: number; warning?: string };
  claude: { detected: boolean; count: number; warning?: string };
}

export interface RunningSarvadrik {
  target: string;
  analysis: RepositoryAnalysis;
  dashboardUrl: string;
  dashboardPort: number;
  otlpUrl: string;
  dataRoot: string;
  migration: MigrationResult;
  sources: SourceStatus;
  dashboard: DashboardHandle;
  stop: () => Promise<void>;
}

export interface StartDependencies {
  analyze: typeof analyzeRepository;
  discoverCodex: typeof discoverCodexSessions;
  createCollector: typeof createCollectorServer;
  createStore: (directory: string) => LocalRuntimeStore;
  findDashboardPort: typeof availableDashboardPort;
  launchDashboard: typeof launchDashboard;
  waitForDashboard: typeof waitForDashboard;
  migrate: typeof migrateLegacyData;
}

const defaultDependencies: StartDependencies = {
  analyze: analyzeRepository,
  discoverCodex: discoverCodexSessions,
  createCollector: createCollectorServer,
  createStore: (directory) => new LocalRuntimeStore(directory),
  findDashboardPort: availableDashboardPort,
  launchDashboard,
  waitForDashboard,
  migrate: migrateLegacyData,
};

export function defaultCliDataDirectory(environment = process.env) {
  return sarvadrikDataPaths(environment).runtime;
}

async function listen(server: Server, port: number, host: string) {
  await new Promise<void>((resolveListen, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolveListen();
    });
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE")
      throw new StartupError(
        `OTLP port ${port} is already in use on ${host}.`,
        `Stop the process using port ${port} or choose another with --otlp-port.`,
      );
    throw new StartupError(
      `The OTLP receiver could not listen on ${host}:${port}: ${error.message}`,
      "Check local network permissions and try again.",
    );
  });
}

async function close(server: Server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function discoverSources(
  dependencies: StartDependencies,
  store: LocalRuntimeStore,
): Promise<SourceStatus> {
  const [codex, claude] = await Promise.allSettled([
    dependencies.discoverCodex(),
    store.list("claude"),
  ]);
  return {
    codex:
      codex.status === "fulfilled"
        ? { detected: codex.value.length > 0, count: codex.value.length }
        : { detected: false, count: 0, warning: "Codex discovery was unavailable." },
    claude:
      claude.status === "fulfilled"
        ? { detected: claude.value.length > 0, count: claude.value.length }
        : { detected: false, count: 0, warning: "Claude Code discovery was unavailable." },
  };
}

export async function startSarvadrik(
  options: CliOptions,
  configuration: {
    cwd?: string;
    environment?: NodeJS.ProcessEnv;
    dependencies?: Partial<StartDependencies>;
  } = {},
): Promise<RunningSarvadrik> {
  const dependencies = { ...defaultDependencies, ...configuration.dependencies };
  const environment = configuration.environment ?? process.env;
  const target = await resolveTarget(options.target, configuration.cwd);
  let analysis: RepositoryAnalysis;
  try {
    analysis = await dependencies.analyze(target);
  } catch (error) {
    throw new StartupError(
      `Sarvadrik could not analyze this repository. ${error instanceof Error ? error.message : "Unknown analyzer error."}`,
      "Check repository permissions and run again.",
    );
  }
  const dashboardPort = await dependencies.findDashboardPort(options.port, cliDefaults.host);
  const dataPaths = sarvadrikDataPaths(environment);
  const dataDirectory = dataPaths.runtime;
  // Safe, non-destructive copy of provisional M7.1 data; failure never blocks startup.
  const migration = await dependencies
    .migrate({ paths: dataPaths, environment })
    .catch((error: unknown) => ({
      status: "failed" as const,
      copied: 0,
      skippedExisting: 0,
      ignored: 0,
      error: error instanceof Error ? error.message : "Unknown migration error.",
    }));
  const store = dependencies.createStore(dataDirectory);
  const collector = dependencies.createCollector({ store });
  await listen(collector, options.otlpPort, cliDefaults.host);
  let dashboard: DashboardHandle | undefined;
  try {
    dashboard = dependencies.launchDashboard({
      host: cliDefaults.host,
      port: dashboardPort,
      target,
      dataDirectory,
      dataRoot: dataPaths.root,
      otlpPort: options.otlpPort,
      version: productIdentity.version,
      environment,
    });
    const dashboardUrl = `http://${cliDefaults.host}:${dashboardPort}`;
    await dependencies.waitForDashboard(dashboardUrl, dashboard);
    const sources = await discoverSources(dependencies, store);
    let stopPromise: Promise<void> | undefined;
    const stop = () => {
      stopPromise ??= Promise.allSettled([dashboard!.stop(), close(collector)]).then(() => {});
      return stopPromise;
    };
    return {
      target,
      analysis,
      dashboardUrl,
      dashboardPort,
      otlpUrl: `http://${cliDefaults.host}:${options.otlpPort}`,
      dataRoot: dataPaths.root,
      migration,
      sources,
      dashboard,
      stop,
    };
  } catch (error) {
    await Promise.allSettled([dashboard?.stop(), close(collector)]);
    throw error;
  }
}

function compactPath(path: string) {
  return compactUserPath(path);
}

export function startupSummary(running: RunningSarvadrik, requestedPort: number) {
  const technologies = running.analysis.technologies;
  const source = (label: string, detected: boolean, count: number) =>
    `  ${label.padEnd(12)}${detected ? `detected (${count})` : "not detected"}`;
  return [
    `${productIdentity.displayName} ${productIdentity.version} — ${productIdentity.tagline}`,
    "",
    "Repository",
    `  ${compactPath(running.target)}`,
    "",
    "Detected",
    ...(technologies.length > 0
      ? technologies.slice(0, 10).map((item) => `  ${item}`)
      : ["  No supported technologies detected"]),
    "",
    "Sources",
    source("Codex", running.sources.codex.detected, running.sources.codex.count),
    source("Claude Code", running.sources.claude.detected, running.sources.claude.count),
    "  OTLP        listening",
    "",
    "Dashboard",
    `  ${running.dashboardUrl}${running.dashboardPort === requestedPort ? "" : ` (port ${requestedPort} was occupied)`}`,
    "",
    "OTLP (HTTP protobuf or JSON)",
    `  ${running.otlpUrl}/v1/traces`,
    "",
    "Data",
    `  ${compactPath(running.dataRoot)}`,
    ...migrationSummary(running.migration),
    "",
    "Local only",
    "Press Ctrl+C to stop",
    "",
  ].join("\n");
}

export function migrationSummary(migration: MigrationResult) {
  const sources = migration.sources ?? [
    { label: "~/.agentmap/runtime", ...migration, settingsCopied: false },
  ];
  return sources.flatMap((source) => {
    if (source.status === "migrated")
      return [
        `  Copied ${source.copied} earlier AgentMap run${source.copied === 1 ? "" : "s"}${source.settingsCopied ? " and settings" : ""} from ${source.label} (original kept)`,
      ];
    if (source.status === "failed")
      return [
        `  Earlier AgentMap data in ${source.label} was not copied: ${source.error ?? "unknown error"}`,
        "  The original data is untouched; Sarvadrik will retry next start.",
      ];
    return [];
  });
}

export async function maybeOpenBrowser(
  running: RunningSarvadrik,
  enabled: boolean,
  opener: (url: string) => Promise<void> = openBrowser,
) {
  if (!enabled) return undefined;
  try {
    await opener(running.dashboardUrl);
    return undefined;
  } catch {
    return `Browser could not be opened. Continue at ${running.dashboardUrl}`;
  }
}
