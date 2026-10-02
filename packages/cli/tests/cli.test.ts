import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { PassThrough, Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardHandle } from "../src/dashboard";
import { runCli, waitForShutdown } from "../src/bin";
import { productIdentity } from "../src/identity";
import { cliDefaults, parseCliOptions, type CliOptions } from "../src/options";
import { maybeOpenBrowser, startSarvadrik, type RunningSarvadrik } from "../src/orchestrator";
import { availableDashboardPort, isPortAvailable, resolveTarget } from "../src/system";
import { dataPath, runDataClear } from "../src/data";
import { runDoctor } from "../src/doctor";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose) => {
          server.closeAllConnections();
          server.close(() => resolveClose());
        }),
    ),
  );
});

async function temporaryRepository() {
  const directory = await mkdtemp(join(tmpdir(), "sarvadrik-cli-target-"));
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "external-test-repository", dependencies: { next: "15.0.0" } }),
  );
  await writeFile(join(directory, "index.ts"), "export const answer = 42;\n");
  return realpath(directory);
}

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, cliDefaults.host, resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  const port = address.port;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

function fakeDashboard(stop = vi.fn(async () => {})): DashboardHandle {
  return {
    process: {} as ChildProcess,
    exited: new Promise(() => {}),
    stop,
  };
}

const options = (overrides: Partial<CliOptions> = {}): CliOptions => ({
  command: "start",
  port: cliDefaults.dashboardPort,
  otlpPort: cliDefaults.otlpPort,
  open: false,
  help: false,
  version: false,
  yes: false,
  ...overrides,
});

describe("CLI options", () => {
  it("uses cwd semantics by default and parses the minimal option surface", () => {
    expect(parseCliOptions([])).toMatchObject({
      port: 4737,
      otlpPort: 4318,
      open: true,
    });
    expect(
      parseCliOptions(["../project", "--port", "4800", "--otlp-port=4400", "--no-open"]),
    ).toMatchObject({ target: "../project", port: 4800, otlpPort: 4400, open: false });
    expect(parseCliOptions(["doctor", "../project"])).toMatchObject({
      command: "doctor",
      target: "../project",
    });
    expect(parseCliOptions(["data", "path"])).toMatchObject({ command: "data-path" });
    expect(parseCliOptions(["data", "clear", "--yes"])).toMatchObject({
      command: "data-clear",
      yes: true,
    });
    expect(parseCliOptions(["import", "openai", "page-1.json", "page-2.json"])).toMatchObject({
      command: "import-openai",
      files: ["page-1.json", "page-2.json"],
    });
  });

  it("prints help and the package version without starting services", async () => {
    let output = "";
    const writer = { write: (value: string | Uint8Array) => ((output += value.toString()), true) };
    expect(await runCli(["--help"], writer, writer)).toBe(0);
    expect(output).toContain("Usage:\n  sarvadrik [path] [options]");
    expect(output).toContain("sarvadrik import openai <page.json>");
    output = "";
    expect(await runCli(["--version"], writer, writer)).toBe(0);
    expect(output.trim()).toBe(productIdentity.version);
  });

  it("rejects invalid arguments with concise usage errors", () => {
    expect(() => parseCliOptions(["--port", "nope"])).toThrow("requires a TCP port");
    expect(() => parseCliOptions(["one", "two"])).toThrow("Only one repository path");
    expect(() => parseCliOptions(["--unknown"])).toThrow("Unknown option");
    expect(() => parseCliOptions(["import", "openai"])).toThrow("saved OpenAI trace page");
  });
});

