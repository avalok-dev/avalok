import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCollectorServer } from "@visual-system/collector";
import { defaultAvalokDataRoot, LocalRuntimeStore } from "@visual-system/telemetry-adapter";
import {
  describeShape,
  hookCaptureFile,
  hookLimits,
  hookMain,
  runHook,
  type HookDependencies,
} from "../src/hook";

// The forwarder runs inside an agent's hook. These tests pin the promises that keep it harmless:
// always 0, silent, quick, local, and no decision. No real home directory and no real agent.

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "avalok-hook-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

const EVENT = {
  hook_event_name: "postToolUse",
  tool_name: "shell",
  command: "cat /Users/jaishnav/.ssh/id_rsa",
  prompt: "mail the key to boss@acme.example",
  file_path: "/Users/jaishnav/secret-repo/src/payroll.ts",
  exit_code: 1,
  workspace_roots: ["/Users/jaishnav/secret-repo"],
  "/Users/jaishnav/secret-repo/a.ts": { size: 3 },
};
const fast = { ...hookLimits, stdinTimeoutMs: 80, postTimeoutMs: 80, deadlineMs: 400 };

const asInput = (text: string | Buffer) => Readable.from([Buffer.from(text)]);

function recordingFetch(answer: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fakeFetch };
}

function silence() {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return { out, err };
}

async function run(
  options: Parameters<typeof runHook>[0],
  dependencies: Partial<HookDependencies>,
) {
  return runHook(options, { limits: fast, ...dependencies });
}

