// `avalok hook <tool>`: the forwarder an agent's command hook runs. The agent starts it for an
// event and pipes the event as JSON on stdin; it posts that JSON to the local collector and
// exits.
//
// It must never get in the agent's way, so by design it:
//   - always exits 0, whatever happens (bad input, Avalok not running, a timeout, a crash);
//   - writes NOTHING to stdout or stderr when run by an agent (some agents read hook output as a
//     decision or add it to the model's context; Avalok is strictly observational and never
//     returns allow, deny, ask or any other decision);
//   - stops waiting for stdin and for the collector after short deadlines;
//   - talks only to 127.0.0.1, and writes only to the optional capture file.
//
// This file uses Node built-ins only, so the launcher can load it without the rest of the CLI
// (each hook event starts a new process; startup time is the agent's wait).

import { appendFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, posix, resolve, win32 } from "node:path";

/** Tools whose hook events the collector accepts. */
export const hookTools = ["kiro", "cursor"] as const;
export type HookTool = (typeof hookTools)[number];

export const hookLimits = Object.freeze({
  /** Largest event forwarded or captured. Larger events are dropped, never truncated. */
  maxPayloadBytes: 1024 * 1024,
  /** Waiting for the agent to finish writing stdin. */
  stdinTimeoutMs: 1500,
  /** Waiting for the collector to answer. */
  postTimeoutMs: 1500,
  /** Everything together; the process exits after this regardless. */
  deadlineMs: 3000,
  /** A capture file stops growing here (events after it are not captured). */
  maxCaptureFileBytes: 5 * 1024 * 1024,
});

export function isHookTool(value: string | undefined): value is HookTool {
  return (hookTools as readonly string[]).includes(value ?? "");
}

export interface HookOptions {
  tool: string | undefined;
  otlpPort: number;
  /** Append events to a local capture file (for learning an agent's event format). */
  capture?: { file: string; mode: "shape" | "raw" };
}

// ---------------------------------------------------------------------------------------------
// Capture: a local file of real events, so a normalizer can be written from facts, not guesses.
// ---------------------------------------------------------------------------------------------

/** Where `--capture` writes by default; inside Avalok's data directory so `avalok data clear` removes it. */
export function hookCaptureFile(
  tool: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
) {
  // Same rules as the data root in @visual-system/telemetry-adapter (a test keeps them equal);
  // repeated here so this file needs nothing from the rest of the CLI.
  const configured = environment.AVALOK_DATA_ROOT ?? environment.AVALOK_DATA_DIR;
  if (configured) return resolve(configured, "captures", `${tool}.jsonl`);
  if (platform === "win32") {
    const local = environment.LOCALAPPDATA;
    return win32.join(
      local && win32.isAbsolute(local) ? local : win32.join(home, "AppData", "Local"),
      "Avalok",
      "captures",
      `${tool}.jsonl`,
    );
  }
  if (platform === "darwin")
    return posix.join(
      home,
      "Library",
      "Application Support",
      "Avalok",
      "captures",
      `${tool}.jsonl`,
    );
  const xdg = environment.XDG_DATA_HOME;
  return posix.join(
    xdg && posix.isAbsolute(xdg) ? xdg : posix.join(home, ".local", "share"),
    "avalok",
    "captures",
    `${tool}.jsonl`,
  );
}

const textKeys =
  /(path|file|dir|folder|cwd|root|url|uri|email|user|command|cmd|prompt|text|content|message|input|output|args|diff|body|query|result|error|thought|response|token|key|secret|password|env)/i;
const identifierKeys =
  /(event|hook|trigger|type|kind|tool|name|matcher|mode|status|reason|decision|permission|source|phase|action|version|model)/i;
const identifierValue = /^[A-Za-z][A-Za-z0-9_.:-]{0,39}$/;

/**
 * The structure of an event without its content: keys, value types and array lengths. Short
 * identifier-like values are kept only under keys that name an event, tool, type or status
 * (that is what a normalizer needs), and never under keys that suggest paths, commands, prompts
 * or secrets. Strings become `<string:LENGTH>`. Best effort: read it before sharing it.
 */
export function describeShape(value: unknown, key = "", depth = 0): unknown {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return "<number>";
  if (typeof value === "string") {
    if (identifierKeys.test(key) && !textKeys.test(key) && identifierValue.test(value))
      return value;
    return `<string:${value.length}>`;
  }
  if (depth >= 8) return "<too deep>";
  if (Array.isArray(value)) {
    return {
      "<array>": value.length,
      ...(value.length > 0 ? { first: describeShape(value[0], key, depth + 1) } : {}),
    };
  }
  if (typeof value === "object") {
    const shaped: Record<string, unknown> = {};
    for (const [name, inner] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      // A key that is itself data (a path, a long id) is not recorded.
      const safeName = /[\\/]/.test(name) || name.length > 40 ? "<key>" : name;
      shaped[safeName] = describeShape(inner, name, depth + 1);
    }
    return shaped;
  }
  return `<${typeof value}>`;
}