describe("doctor and local data commands", () => {
  it("reports a usable repository without leaking environment secrets", async () => {
    const repository = await temporaryRepository();
    const root = await mkdtemp(join(tmpdir(), "sarvadrik-doctor-data-"));
    const [port, otlpPort] = await Promise.all([unusedPort(), unusedPort()]);
    const result = await runDoctor(
      options({ command: "doctor", target: repository, port, otlpPort }),
      {
        environment: {
          SARVADRIK_DATA_DIR: root,
          HOME: root,
          PATH: "",
          SECRET_TOKEN: "must-not-appear",
          AI_VISUALIZER_CODEX_HOME: join(root, "codex"),
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Result\nReady");
    expect(result.output).not.toContain("must-not-appear");
    expect(result.output).not.toContain(repository);
  });

  it("uses a non-zero exit result for an OTLP port conflict", async () => {
    const repository = await temporaryRepository();
    const occupied = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    servers.push(occupied);
    await new Promise<void>((resolveListen) => occupied.listen(0, cliDefaults.host, resolveListen));
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
    const root = await mkdtemp(join(tmpdir(), "sarvadrik-doctor-conflict-"));
    const result = await runDoctor(
      options({ command: "doctor", target: repository, otlpPort: address.port }),
      {
        environment: {
          SARVADRIK_DATA_DIR: root,
          HOME: root,
          PATH: "",
          AI_VISUALIZER_CODEX_HOME: join(root, "codex"),
        },
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(`OTLP port ${address.port} is occupied`);
  });

  it("reports an unreadable target as blocking", async () => {
    const result = await runDoctor(
      options({ command: "doctor", target: join(tmpdir(), "missing-sarvadrik-target") }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("does not exist");
  });

  it("cancels data clearing without changing Sarvadrik files", async () => {
    const root = await mkdtemp(join(tmpdir(), "sarvadrik-data-cancel-"));
    const environment = { SARVADRIK_DATA_DIR: root };
    const paths = dataPath(environment);
    await mkdir(paths.runtime, { recursive: true });
    const run = join(paths.runtime, "run.json");
    await writeFile(run, "keep\n");
    const result = await runDataClear({
      yes: false,
      environment,
      input: Readable.from(["n\n"]),
      output: new PassThrough(),
    });
    expect(result.cleared).toBe(false);
    expect(await readFile(run, "utf8")).toBe("keep\n");
  });

  it("clears confirmed Sarvadrik data without touching repository or agent storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "sarvadrik-data-confirm-"));
    const repository = await temporaryRepository();
    const agentStorage = await mkdtemp(join(tmpdir(), "sarvadrik-agent-storage-"));
    const environment = { SARVADRIK_DATA_DIR: root };
    const paths = dataPath(environment);
    await mkdir(paths.runtime, { recursive: true });
    await writeFile(join(paths.runtime, "run.json"), "remove\n");
    await writeFile(paths.settings, "{}\n");
    await writeFile(join(agentStorage, "session.jsonl"), "keep\n");
    const result = await runDataClear({ yes: true, environment });
    expect(result.cleared).toBe(true);
    expect(await readFile(join(repository, "index.ts"), "utf8")).toContain("answer");
    expect(await readFile(join(agentStorage, "session.jsonl"), "utf8")).toBe("keep\n");
  });
});

describe("repository targets", () => {
  it("resolves the current directory and explicit targets", async () => {
    const repository = await temporaryRepository();
    expect(await resolveTarget(undefined, repository)).toBe(repository);
    expect(await resolveTarget(".", repository)).toBe(repository);
    expect(await resolveTarget(repository, tmpdir())).toBe(repository);
  });

  it("rejects missing paths, files, and the filesystem root", async () => {
    const repository = await temporaryRepository();
    await expect(resolveTarget(join(repository, "missing"))).rejects.toThrow("does not exist");
    await expect(resolveTarget(join(repository, "index.ts"))).rejects.toThrow(
      "must be a directory",
    );
    await expect(resolveTarget("/")).rejects.toThrow("too broad");
  });
});

describe("ports and orchestration", () => {
  it("falls forward when the requested dashboard port is occupied", async () => {
    const occupied = createServer();
    servers.push(occupied);
    await new Promise<void>((resolveListen) => occupied.listen(0, cliDefaults.host, resolveListen));
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
    const selected = await availableDashboardPort(address.port, cliDefaults.host);
    expect(selected).toBeGreaterThan(address.port);
  });

  it("analyzes the requested target, starts loopback OTLP, and keeps discovery failures non-fatal", async () => {
    const repository = await temporaryRepository();
    const dataDirectory = await mkdtemp(join(tmpdir(), "sarvadrik-cli-data-"));
    const [dashboardPort, otlpPort] = await Promise.all([unusedPort(), unusedPort()]);
    const running = await startSarvadrik(
      options({ target: repository, port: dashboardPort, otlpPort }),
      {
        environment: { SARVADRIK_DATA_DIR: dataDirectory },
        dependencies: {
          discoverCodex: async () => {
            throw new Error("not available");
          },
          launchDashboard: () => fakeDashboard(),
          waitForDashboard: async () => {},
        },
      },
    );
    expect(running.target).toBe(repository);
    expect(running.analysis.repository.rootPath).toBe(repository);
    expect(running.sources.codex.warning).toContain("unavailable");
    expect(running.otlpUrl).toBe(`http://${cliDefaults.host}:${otlpPort}`);
    expect((await fetch(`${running.otlpUrl}/health`)).status).toBe(200);
    await running.stop();
    expect(await isPortAvailable(otlpPort, cliDefaults.host)).toBe(true);
  });

  it("reports an occupied OTLP port without launching the dashboard", async () => {
    const repository = await temporaryRepository();
    const occupied = createServer();
    servers.push(occupied);
    await new Promise<void>((resolveListen) => occupied.listen(0, cliDefaults.host, resolveListen));
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
    const launch = vi.fn(() => fakeDashboard());
    await expect(
      startSarvadrik(options({ target: repository, otlpPort: address.port }), {
        dependencies: { launchDashboard: launch },
      }),
    ).rejects.toThrow(`OTLP port ${address.port} is already in use`);
    expect(launch).not.toHaveBeenCalled();
  });

  it("treats browser-opening failure as a warning", async () => {
    const warning = await maybeOpenBrowser(
      { dashboardUrl: "http://127.0.0.1:4737" } as RunningSarvadrik,
      true,
      async () => {
        throw new Error("headless");
      },
    );
    expect(warning).toContain("Browser could not be opened");
  });

  it("stops managed services on SIGINT", async () => {
    const signals = new EventEmitter();
    const stop = vi.fn(async () => {});
    const running = {
      dashboard: fakeDashboard(),
      stop,
    } as unknown as RunningSarvadrik;
    const output = { write: vi.fn(() => true) };
    const waiting = waitForShutdown(running, signals, output);
    signals.emit("SIGINT");
    await waiting;
    expect(stop).toHaveBeenCalledOnce();
    expect(output.write).toHaveBeenCalledWith("\nStopping Sarvadrik...\n");
  });
});
