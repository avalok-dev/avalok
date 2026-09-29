import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import manifest from "../package.json" with { type: "json" };
import product from "../product.json" with { type: "json" };
import { shutdownSignals, waitForShutdown } from "../src/bin";
import { healthy, launchDashboard, resolveDashboardLayout } from "../src/dashboard";
import { productIdentity } from "../src/identity";
import { nodeSupport, supportedNodeRange } from "../src/node-support";
import { migrationSummary, type RunningSarvadrik } from "../src/orchestrator";
import { browserCommand } from "../src/system";
import { runDoctor } from "../src/doctor";
import { legacyAgentMapDirectoryNames, platformDataRoot } from "@visual-system/telemetry-adapter";

const rootManifest = JSON.parse(
  await readFile(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
) as { engines: { node: string } };

describe("identity and version", () => {
  it("has one version source and centralized naming", () => {
    expect(productIdentity.version).toBe(manifest.version);
    expect(productIdentity.version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    expect(productIdentity.cliName).toBe(product.cliName);
    expect(productIdentity.displayName).toBe(product.displayName);
    expect(productIdentity.packageName).toBe(product.packageName);
  });

  it("keeps the Node policy aligned with package engines", () => {
    expect(supportedNodeRange).toBe(rootManifest.engines.node);
    expect(nodeSupport("24.19.0")).toBe("supported");
    expect(nodeSupport("v24.30.2")).toBe("supported");
    expect(nodeSupport("24.18.9")).toBe("unsupported");
    expect(nodeSupport("22.12.0")).toBe("unsupported");
    expect(nodeSupport("26.1.0")).toBe("untested-newer");
  });
});

describe("packaged asset resolution", () => {
  // resolve(): an absolute path on this platform (a drive letter on Windows).
  const installed = resolve("/opt/My Tools/lib/node_modules/@visual-system/sarvadrik");
  const moduleUrl = pathToFileURL(join(installed, "lib", "cli.mjs")).href;

  it("resolves the bundled dashboard and samples from the installed module, not the cwd", () => {
    const seen: string[] = [];
    const layout = resolveDashboardLayout({}, moduleUrl, (path) => {
      seen.push(path);
      return path === join(installed, "dashboard", "server.js");
    });
    expect(layout).toEqual({
      kind: "packaged",
      directory: join(installed, "dashboard"),
      samples: join(installed, "samples"),
    });
    expect(seen.every((path) => path.startsWith(installed))).toBe(true);
    expect(seen.some((path) => path.startsWith(process.cwd()))).toBe(false);
  });

  it("falls back to the contributor workspace only when no bundled dashboard exists", () => {
    const source = pathToFileURL("/work/sarvadrik/packages/cli/src/dashboard.ts").href;
    expect(resolveDashboardLayout({}, source, () => false)).toEqual({
      kind: "source",
      directory: resolve("/work/sarvadrik/apps/web"),
    });
  });

  it("honors the explicit development override", () => {
    expect(
      resolveDashboardLayout({ SARVADRIK_DASHBOARD_DIR: "/custom/dashboard" }, moduleUrl, (path) =>
        path.endsWith("server.js"),
      ),
    ).toEqual({ kind: "packaged", directory: resolve("/custom/dashboard") });
  });

  it("starts a packaged server from a spaced install path with loopback and privacy pinned", async () => {
    const root = await mkdtemp(join(tmpdir(), "sarvadrik install dir "));
    const directory = join(root, "dashboard");
    await mkdir(directory);
    await writeFile(
      join(directory, "server.js"),
      `process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd(), env: {
        HOSTNAME: process.env.HOSTNAME, PORT: process.env.PORT,
        NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED,
        NEXT_MANUAL_SIG_HANDLE: process.env.NEXT_MANUAL_SIG_HANDLE,
        SARVADRIK_TARGET_ROOT: process.env.SARVADRIK_TARGET_ROOT,
        SARVADRIK_SAMPLES_DIR: process.env.SARVADRIK_SAMPLES_DIR,
        NODE_ENV: process.env.NODE_ENV } }));`,
    );
    const handle = launchDashboard({
      directory,
      host: "127.0.0.1",
      port: 4799,
      target: "/repos/My Project",
      dataDirectory: join(root, "data", "runtime"),
      dataRoot: join(root, "data"),
      otlpPort: 4318,
      version: productIdentity.version,
      environment: { HOSTNAME: "0.0.0.0", SARVADRIK_SAMPLES_DIR: join(root, "samples") },
    });
    expect((await handle.exited).code).toBe(0);
    const reported = JSON.parse(handle.logs ?? "{}") as {
      argv: string[];
      env: Record<string, string>;
    };
    expect(reported.argv).toEqual([join(directory, "server.js")]);
    expect(reported.env).toEqual({
      HOSTNAME: "127.0.0.1",
      PORT: "4799",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_MANUAL_SIG_HANDLE: "1",
      SARVADRIK_TARGET_ROOT: "/repos/My Project",
      SARVADRIK_SAMPLES_DIR: join(root, "samples"),
      NODE_ENV: "production",
    });
  });
});

describe("platform integration", () => {
  it("opens the browser with argument arrays per platform", () => {
    const url = "http://127.0.0.1:4737";
    expect(browserCommand(url, "darwin")).toEqual({
      executable: "open",
      arguments: ["http://127.0.0.1:4737/"],
    });
    expect(browserCommand(url, "linux")).toEqual({
      executable: "xdg-open",
      arguments: ["http://127.0.0.1:4737/"],
    });
    expect(browserCommand(url, "win32")).toEqual({
      executable: "rundll32.exe",
      arguments: ["url.dll,FileProtocolHandler", "http://127.0.0.1:4737/"],
    });
  });

  it("refuses to hand anything but a loopback http URL to the platform opener", () => {
    for (const url of [
      "https://example.com",
      "http://0.0.0.0:4737",
      "file:///etc/passwd",
      "http://user:secret@127.0.0.1:4737",
      "http://127.0.0.1.example.com:4737",
    ])
      expect(() => browserCommand(url, "win32")).toThrow("non-loopback");
  });

  it("stops on SIGINT, SIGTERM, and SIGHUP (closed terminal or Windows console)", async () => {
    expect(shutdownSignals).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    for (const signal of shutdownSignals) {
      const signals = new EventEmitter();
      const stop = vi.fn(async () => {});
      const running = {
        dashboard: { exited: new Promise(() => {}) },
        stop,
      } as unknown as RunningSarvadrik;
      const waiting = waitForShutdown(running, signals, { write: () => true });
      signals.emit(signal);
      await waiting;
      expect(stop).toHaveBeenCalledOnce();
      expect(signals.listenerCount(signal)).toBe(0);
    }
  });

  it("summarizes migration outcomes without hiding the retained original", () => {
    expect(
      migrationSummary({ status: "migrated", copied: 3, skippedExisting: 0, ignored: 0 }),
    ).toEqual(["  Copied 3 earlier AgentMap runs from ~/.agentmap/runtime (original kept)"]);
    expect(
      migrationSummary({
        status: "migrated",
        copied: 2,
        skippedExisting: 0,
        ignored: 0,
        sources: [
          {
            key: "agentmap-data-root",
            label: "~/Library/Application Support/AgentMap",
            status: "migrated",
            copied: 2,
            skippedExisting: 0,
            ignored: 0,
            settingsCopied: true,
          },
          {
            key: "agentmap-home-directory",
            label: "~/.agentmap/runtime",
            status: "no-legacy-data",
            copied: 0,
            skippedExisting: 0,
            ignored: 0,
          },
        ],
      }),
    ).toEqual([
      "  Copied 2 earlier AgentMap runs and settings from ~/Library/Application Support/AgentMap (original kept)",
    ]);
    expect(
      migrationSummary({
        status: "failed",
        copied: 0,
        skippedExisting: 0,
        ignored: 0,
        error: "disk full",
      }).join("\n"),
    ).toContain("untouched");
    expect(
      migrationSummary({ status: "already-migrated", copied: 0, skippedExisting: 0, ignored: 0 }),
    ).toEqual([]);
  });
});

describe("doctor distribution checks", () => {
  it("reports install kind, protobuf support, data root, and legacy migration state", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "sarvadrik doctor "));
    const repository = join(scratch, "My Repo");
    const legacyHome = join(scratch, "home");
    const dataRoot = join(scratch, "Data Root");
    await mkdir(join(legacyHome, ".agentmap", "runtime"), { recursive: true });
    await writeFile(
      join(legacyHome, ".agentmap", "runtime", `telemetry-${"a".repeat(64)}.json`),
      "{}\n",
    );
    await mkdir(repository);
    await writeFile(join(repository, "index.ts"), "export const ok = true;\n");
    const options = {
      command: "doctor" as const,
      target: repository,
      port: 4799,
      otlpPort: 4398,
      open: false,
      help: false,
      version: false,
      yes: false,
    };
    const pending = await runDoctor(options, {
      environment: { SARVADRIK_DATA_ROOT: dataRoot, PATH: "" },
      legacyHome,
    });
    expect(pending.output).toContain("Source workspace (contributor mode)");
    expect(pending.output).toContain("OTLP/HTTP protobuf and JSON accepted");
    expect(pending.output).toContain("gRPC not supported");
    expect(pending.output).toContain("(1 runs) is not migrated while SARVADRIK_DATA_DIR is set");
    // The former AgentMap platform data root is also reported.
    const agentMapRoot = platformDataRoot(
      legacyAgentMapDirectoryNames,
      { PATH: "" },
      process.platform,
      legacyHome,
    );
    await mkdir(join(agentMapRoot, "runtime"), { recursive: true });
    await writeFile(join(agentMapRoot, "runtime", `claude-${"b".repeat(64)}.json`), "{}\n");
    const both = await runDoctor(options, {
      environment: { SARVADRIK_DATA_ROOT: dataRoot, PATH: "" },
      legacyHome,
    });
    expect(both.output.match(/is not migrated while SARVADRIK_DATA_DIR is set/g)).toHaveLength(2);
    await writeFile(
      join(dataRoot, "migration.json"),
      JSON.stringify({
        version: 2,
        sources: {
          "agentmap-home-directory": { status: "completed", copied: 1, skippedExisting: 0 },
          "agentmap-data-root": {
            status: "completed",
            copied: 1,
            skippedExisting: 0,
            settingsCopied: true,
          },
        },
      }),
    );
    const migrated = await runDoctor(options, {
      environment: { SARVADRIK_DATA_ROOT: dataRoot, PATH: "" },
      legacyHome,
    });
    expect(migrated.output).toContain("1 copied, 0 already present); original kept");
    expect(migrated.output).toContain("1 copied, 0 already present, settings copied)");
    expect(migrated.output).not.toContain("{}");
  });
});