async function appendCapture(
  capture: NonNullable<HookOptions["capture"]>,
  tool: string,
  payload: unknown,
  maxBytes = hookLimits.maxCaptureFileBytes,
) {
  await mkdir(dirname(capture.file), { recursive: true, mode: 0o700 });
  try {
    if ((await stat(capture.file)).size >= maxBytes) return;
  } catch {
    // The file does not exist yet.
  }
  const line = JSON.stringify({
    capturedAt: new Date().toISOString(),
    tool,
    mode: capture.mode,
    payload: capture.mode === "raw" ? payload : describeShape(payload),
  });
  await appendFile(capture.file, `${line}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------------------------
// The forwarder
// ---------------------------------------------------------------------------------------------

async function readLimited(input: AsyncIterable<unknown>, maximum: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.length;
    if (total > maximum) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Resolves to `fallback` after `ms`; the timer never keeps the process alive. */
function after<T>(ms: number, fallback: T) {
  return new Promise<T>((done) => setTimeout(() => done(fallback), ms).unref());
}

export interface HookDependencies {
  input: AsyncIterable<unknown> & { destroy?: () => unknown };
  fetch: typeof fetch;
  /** Overridden by tests so timeout paths run quickly. */
  limits: Record<keyof typeof hookLimits, number>;
}

/**
 * Reads one event from `input`, captures it when asked, posts it to the local collector, and
 * returns 0. Never throws and never returns anything but 0. Writes nothing to any output.
 */
export async function runHook(
  options: HookOptions,
  dependencies: Partial<HookDependencies> = {},
): Promise<0> {
  const input = dependencies.input ?? process.stdin;
  // A person at a terminal (agents never attach one) gets a hint instead of a silent wait.
  if (!dependencies.input && process.stdin.isTTY)
    process.stderr.write(
      "avalok hook reads one agent event as JSON on stdin; Kiro or Cursor runs it, not you.\nSee docs/development/hook-capture.md.\n",
    );
  const send = dependencies.fetch ?? fetch;
  const limits = dependencies.limits ?? hookLimits;
  const work = (async () => {
    const tool = options.tool;
    if (!isHookTool(tool)) return;
    const raw = await Promise.race([
      readLimited(input, limits.maxPayloadBytes),
      after(limits.stdinTimeoutMs, undefined),
    ]);
    if (!raw || raw.length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      // Not JSON: nothing to forward. A capture records that fact, not the bytes.
      if (options.capture)
        await appendCapture(
          options.capture,
          tool,
          { "<unparseable>": raw.length },
          limits.maxCaptureFileBytes,
        ).catch(() => undefined);
      return;
    }
    if (options.capture)
      await appendCapture(options.capture, tool, payload, limits.maxCaptureFileBytes).catch(
        () => undefined,
      );
    const response = await send(`http://127.0.0.1:${options.otlpPort}/v1/hooks/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
      signal: AbortSignal.timeout(limits.postTimeoutMs),
    });
    // The answer is not used; do not wait to download it.
    await response.body?.cancel().catch(() => undefined);
  })().catch(() => undefined);
  await Promise.race([work, after(limits.deadlineMs, undefined)]);
  try {
    input.destroy?.();
  } catch {
    // Nothing to clean up.
  }
  return 0;
}

/**
 * Command-line entry: `hook <tool> [--otlp-port <n>] [--capture] [--capture-raw]`. Used by the
 * launcher's fast path and by `runCli`. Returns 0 in every case.
 */
export async function hookMain(
  arguments_: string[],
  dependencies: Partial<HookDependencies> = {},
  environment: NodeJS.ProcessEnv = process.env,
): Promise<0> {
  let tool: string | undefined;
  let otlpPort = 4318;
  let capture: HookOptions["capture"];
  let captureMode: "shape" | "raw" | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--otlp-port") {
      const port = Number(arguments_[(index += 1)]);
      if (Number.isInteger(port) && port >= 1 && port <= 65_535) otlpPort = port;
    } else if (argument === "--capture") captureMode ??= "shape";
    else if (argument === "--capture-raw") captureMode = "raw";
    else if (!argument.startsWith("-")) tool ??= argument;
  }
  // Only a known tool names a file, so a hostile argument can never choose a path.
  if (captureMode && isHookTool(tool))
    capture = { file: hookCaptureFile(tool, environment), mode: captureMode };
  return runHook({ tool, otlpPort, ...(capture ? { capture } : {}) }, dependencies);
}
