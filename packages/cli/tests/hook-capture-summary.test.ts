import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookMain } from "../src/hook";
import { Readable } from "node:stream";

// The summary helper reads what `avalok hook --capture` writes. Run end to end so the two cannot
// drift apart.

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "avalok-summary-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const script = join(import.meta.dirname, "../../../docs/development/hook-capture-summary.mjs");

async function capture(tool: string, flag: string, event: unknown) {
  await hookMain(
    [tool, "--otlp-port", "1", flag],
    {
      input: Readable.from([Buffer.from(JSON.stringify(event))]),
      fetch: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch,
    },
    { AVALOK_DATA_DIR: directory },
  );
  return join(directory, "captures", `${tool}.jsonl`);
}

describe("hook-capture-summary", () => {
  it("lists event kinds and their fields from a shape capture, without values", async () => {
    await capture("cursor", "--capture", {
      hook_event_name: "afterShellExecution",
      command: "cat /Users/someone/private.txt",
      workspace_roots: ["/Users/someone/repo"],
      exit_code: 0,
    });
    const file = await capture("cursor", "--capture", {
      hook_event_name: "afterFileEdit",
      file_path: "/Users/someone/repo/a.ts",
    });
    const result = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 captured event(s), 2 kind(s)");
    expect(result.stdout).toContain("cursor  afterShellExecution  x1  (shape capture)");
    expect(result.stdout).toContain("workspace_roots.[]");
    expect(result.stdout).toContain("exit_code");
    expect(result.stdout).toContain("file_path");
    expect(result.stdout).not.toContain("someone");
  });

  it("works on raw captures and falls back when there is no event name", async () => {
    const file = await capture("kiro", "--capture-raw", { weird: { nested: [1, 2] } });
    const result = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("(no event name field)");
    expect(result.stdout).toContain("weird.nested.[]");
  });

  it("explains usage when given no file", () => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage");
  });
});
