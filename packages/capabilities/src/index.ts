import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, posix, resolve, sep, win32 } from "node:path";
import type { RepositoryAnalysis } from "@visual-system/analyzer";
import { discoverCodexSessions } from "@visual-system/codex-adapter";
import { defaultAgentMapDataRoot, LocalRuntimeStore } from "@visual-system/telemetry-adapter";

export * from "./migration.ts";

export type SupportLevel = "supported" | "inventory-only";
export type AvailabilityState = "available" | "not-detected" | "error";
export type ConnectionState = "ready" | "listening" | "not-configured" | "unavailable";
export type ObservationState = "observed" | "waiting";

export interface RepositoryCapability {
  id: string;
  label: string;
  area: "language" | "architecture" | "infrastructure";
  support: SupportLevel;
  detected: boolean;
  detail: string;
  count?: number;
}

export interface RuntimeSourceCapability {
  id: "codex" | "claude" | "telemetry" | "openinference";
  label: string;
  support: "supported";
  availability: AvailabilityState;
  connection: ConnectionState;
  observation: ObservationState;
  count: number;
  detail: string;
  latestActivity?: string;
  error?: string;
}

export interface CapabilityReport {
  version: string;
  repository: {
    name: string;
    files: number;
    entities: number;
    services: number;
    databases: number;
    externalIntegrations: number;
    partial: boolean;
  };
  capabilities: RepositoryCapability[];
  sources: RuntimeSourceCapability[];
  telemetry: {
    endpoint: string;
    protocol: "OTLP/HTTP protobuf + JSON";
    spansReceived: number;
    lastActivity?: string;
  };
  dataPath: string;
}

export interface AgentMapDataPaths {
  root: string;
  runtime: string;
  settings: string;
}

export function agentMapDataPaths(
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
): AgentMapDataPaths {
  const root = defaultAgentMapDataRoot(environment, platform, home);
  // Explicit branches (not a conditional function value): Next's build-time file tracer
  // statically evaluates path calls and cannot evaluate `(a ? win32.join : posix.join)(...)`.
  if (platform === "win32")
    return {
      root,
      runtime: win32.join(root, "runtime"),
      settings: win32.join(root, "settings.json"),
    };
  return {
    root,
    runtime: posix.join(root, "runtime"),
    settings: posix.join(root, "settings.json"),
  };
}

export function compactUserPath(path: string, home = homedir()) {
  return path === home
    ? "~"
    : path.startsWith(`${home}${sep}`)
      ? `~${sep}${path.slice(home.length + 1)}`
      : path;
}

export interface AgentMapSettings {
  gettingStartedDismissed: boolean;
}

export async function readAgentMapSettings(paths = agentMapDataPaths()): Promise<AgentMapSettings> {
  try {
    const value = JSON.parse(await readFile(paths.settings, "utf8")) as Partial<AgentMapSettings>;
    return { gettingStartedDismissed: value.gettingStartedDismissed === true };
  } catch {
    return { gettingStartedDismissed: false };
  }
}