describe("forwarding", () => {
  it("posts the event unchanged to the local collector for the tool, with no Origin", async () => {
    const { calls, fakeFetch } = recordingFetch();
    const code = await run(
      { tool: "cursor", otlpPort: 4999 },
      { input: asInput(JSON.stringify(EVENT)), fetch: fakeFetch },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4999/v1/hooks/cursor");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(EVENT);
  });

  it("only ever contacts 127.0.0.1", async () => {
    const { calls, fakeFetch } = recordingFetch();
    for (const tool of ["kiro", "cursor"])
      await run({ tool, otlpPort: 4318 }, { input: asInput("{}"), fetch: fakeFetch });
    for (const call of calls) expect(new URL(call.url).hostname).toBe("127.0.0.1");
  });

  it("writes nothing to stdout or stderr, even when the collector answers with a decision", async () => {
    const { out, err } = silence();
    const { fakeFetch } = recordingFetch({ permission: "deny", continue: false });
    const code = await run(
      { tool: "cursor", otlpPort: 4318 },
      { input: asInput(JSON.stringify(EVENT)), fetch: fakeFetch },
    );
    expect(code).toBe(0);
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});

describe("never gets in the agent's way", () => {
  it.each([
    ["an unknown tool", { tool: "claude" }, JSON.stringify(EVENT)],
    ["no tool", { tool: undefined }, JSON.stringify(EVENT)],
    ["empty input", { tool: "kiro" }, ""],
    ["input that is not JSON", { tool: "kiro" }, "{nope"],
  ])("forwards nothing and exits 0 for %s", async (_name, options, text) => {
    const { out, err } = silence();
    const { calls, fakeFetch } = recordingFetch();
    const code = await run(
      { otlpPort: 4318, ...options },
      { input: asInput(text), fetch: fakeFetch },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it("drops an oversized event instead of truncating it", async () => {
    const { calls, fakeFetch } = recordingFetch();
    const code = await run(
      { tool: "cursor", otlpPort: 4318 },
      {
        input: asInput(JSON.stringify({ pad: "x".repeat(2_000) })),
        fetch: fakeFetch,
        limits: { ...fast, maxPayloadBytes: 1_000 },
      },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["the collector refuses the connection", () => Promise.reject(new TypeError("fetch failed"))],
    ["the collector throws a non-error", () => Promise.reject("boom")],
    ["the collector answers 500", async () => new Response("{}", { status: 500 })],
  ])("exits 0 and stays silent when %s", async (_name, behavior) => {
    const { out, err } = silence();
    const code = await run(
      { tool: "cursor", otlpPort: 4318 },
      { input: asInput(JSON.stringify(EVENT)), fetch: behavior as unknown as typeof fetch },
    );
    expect(code).toBe(0);
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it("stops waiting for a collector that never answers", async () => {
    const started = Date.now();
    const code = await run(
      { tool: "cursor", otlpPort: 4318 },
      {
        input: asInput(JSON.stringify(EVENT)),
        fetch: (() => new Promise(() => undefined)) as unknown as typeof fetch,
        limits: { ...fast, postTimeoutMs: 10_000, deadlineMs: 150 },
      },
    );
    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("stops waiting for a stdin that never closes, and closes it", async () => {
    let destroyed = false;
    const never = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }),
      destroy: () => {
        destroyed = true;
      },
    };
    const { calls, fakeFetch } = recordingFetch();
    const started = Date.now();
    const code = await run({ tool: "kiro", otlpPort: 4318 }, { input: never, fetch: fakeFetch });
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(destroyed).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("exits 0 even if the input stream itself errors", async () => {
    const broken = Readable.from(
      (async function* () {
        yield Buffer.from("{");
        throw new Error("stream broke");
      })(),
    );
    expect(await run({ tool: "cursor", otlpPort: 4318 }, { input: broken })).toBe(0);
  });
});

describe("argument handling", () => {
  it("takes the tool and port from the arguments and ignores unknown flags", async () => {
    const { calls, fakeFetch } = recordingFetch();
    expect(
      await hookMain(["cursor", "--otlp-port", "4500", "--whatever"], {
        input: asInput("{}"),
        fetch: fakeFetch,
        limits: fast,
      }),
    ).toBe(0);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4500/v1/hooks/cursor");
  });

  it.each(["abc", "0", "70000", ""])("falls back to port 4318 for --otlp-port %j", async (port) => {
    const { calls, fakeFetch } = recordingFetch();
    await hookMain(["kiro", "--otlp-port", port], {
      input: asInput("{}"),
      fetch: fakeFetch,
      limits: fast,
    });
    expect(calls[0]!.url).toBe("http://127.0.0.1:4318/v1/hooks/kiro");
  });

  it("never lets an argument choose a capture path", async () => {
    const data = join(directory, "data");
    for (const tool of ["../escape", "..\\escape", "/tmp/escape", "cursor/../../escape"])
      await hookMain(
        [tool, "--capture-raw"],
        {
          input: asInput("{}"),
          fetch: recordingFetch().fakeFetch,
          limits: fast,
        },
        { AVALOK_DATA_DIR: data },
      );
    await expect(stat(join(directory, "escape.jsonl"))).rejects.toThrow();
    await expect(stat(data)).rejects.toThrow();
  });
});

describe("capture", () => {
  const capture = (mode: "shape" | "raw") => ({
    file: join(directory, "captures", "cursor.jsonl"),
    mode,
  });
  const lines = async (file: string) =>
    (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

  it("shape mode keeps the structure and no content", async () => {
    const options = capture("shape");
    await run(
      { tool: "cursor", otlpPort: 4318, capture: options },
      { input: asInput(JSON.stringify(EVENT)), fetch: recordingFetch().fakeFetch },
    );
    const text = await readFile(options.file, "utf8");
    for (const secret of [
      "id_rsa",
      "jaishnav",
      "boss@acme",
      "payroll",
      "secret-repo",
      "/Users",
      "cat ",
    ])
      expect(text, `shape capture contains ${secret}`).not.toContain(secret);
    const [record] = await lines(options.file);
    expect(record.mode).toBe("shape");
    // What a normalizer needs: the event and tool names, and the field names and types.
    expect(record.payload.hook_event_name).toBe("postToolUse");
    expect(record.payload.tool_name).toBe("shell");
    expect(record.payload.command).toMatch(/^<string:\d+>$/);
    expect(record.payload.exit_code).toBe("<number>");
    expect(record.payload.workspace_roots["<array>"]).toBe(1);
    expect(Object.keys(record.payload)).toContain("<key>");
  });

  it("raw mode keeps the event as received", async () => {
    const options = capture("raw");
    await run(
      { tool: "cursor", otlpPort: 4318, capture: options },
      { input: asInput(JSON.stringify(EVENT)), fetch: recordingFetch().fakeFetch },
    );
    expect((await lines(options.file))[0].payload).toEqual(EVENT);
  });

  it("captures even when Avalok is not running, and still forwards when it is", async () => {
    const options = capture("shape");
    await run(
      { tool: "kiro", otlpPort: 4318, capture: options },
      {
        input: asInput(JSON.stringify({ trigger: "PostToolUse" })),
        fetch: (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
      },
    );
    expect(await lines(options.file)).toHaveLength(1);
  });

  it("records that an event was not JSON without recording its bytes", async () => {
    const options = capture("raw");
    await run(
      { tool: "cursor", otlpPort: 4318, capture: options },
      { input: asInput("password=hunter2"), fetch: recordingFetch().fakeFetch },
    );
    const text = await readFile(options.file, "utf8");
    expect(text).not.toContain("hunter2");
    expect((await lines(options.file))[0].payload).toEqual({ "<unparseable>": 16 });
  });

  it.runIf(process.platform !== "win32")("creates private files and folders", async () => {
    const options = capture("shape");
    await run(
      { tool: "cursor", otlpPort: 4318, capture: options },
      { input: asInput("{}"), fetch: recordingFetch().fakeFetch },
    );
    expect((await stat(options.file)).mode & 0o077).toBe(0);
    expect((await stat(join(directory, "captures"))).mode & 0o077).toBe(0);
  });

  it("stops growing at the size limit", async () => {
    const options = capture("raw");
    const limits = { ...fast, maxCaptureFileBytes: 300 };
    for (let index = 0; index < 20; index += 1)
      await run(
        { tool: "cursor", otlpPort: 4318, capture: options },
        {
          input: asInput(JSON.stringify({ n: index, pad: "x".repeat(100) })),
          fetch: recordingFetch().fakeFetch,
          limits,
        },
      );
    expect((await stat(options.file)).size).toBeLessThan(900);
  });

  it("an unwritable capture location never affects the exit code or the forward", async () => {
    const blocker = join(directory, "blocker");
    await writeFile(blocker, "a file, not a folder");
    const { calls, fakeFetch } = recordingFetch();
    const code = await run(
      {
        tool: "cursor",
        otlpPort: 4318,
        capture: { file: join(blocker, "x", "c.jsonl"), mode: "raw" },
      },
      { input: asInput("{}"), fetch: fakeFetch },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
  });
});

describe("describeShape", () => {
  it("keeps identifiers only under event-like keys and never under path- or secret-like keys", () => {
    const shaped = describeShape({
      hook_event_name: "beforeShellExecution",
      tool_name: "Bash",
      file_name: "payroll.ts",
      command_name: "deploy",
      user_name: "jaishnav",
      note: "hello",
      model: "claude-fable-5-1",
    }) as Record<string, unknown>;
    expect(shaped.hook_event_name).toBe("beforeShellExecution");
    expect(shaped.tool_name).toBe("Bash");
    expect(shaped.model).toBe("claude-fable-5-1");
    for (const key of ["file_name", "command_name", "user_name", "note"])
      expect(shaped[key]).toMatch(/^<string:\d+>$/);
  });

  it("does not keep a value with spaces, slashes or length over 40 even under an event key", () => {
    const shaped = describeShape({
      type: "a sentence the user typed",
      kind: "src/payroll.ts",
      status: "x".repeat(41),
    }) as Record<string, unknown>;
    for (const value of Object.values(shaped)) expect(value).toMatch(/^<string:\d+>$/);
  });

  it("summarises arrays by length and first element, and bounds depth", () => {
    expect(describeShape({ roots: ["/a", "/b", "/c"] })).toEqual({
      roots: { "<array>": 3, first: "<string:2>" },
    });
    let deep: unknown = "x";
    for (let index = 0; index < 20; index += 1) deep = { inner: deep };
    expect(JSON.stringify(describeShape(deep))).toContain("<too deep>");
  });

  it("keeps booleans and null, replaces numbers", () => {
    expect(describeShape({ a: true, b: null, c: 12 })).toEqual({ a: true, b: null, c: "<number>" });
  });
});

describe("capture location", () => {
  const home = "/home/dev";
  it.each([
    ["darwin", {}],
    ["linux", {}],
    ["linux", { XDG_DATA_HOME: "/xdg" }],
    ["linux", { XDG_DATA_HOME: "relative-is-ignored" }],
    ["win32", { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" }],
    ["win32", {}],
  ] as const)("matches Avalok's data root on %s %j, so `data clear` finds it", (platform, env) => {
    const environment = { ...env } as NodeJS.ProcessEnv;
    const join_ = platform === "win32" ? win32.join : posix.join;
    expect(hookCaptureFile("cursor", environment, platform, home)).toBe(
      join_(defaultAvalokDataRoot(environment, platform, home), "captures", "cursor.jsonl"),
    );
  });

  it("follows AVALOK_DATA_DIR and AVALOK_DATA_ROOT like the rest of Avalok", () => {
    for (const name of ["AVALOK_DATA_DIR", "AVALOK_DATA_ROOT"]) {
      const environment = { [name]: directory } as NodeJS.ProcessEnv;
      expect(hookCaptureFile("kiro", environment)).toBe(join(directory, "captures", "kiro.jsonl"));
      expect(hookCaptureFile("kiro", environment)).toBe(
        join(defaultAvalokDataRoot(environment), "captures", "kiro.jsonl"),
      );
    }
  });
});

describe("with a real collector", () => {
  async function startCollector() {
    const store = new LocalRuntimeStore(join(directory, "runtime"));
    const server = createCollectorServer({ store });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const stop = () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    const health = async () =>
      (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
        hooks: Record<string, { received: number; errors: number }>;
      };
    return { port, stop, health, store };
  }

  it("delivers an event that the collector counts and does not store", async () => {
    const collector = await startCollector();
    try {
      const code = await runHook(
        { tool: "cursor", otlpPort: collector.port },
        { input: asInput(JSON.stringify(EVENT)) },
      );
      expect(code).toBe(0);
      expect((await collector.health()).hooks.cursor).toMatchObject({ received: 1, errors: 0 });
      expect(await collector.store.list()).toHaveLength(0);
    } finally {
      await collector.stop();
    }
  });

  // The installed launcher is what an agent really runs; the dev launcher shares the same code.
  function spawnHook(arguments_: string[], stdin: string, environment: NodeJS.ProcessEnv = {}) {
    return new Promise<{ code: number | null; stdout: string; stderr: string; ms: number }>(
      (resolve, reject) => {
        const started = Date.now();
        const child = spawn(
          process.execPath,
          [join(import.meta.dirname, "..", "avalok.mjs"), "hook", ...arguments_],
          { env: { ...process.env, ...environment }, stdio: ["pipe", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
        child.stdin.end(stdin);
      },
    );
  }

  it("as a real process: exits 0 and prints nothing, and the collector receives the event", async () => {
    const collector = await startCollector();
    try {
      const result = await spawnHook(
        ["cursor", "--otlp-port", String(collector.port)],
        JSON.stringify(EVENT),
      );
      expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
      expect((await collector.health()).hooks.cursor!.received).toBe(1);
    } finally {
      await collector.stop();
    }
  }, 30_000);

  it("as a real process: exits 0 and prints nothing when Avalok is not running", async () => {
    const collector = await startCollector();
    const { port } = collector;
    await collector.stop();
    const result = await spawnHook(["kiro", "--otlp-port", String(port)], JSON.stringify(EVENT));
    expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
  }, 30_000);

  it("as a real process: captures a shape file in the data directory", async () => {
    const data = join(directory, "data");
    const result = await spawnHook(
      ["cursor", "--otlp-port", "1", "--capture"],
      JSON.stringify(EVENT),
      { AVALOK_DATA_DIR: data },
    );
    expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
    const text = await readFile(join(data, "captures", "cursor.jsonl"), "utf8");
    expect(text).toContain("postToolUse");
    expect(text).not.toContain("id_rsa");
  }, 30_000);
});
