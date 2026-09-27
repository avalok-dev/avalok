#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import type { EventEmitter } from "node:events";
import { productIdentity } from "./identity.ts";
import { helpText, parseCliOptions } from "./options.ts";
import { maybeOpenBrowser, startAgentMap, startupSummary } from "./orchestrator.ts";
import { StartupError } from "./system.ts";
import { dataPath, runDataClear } from "./data.ts";
import { runDoctor } from "./doctor.ts";

export async function runCli(
  arguments_ = process.argv.slice(2),
  output: Pick<NodeJS.WriteStream, "write"> = process.stdout,
  errorOutput: Pick<NodeJS.WriteStream, "write"> = process.stderr,
) {
  const options = parseCliOptions(arguments_);
  if (options.help) {
    output.write(helpText());
    return 0;
  }
  if (options.version) {
    output.write(`${productIdentity.version}\n`);
    return 0;
  }
  if (options.command === "data-path") {
    output.write(`${dataPath().root}\n`);
    return 0;
  }
  if (options.command === "data-clear") {
    const result = await runDataClear({
      yes: options.yes,
      output: output as NodeJS.WritableStream,
    });
    output.write(result.message);
    return 0;
  }
  if (options.command === "doctor") {
    const result = await runDoctor(options);
    output.write(result.output);
    return result.exitCode;
  }
  const running = await startAgentMap(options);
  output.write(startupSummary(running, options.port));
  for (const status of [running.sources.codex, running.sources.claude])
    if (status.warning) errorOutput.write(`Warning: ${status.warning}\n`);
  const browserWarning = await maybeOpenBrowser(running, options.open);
  if (browserWarning) errorOutput.write(`Warning: ${browserWarning}\n`);

  await waitForShutdown(running, process, output);
  output.write(`${productIdentity.displayName} stopped.\n`);
  return 0;
}

export const shutdownSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export async function waitForShutdown(
  running: Awaited<ReturnType<typeof startAgentMap>>,
  signals: Pick<EventEmitter, "once" | "removeListener">,
  output: Pick<NodeJS.WriteStream, "write">,
) {
  let stopping = false;
  let completeShutdown: (() => void) | undefined;
  const shutdownSignal = new Promise<void>((resolveShutdown) => {
    completeShutdown = resolveShutdown;
  });
  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    output.write(`\nStopping ${productIdentity.displayName}...\n`);
    completeShutdown?.();
  };
  // SIGINT: Ctrl+C everywhere (Node maps Windows console Ctrl+C to SIGINT). SIGTERM: POSIX
  // service managers. SIGHUP: terminal closed, including a closed Windows console window.
  for (const signal of shutdownSignals) signals.once(signal, onSignal);
  try {
    await Promise.race([
      running.dashboard.exited.then(({ code, signal }) => {
        if (!stopping)
          throw new StartupError(
            `Dashboard stopped unexpectedly${code === null ? "" : ` with exit code ${code}`}${signal ? ` (${signal})` : ""}.`,
            "Run AgentMap again. If the problem continues, rebuild the dashboard.",
          );
      }),
      shutdownSignal,
    ]);
  } finally {
    for (const signal of shutdownSignals) signals.removeListener(signal, onSignal);
    await running.stop();
  }
}

export function formatCliError(error: unknown) {
  const reason = error instanceof Error ? error.message : "Unknown startup error.";
  const hint = error instanceof StartupError ? error.hint : "Check the command and run again.";
  return `${productIdentity.displayName} could not start.\n\nReason:\n${reason}\n\nTry:\n${hint}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    process.stderr.write(formatCliError(error));
    process.exitCode = 1;
  });
}