describe("dashboard readiness probe", () => {
  it("does not leave a keep-alive socket that would delay graceful dashboard shutdown", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const { port } = server.address() as { port: number };
    expect(await healthy(`http://127.0.0.1:${port}/api/health`)).toBe(true);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    const open = await new Promise<number>((resolveCount) =>
      server.getConnections((_error, count) => resolveCount(count)),
    );
    expect(open).toBe(0);
    const started = Date.now();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await healthy(`http://127.0.0.1:${port}/api/health`, 200)).toBe(false);
  });
});

describe("dashboard shutdown", () => {
  it("stops promptly and leaves no timer keeping the CLI alive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarvadrik stop "));
    await writeFile(join(directory, "server.js"), "setInterval(() => {}, 1000);\n");
    const handle = launchDashboard({
      directory,
      host: "127.0.0.1",
      port: 4798,
      target: directory,
      dataDirectory: directory,
      dataRoot: directory,
      otlpPort: 4318,
      version: productIdentity.version,
      environment: {},
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const stopping = handle.stop();
      await vi.waitFor(
        async () => expect(handle.process.exitCode ?? handle.process.signalCode).not.toBeNull(),
        { timeout: 2_000, interval: 20 },
      );
      await stopping;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("orphan protection", () => {
  it("prefers the packaged launcher, which exits when the launching CLI disappears", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarvadrik launcher "));
    const { copyFile } = await import("node:fs/promises");
    await copyFile(
      join(import.meta.dirname, "../src/dashboard-launcher.cjs"),
      join(directory, "sarvadrik-launch.cjs"),
    );
    await writeFile(join(directory, "server.js"), "setInterval(() => {}, 1000);\n");
    const { spawn } = await import("node:child_process");
    // A stand-in "CLI" that dies immediately, leaving the dashboard's parent PID dead.
    const parent = spawn(process.execPath, ["-e", "0"]);
    await new Promise((resolveExit) => parent.once("exit", resolveExit));
    const dashboard = spawn(process.execPath, [join(directory, "sarvadrik-launch.cjs")], {
      env: { ...process.env, SARVADRIK_PARENT_PID: String(parent.pid) },
    });
    const exited = await Promise.race([
      new Promise<number | null>((resolveExit) => dashboard.once("exit", resolveExit)),
      new Promise<"timeout">((resolveTimeout) =>
        setTimeout(() => resolveTimeout("timeout"), 4_000),
      ),
    ]);
    if (exited === "timeout") dashboard.kill("SIGKILL");
    expect(exited).toBe(0);
  });
});