export async function writeAgentMapSettings(
  settings: AgentMapSettings,
  paths = agentMapDataPaths(),
) {
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.settings, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

function safeOwnedPath(path: string, paths: AgentMapDataPaths) {
  const normalized = resolve(path);
  const root = resolve(paths.root);
  return normalized !== root && normalized.startsWith(`${root}${sep}`) && root !== parse(root).root;
}

// `home` is a parameter (not an inline `homedir()` call) on purpose: Next's build-time file
// tracer evaluates inline `os.homedir()` paths and, on Windows when the checkout is on another
// drive, then globs the whole home directory. See docs/development/release-build.md.
export async function clearAgentMapData(paths = agentMapDataPaths(), home = homedir()) {
  const root = resolve(paths.root);
  if (
    root === resolve(home) ||
    root === resolve(process.cwd()) ||
    !safeOwnedPath(paths.runtime, paths) ||
    !safeOwnedPath(paths.settings, paths)
  )
    throw new Error("Refusing to clear data outside the AgentMap data directory.");
  await Promise.all([
    rm(paths.runtime, { recursive: true, force: true }),
    rm(paths.settings, { force: true }),
  ]);
}

const labelForLanguage = (language: string) =>
  ({
    typescript: "TypeScript",
    javascript: "JavaScript",
    python: "Python",
    go: "Go",
    java: "Java",
    kotlin: "Kotlin",
    rust: "Rust",
    ruby: "Ruby",
    php: "PHP",
    csharp: "C#",
    swift: "Swift",
    c: "C",
    cpp: "C++",
    json: "JSON",
    yaml: "YAML",
    dockerfile: "Dockerfile",
    terraform: "Terraform",
  })[language] ?? language;

export function repositoryCapabilities(analysis: RepositoryAnalysis): RepositoryCapability[] {
  const languages = analysis.summary.languages.map((language) => ({
    id: `language:${language.language}`,
    label: labelForLanguage(language.language),
    area: "language" as const,
    support: language.analysis,
    detected: true,
    detail:
      language.analysis === "supported"
        ? "Static architecture supported"
        : "Detected only; static architecture analysis is not supported yet",
    count: language.files,
  }));
  const hasTechnology = (pattern: RegExp) =>
    analysis.technologies.some((item) => pattern.test(item));
  const infrastructure: RepositoryCapability[] = [
    {
      id: "docker",
      label: "Docker",
      detected: analysis.metrics.dockerfilesParsed > 0,
      count: analysis.metrics.dockerfilesParsed,
      detail: "Configured container architecture",
      area: "architecture",
      support: "supported",
    },
    {
      id: "compose",
      label: "Compose",
      detected: analysis.metrics.composeServices > 0,
      count: analysis.metrics.composeServices,
      detail: "Configured service architecture",
      area: "architecture",
      support: "supported",
    },
    {
      id: "terraform",
      label: "Terraform",
      detected: analysis.metrics.terraformFiles > 0,
      count: analysis.metrics.terraformFiles,
      detail: "Configured infrastructure architecture",
      area: "infrastructure",
      support: "supported",
    },
    {
      id: "kubernetes",
      label: "Kubernetes",
      detected: analysis.metrics.kubernetesDocuments > 0,
      count: analysis.metrics.kubernetesDocuments,
      detail: "Configured manifest architecture; no live cluster connection",
      area: "infrastructure",
      support: "supported",
    },
    {
      id: "helm",
      label: "Helm",
      detected: analysis.metrics.helmCharts > 0,
      count: analysis.metrics.helmCharts,
      detail: "Configured chart architecture; no live cluster connection",
      area: "infrastructure",
      support: "supported",
    },
    {
      id: "aws",
      label: "AWS",
      detected:
        hasTechnology(/aws/i) ||
        analysis.graph.entities.some(
          (entity) =>
            entity.metadata?.architecture &&
            (entity.metadata.architecture as { platform?: string }).platform === "aws",
        ),
      detail: "Inferred from repository configuration; no AWS account connection",
      area: "infrastructure",
      support: "supported",
    },
  ];
  return [...languages, ...infrastructure.filter((item) => item.detected)];
}

interface CollectorHealth {
  status?: string;
  diagnostics?: { spansReceived?: number; lastReceivedAt?: string };
}

/** Candidate executable paths for a PATH lookup, using the target platform's rules. */
export function executableCandidates(
  name: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
) {
  const windows = platform === "win32";
  const pathValue = environment.PATH ?? environment.Path ?? "";
  const extensions = windows
    ? ["", ...(environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)]
    : [""];
  return pathValue
    .split(windows ? ";" : ":")
    .filter(Boolean)
    .flatMap((directory) =>
      extensions.map((extension) =>
        windows
          ? win32.join(directory, `${name}${extension}`)
          : posix.join(directory, `${name}${extension}`),
      ),
    );
}

/** Cross-platform PATH lookup without spawning a shell or `which`/`where`. */
export async function executableAvailable(
  name: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
) {
  for (const candidate of executableCandidates(name, environment, platform)) {
    try {
      // X_OK is meaningless on Windows; existence plus a PATHEXT extension is the rule there.
      await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      // Keep looking.
    }
  }
  return false;
}

function hasClaudeHook(value: unknown): boolean {
  if (typeof value === "string") return value.includes("/v1/claude/hooks");
  if (Array.isArray(value)) return value.some(hasClaudeHook);
  return Boolean(value && typeof value === "object" && Object.values(value).some(hasClaudeHook));
}

async function claudeState(target: string, environment: NodeJS.ProcessEnv) {
  const home = environment.HOME ?? homedir();
  const directory = join(home, ".claude");
  let available = await executableAvailable("claude", environment);
  try {
    await access(directory, constants.R_OK);
    available = true;
  } catch {
    // Claude may still be available on PATH.
  }
  let configured = false;
  let configurationError: string | undefined;
  // Segments rather than an array of joined paths: the build-time tracer turns an array literal
  // of computed paths into repository-wide globs for these file names.
  const candidates = [
    [directory, "settings.json"],
    [target, ".claude", "settings.json"],
    [target, ".claude", "settings.local.json"],
  ];
  for (const segments of candidates) {
    const file = join(...segments);
    try {
      configured ||= hasClaudeHook(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        configurationError = "Claude settings could not be read.";
    }
  }
  return { available, configured, configurationError };
}

export async function buildCapabilityReport(options: {
  analysis: RepositoryAnalysis;
  target: string;
  endpoint: string;
  dataPaths?: AgentMapDataPaths;
  environment?: NodeJS.ProcessEnv;
  fetchHealth?: (url: string) => Promise<CollectorHealth>;
  version?: string;
}): Promise<CapabilityReport> {
  const environment = options.environment ?? process.env;
  const dataPaths = options.dataPaths ?? agentMapDataPaths(environment);
  const store = new LocalRuntimeStore(dataPaths.runtime);
  let codexAvailability: AvailabilityState = "not-detected";
  let codexError: string | undefined;
  let codexSessions: Awaited<ReturnType<typeof discoverCodexSessions>> = [];
  try {
    const directory = join(
      environment.AI_VISUALIZER_CODEX_HOME ??
        environment.CODEX_HOME ??
        join(environment.HOME ?? homedir(), ".codex"),
      "sessions",
    );
    try {
      await access(directory, constants.R_OK);
      codexAvailability = "available";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (await executableAvailable("codex", environment)) codexAvailability = "available";
    }
    codexSessions = await discoverCodexSessions(directory);
  } catch {
    codexAvailability = "error";
    codexError = "Codex sessions could not be read.";
  }
  const [claude, runtimeRuns] = await Promise.all([
    claudeState(options.target, environment),
    store.list(),
  ]);
  const telemetryRuns = runtimeRuns.filter((run) => run.source === "telemetry");
  const claudeRuns = runtimeRuns.filter((run) => run.source === "claude");
  let health: CollectorHealth | undefined;
  let telemetryError: string | undefined;
  try {
    health = options.fetchHealth
      ? await options.fetchHealth(`${options.endpoint}/health`)
      : ((await (
          await fetch(`${options.endpoint}/health`, { signal: AbortSignal.timeout(750) })
        ).json()) as CollectorHealth);
  } catch {
    telemetryError = "The OTLP receiver is not reachable.";
  }
  const spansReceived = health?.diagnostics?.spansReceived ?? 0;
  const latest = (items: Array<{ modifiedAt: string }>) => items[0]?.modifiedAt;
  const sources: RuntimeSourceCapability[] = [
    {
      id: "codex",
      label: "Codex",
      support: "supported",
      availability: codexAvailability,
      connection: codexAvailability === "available" ? "ready" : "unavailable",
      observation: codexSessions.length > 0 ? "observed" : "waiting",
      count: codexSessions.length,
      detail:
        codexAvailability === "error"
          ? "Session directory unreadable"
          : codexSessions.length > 0
            ? `${codexSessions.length} local session${codexSessions.length === 1 ? "" : "s"} available`
            : codexAvailability === "available"
              ? "Available; no local sessions found"
              : "Not detected; AgentMap is still usable",
      ...(codexSessions[0]?.modifiedAt ? { latestActivity: codexSessions[0].modifiedAt } : {}),
      ...(codexError ? { error: codexError } : {}),
    },
    {
      id: "claude",
      label: "Claude Code",
      support: "supported",
      availability: claude.configurationError
        ? "error"
        : claude.available
          ? "available"
          : "not-detected",
      connection:
        claude.configured && health?.status === "ok"
          ? "listening"
          : claude.available && !claude.configured
            ? "not-configured"
            : "unavailable",
      observation: claudeRuns.length > 0 ? "observed" : "waiting",
      count: claudeRuns.length,
      detail:
        claude.configurationError ??
        (claudeRuns.length > 0
          ? `${claudeRuns.length} observed local run${claudeRuns.length === 1 ? "" : "s"}`
          : claude.configured && health?.status === "ok"
            ? "Local observation hook configured; waiting for activity"
            : claude.configured
              ? "Observation hook configured, but the local listener is unavailable"
              : claude.available
                ? "Available; local observation hook is not configured"
                : "Not detected; no configuration was changed"),
      ...(latest(claudeRuns) ? { latestActivity: latest(claudeRuns)! } : {}),
      ...(claude.configurationError ? { error: claude.configurationError } : {}),
    },
    {
      id: "telemetry",
      label: "OpenTelemetry",
      support: "supported",
      availability: health?.status === "ok" ? "available" : "error",
      connection: health?.status === "ok" ? "listening" : "unavailable",
      observation: spansReceived > 0 || telemetryRuns.length > 0 ? "observed" : "waiting",
      count: spansReceived,
      detail:
        health?.status === "ok"
          ? spansReceived > 0
            ? `${spansReceived} spans received`
            : "Listening; waiting for your application"
          : "Receiver unavailable",
      ...(health?.diagnostics?.lastReceivedAt
        ? { latestActivity: health.diagnostics.lastReceivedAt }
        : {}),
      ...(telemetryError ? { error: telemetryError } : {}),
    },
    {
      id: "openinference",
      label: "OpenInference",
      support: "supported",
      availability: health?.status === "ok" ? "available" : "error",
      connection: health?.status === "ok" ? "listening" : "unavailable",
      observation: telemetryRuns.length > 0 ? "observed" : "waiting",
      count: telemetryRuns.length,
      detail: "Supported semantic normalization over OTLP/HTTP (protobuf or JSON)",
      ...(latest(telemetryRuns) ? { latestActivity: latest(telemetryRuns)! } : {}),
    },
  ];
  return {
    version: options.version ?? "development",
    repository: {
      name: options.analysis.repository.name,
      files: options.analysis.summary.filesAnalyzed,
      entities: options.analysis.metrics.architectureEntities,
      services: options.analysis.summary.services,
      databases: options.analysis.summary.databases,
      externalIntegrations: options.analysis.summary.externalIntegrations,
      partial: options.analysis.partial,
    },
    capabilities: repositoryCapabilities(options.analysis),
    sources,
    telemetry: {
      endpoint: `${options.endpoint}/v1/traces`,
      protocol: "OTLP/HTTP protobuf + JSON",
      spansReceived,
      ...(health?.diagnostics?.lastReceivedAt
        ? { lastActivity: health.diagnostics.lastReceivedAt }
        : {}),
    },
    dataPath: compactUserPath(dataPaths.root),
  };
}

export async function checkDataDirectoryWritable(paths = agentMapDataPaths()) {
  const token = `.doctor-${process.pid}-${Date.now()}`;
  const target = join(paths.root, token);
  try {
    await mkdir(paths.root, { recursive: true });
    await writeFile(target, "AgentMap doctor write probe\n", { mode: 0o600 });
    await rm(target, { force: true });
    return true;
  } catch {
    await rm(target, { force: true }).catch(() => {});
    return false;
  }
}

export async function listAgentMapData(paths = agentMapDataPaths()) {
  try {
    return await readdir(paths.root);
  } catch {
    return [];
  }
}
