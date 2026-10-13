#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import type { EventEmitter } from "node:events";
import { productIdentity } from "./identity.ts";
import { helpText, parseCliOptions } from "./options.ts";
import { maybeOpenBrowser, startAvalok, startupSummary } from "./orchestrator.ts";
import { StartupError, resolveTarget } from "./system.ts";
import { runSetupClaude } from "./setup-claude.ts";
import { runFeedback } from "./feedback.ts";
import { hookMain } from "./hook.ts";
import { runRecap } from "./recap.ts";
import { runWrapped } from "./wrapped.ts";
import { createInterface } from "node:readline/promises";
import { discoverCodexSessions } from "@visual-system/codex-adapter";
import { dataPath, runDataClear } from "./data.ts";
import { runDoctor } from "./doctor.ts";
import { importOpenAiTraceFiles } from "@visual-system/telemetry-adapter";

export async function runCli(
  arguments_ = process.argv.slice(2),
  output: Pick<NodeJS.WriteStream, "write"> = process.stdout,
  errorOutput: Pick<NodeJS.WriteStream, "write"> = process.stderr,
) {
  // The agent hook forwarder: before option parsing, silent, and always 0 (see hook.ts).
  if (arguments_[0] === "hook") return hookMain(arguments_.slice(1));
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
  if (options.command === "import-openai") {
    const result = await importOpenAiTraceFiles(options.files ?? []);
    output.write(
      `Imported ${result.traces} traces and ${result.spans} distinct spans from ${result.files} saved pages.${result.malformed ? ` Skipped ${result.malformed} malformed items.` : ""}\n`,
    );
    return result.malformed ? 1 : 0;
  }
  if (options.command === "feedback") return runFeedback({ output });
  if (options.command === "wrapped" && options.recap) {
    return runWrapped({
      days: options.days ?? 7,
      recap: options.recap,
      cwd: process.cwd(),
      output,
    });
  }
  if (options.command === "recap" && options.recap) {
    const target = await resolveTarget(options.target);
    return runRecap({ target, recap: options.recap, cwd: process.cwd(), output });
  }
  if (options.command === "setup-claude") {
    const target = await resolveTarget(options.target);
    return runSetupClaude({
      target,
      otlpPort: options.otlpPort,
      apply: options.apply ?? false,
      remove: options.remove ?? false,
      yes: options.yes,
      output,
      // Only an interactive terminal can confirm; anything else must pass --yes.
      ...(process.stdin.isTTY
        ? {
            confirm: async (question: string) => {
              const prompt = createInterface({ input: process.stdin, output: process.stdout });
              try {
                return /^y(es)?$/i.test((await prompt.question(question)).trim());
              } finally {
                prompt.close();
              }
            },
          }
        : {}),
    });
  }
  if (options.command === "setup-codex") {
    const sessions = await discoverCodexSessions().catch(() => undefined);
    output.write(
      [
        "Codex needs no setup. Avalok reads your local Codex session files read-only",
        "(~/.codex/sessions, or $CODEX_HOME) and never writes to Codex's directory.",
        sessions === undefined
          ? "Codex sessions could not be listed on this machine."
          : `Found ${sessions.length} local Codex session${sessions.length === 1 ? "" : "s"}.`,
        "Run `avalok` in a repository: the newest session that ran there opens first.",
        "",
      ].join("\n"),
    );
    return 0;
  }
  if (options.command === "doctor") {
    const result = await runDoctor(options);
    output.write(result.output);
    return result.exitCode;
  }
  const running = await startAvalok(options);
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
  running: Awaited<ReturnType<typeof startAvalok>>,
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
            "Run Avalok again. If the problem continues, rebuild the dashboard.",
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
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(formatCliError(error));
      process.exitCode = 1;
    });
}
