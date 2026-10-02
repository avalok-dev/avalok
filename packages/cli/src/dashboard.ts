import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { get } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StartupError } from "./system.ts";

export interface DashboardHandle {
  process: ChildProcess;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly logs?: string;
  stop: () => Promise<void>;
}

export interface DashboardLayout {
  /** `packaged`: a Next.js standalone server shipped inside the installed package. */
  kind: "packaged" | "source";
  directory: string;
  samples?: string;
}

/**
 * Resolves dashboard assets relative to this module's installed location, never the
 * working directory or target repository. The bundled CLI lives at `<package>/lib/cli.mjs`
 * beside `<package>/dashboard/server.js`; source development uses the workspace `apps/web`.
 */
export function resolveDashboardLayout(
  environment: NodeJS.ProcessEnv = process.env,
  moduleUrl = import.meta.url,
  exists: (path: string) => boolean = existsSync,
): DashboardLayout {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  if (environment.AVALOK_DASHBOARD_DIR) {
    const directory = resolve(environment.AVALOK_DASHBOARD_DIR);
    return { kind: exists(join(directory, "server.js")) ? "packaged" : "source", directory };
  }
  const installRoot = resolve(moduleDirectory, "..");
  const packaged = join(installRoot, "dashboard");
  if (exists(join(packaged, "server.js")))
    return { kind: "packaged", directory: packaged, samples: join(installRoot, "samples") };
  return { kind: "source", directory: resolve(moduleDirectory, "../../../apps/web") };
}

export function dashboardDirectory(environment = process.env) {
  return resolveDashboardLayout(environment).directory;
}

function boundedLog(current: string, chunk: Buffer | string) {
  return `${current}${chunk.toString()}`.slice(-8_000);
}

export function launchDashboard(options: {
  directory?: string;
  host: string;
  port: number;
  target: string;
  dataDirectory: string;
  dataRoot: string;
  otlpPort: number;
  version: string;
  environment?: NodeJS.ProcessEnv;
}): DashboardHandle {
  const layout = options.directory
    ? resolveDashboardLayout({ ...options.environment, AVALOK_DASHBOARD_DIR: options.directory })
    : resolveDashboardLayout(options.environment);
  const { directory } = layout;
  const marker = layout.kind === "packaged" ? "server.js" : "package.json";
  if (!existsSync(join(directory, marker)))
    throw new StartupError(
      `Dashboard assets were not found at ${directory}.`,
      layout.kind === "packaged"
        ? "Reinstall Avalok; the installed package is incomplete."
        : "Set AVALOK_DASHBOARD_DIR to the Avalok web application directory.",
    );
  const requestedMode = options.environment?.AVALOK_DASHBOARD_MODE;
  const mode =
    layout.kind === "packaged"
      ? "start"
      : requestedMode === "dev" || requestedMode === "start"
        ? requestedMode
        : existsSync(join(directory, ".next", "BUILD_ID"))
          ? "start"
          : "dev";
  // Argument arrays only: no shell, and no user-controlled path is ever interpolated into a command.
  const launcher = join(directory, "avalok-launch.cjs");
  const argumentsForMode =
    layout.kind === "packaged"
      ? [existsSync(launcher) ? launcher : join(directory, "server.js")]
      : [
          createRequire(import.meta.url).resolve("next/dist/bin/next"),
          mode,
          "-H",
          options.host,
          "-p",
          String(options.port),
        ];
  const samples = layout.samples ?? options.environment?.AVALOK_SAMPLES_DIR;
  const child = spawn(process.execPath, argumentsForMode, {
    cwd: directory,
    env: {
      ...process.env,
      ...options.environment,
      AVALOK_CLI_MODE: "1",
      AVALOK_TARGET_ROOT: options.target,
      AVALOK_DATA_DIR: options.dataDirectory,
      AVALOK_DATA_ROOT: options.dataRoot,
      AVALOK_OTLP_PORT: String(options.otlpPort),
      AVALOK_VERSION: options.version,
      AVALOK_PARENT_PID: String(process.pid),
      ...(samples ? { AVALOK_SAMPLES_DIR: samples } : {}),
      // The standalone server reads HOSTNAME/PORT. Shells commonly export HOSTNAME as the
      // machine name, so always pin the loopback host explicitly.
      HOSTNAME: options.host,
      PORT: String(options.port),
      // The dashboard's Host/Origin guard validates requests against this exact port.
      AVALOK_DASHBOARD_PORT: String(options.port),
      NEXT_TELEMETRY_DISABLED: "1",
      // Next's graceful close waits for open live-update streams (an open Live tab), which
      // stalls Ctrl+C until the SIGKILL fallback. The dashboard holds no state that needs
      // flushing (the collector in this process owns persistence), so let SIGTERM end it
      // immediately — matching Windows, where child termination is always immediate.
      ...(layout.kind === "packaged" ? { NEXT_MANUAL_SIG_HANDLE: "1" } : {}),
      NODE_ENV: mode === "start" ? "production" : "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    log = boundedLog(log, chunk);
    if (options.environment?.AVALOK_DEBUG === "1") process.stderr.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    log = boundedLog(log, chunk);
    if (options.environment?.AVALOK_DEBUG === "1") process.stderr.write(chunk);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit) => {
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    },
  );
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    let fallback: NodeJS.Timeout | undefined;
    const stopped = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolveTimeout) => {
        fallback = setTimeout(() => resolveTimeout(false), 5_000);
      }),
    ]);
    // A pending fallback timer would keep the CLI alive for its full duration after shutdown.
    clearTimeout(fallback);
    if (!stopped && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  };
  child.once("error", (error) => {
    log = boundedLog(log, error.message);
  });
  return {
    process: child,
    exited,
    stop,
    get logs() {
      return log;
    },
  };
}

/**
 * One readiness probe without HTTP keep-alive. A pooled `fetch` socket would stay open to the
 * dashboard, and Next's graceful shutdown waits for open connections before exiting.
 */
export function healthy(url: string, timeoutMs = 1_000) {
  return new Promise<boolean>((resolveProbe) => {
    const request = get(url, { agent: false, headers: { Connection: "close" } }, (response) => {
      response.resume();
      resolveProbe(response.statusCode === 200);
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.once("error", () => resolveProbe(false));
  });
}

export async function waitForDashboard(
  url: string,
  dashboard: DashboardHandle,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  void dashboard.exited.then((result) => {
    exited = result;
  });
  while (Date.now() < deadline) {
    if (exited) {
      const detail = dashboard.logs?.trim();
      throw new StartupError(
        `Dashboard stopped during startup${exited.code === null ? "" : ` (exit ${exited.code})`}.${detail ? ` ${detail.split("\n").at(-1)}` : ""}`,
        "Run the Avalok build, then try again.",
      );
    }
    if (await healthy(`${url}/api/health`)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new StartupError(
    `Dashboard did not become ready within ${Math.round(timeoutMs / 1_000)} seconds.`,
    "Check the dashboard build and retry.",
  );
}
