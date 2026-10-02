import { type ChildProcess } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DashboardHandle } from "../src/dashboard";
import { cliDefaults } from "../src/options";
import { startAvalok } from "../src/orchestrator";
import { isPortAvailable } from "../src/system";
import { avalokDataPaths, buildCapabilityReport } from "@visual-system/capabilities";
import { runDoctor } from "../src/doctor";

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, cliDefaults.host, resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  const port = address.port;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

describe("M7.2 product flow integration", () => {
  it("takes a temporary repository from CLI startup through waiting, synthetic observation, doctor, and shutdown", async () => {
    const repository = await realpath(
      await mkdtemp(join(tmpdir(), "avalok-cli-integration-target-")),
    );
    const dataDirectory = await mkdtemp(join(tmpdir(), "avalok-cli-integration-data-"));
    await writeFile(
      join(repository, "package.json"),
      JSON.stringify({ name: "outside-workspace" }),
    );
    await writeFile(join(repository, "server.ts"), "export function handler() { return 'ok'; }\n");
    const [dashboardPort, otlpPort] = await Promise.all([unusedPort(), unusedPort()]);
    let dashboardServer: Server | undefined;

    const running = await startAvalok(
      {
        command: "start",
        target: repository,
        port: dashboardPort,
        otlpPort,
        open: false,
        help: false,
        version: false,
        yes: false,
      },
      {
        environment: { AVALOK_DATA_DIR: dataDirectory },
        dependencies: {
          launchDashboard: ({ host, port }): DashboardHandle => {
            dashboardServer = createServer((request, response) => {
              if (request.url === "/api/health") {
                response.writeHead(200, { "content-type": "application/json" });
                response.end('{"status":"ok"}');
              } else {
                response.writeHead(404);
                response.end();
              }
            });
            dashboardServer.listen(port, host);
            return {
              process: {} as ChildProcess,
              exited: new Promise(() => {}),
              stop: async () => {
                if (!dashboardServer?.listening) return;
                dashboardServer.closeAllConnections();
                await new Promise<void>((resolveClose) =>
                  dashboardServer!.close(() => resolveClose()),
                );
              },
            };
          },
        },
      },
    );

    expect(running.analysis.repository.rootPath).toBe(repository);
    expect((await fetch(`${running.dashboardUrl}/api/health`)).status).toBe(200);
    expect((await fetch(`${running.otlpUrl}/health`)).status).toBe(200);
    const paths = avalokDataPaths({ AVALOK_DATA_DIR: dataDirectory });
    const before = await buildCapabilityReport({
      analysis: running.analysis,
      target: repository,
      endpoint: running.otlpUrl,
      dataPaths: paths,
      environment: {
        HOME: dataDirectory,
        PATH: "",
        AI_VISUALIZER_CODEX_HOME: join(dataDirectory, "codex"),
      },
    });
    expect(before.sources.find((source) => source.id === "telemetry")?.observation).toBe("waiting");
    expect(
      (
        await fetch(`${running.otlpUrl}/v1/avalok/test-trace`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const after = await buildCapabilityReport({
      analysis: running.analysis,
      target: repository,
      endpoint: running.otlpUrl,
      dataPaths: paths,
      environment: {
        HOME: dataDirectory,
        PATH: "",
        AI_VISUALIZER_CODEX_HOME: join(dataDirectory, "codex"),
      },
    });
    expect(after.sources.find((source) => source.id === "telemetry")).toMatchObject({
      observation: "observed",
      count: 5,
    });
    const doctor = await runDoctor(
      {
        command: "doctor",
        target: repository,
        port: dashboardPort,
        otlpPort,
        open: false,
        help: false,
        version: false,
        yes: false,
      },
      {
        environment: {
          AVALOK_DATA_DIR: dataDirectory,
          HOME: dataDirectory,
          PATH: "",
          AI_VISUALIZER_CODEX_HOME: join(dataDirectory, "codex"),
        },
      },
    );
    expect(doctor.exitCode).toBe(0);
    expect(doctor.output).toContain("Avalok OTLP receiver listening");
    await running.stop();
    expect(await isPortAvailable(dashboardPort, cliDefaults.host)).toBe(true);
    expect(await isPortAvailable(otlpPort, cliDefaults.host)).toBe(true);
  });
});
