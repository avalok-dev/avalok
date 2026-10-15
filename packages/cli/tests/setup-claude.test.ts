import { mkdtemp, readdir, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliUsageError, parseCliOptions } from "../src/options";
import {
  addAvalokHooks,
  claudeHookUrl,
  claudeHooksSnippet,
  isAvalokHook,
  removeAvalokHooks,
  runSetupClaude,
  settingsPath,
} from "../src/setup-claude";

// Every test works inside a temporary project directory. Nothing here reads or writes the real
// home directory or the real Claude settings.
let project: string;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "avalok-setup-"));
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

function run(options: {
  apply?: boolean;
  remove?: boolean;
  yes?: boolean;
  otlpPort?: number;
  confirm?: (question: string) => Promise<boolean>;
}) {
  let text = "";
  const promise = runSetupClaude({
    target: project,
    otlpPort: options.otlpPort ?? 4318,
    apply: options.apply ?? false,
    remove: options.remove ?? false,
    yes: options.yes ?? false,
    output: { write: (chunk: string) => (text += chunk) },
    ...(options.confirm ? { confirm: options.confirm } : {}),
    now: () => new Date("2026-10-07T12:34:56.000Z"),
  });
  return promise.then((code) => ({ code, text }));
}

const userHook = { type: "command", command: "echo mine" };
const existing = {
  permissions: { allow: ["Bash(ls)"] },
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] },
};

async function writeExisting(content: unknown = existing) {
  await mkdir(join(project, ".claude"), { recursive: true });
  await writeFile(settingsPath(project), JSON.stringify(content), "utf8");
}
const read = async () => JSON.parse(await readFile(settingsPath(project), "utf8"));
const files = () => readdir(join(project, ".claude")).catch(() => [] as string[]);

describe("avalok setup claude", () => {
  it("prints the hooks and writes nothing by default", async () => {
    const result = await run({});
    expect(result.code).toBe(0);
    expect(result.text).toContain("Nothing has been written");
    expect(result.text).toContain(claudeHookUrl(4318));
    expect(result.text).toContain("avalok setup claude --apply");
    expect(await files()).toEqual([]);
  });

  it("creates the project file with --yes and uses the receiver port", async () => {
    const result = await run({ apply: true, yes: true, otlpPort: 4400 });
    expect(result.code).toBe(0);
    const settings = await read();
    expect(Object.keys(settings.hooks)).toHaveLength(8);
    expect(JSON.stringify(settings)).toContain("http://127.0.0.1:4400/v1/claude/hooks");
    expect(settings.hooks.PreToolUse[0].matcher).toBe("*");
    expect(await files()).toEqual(["settings.local.json"]); // no backup: nothing existed
  });

  it("keeps other settings and hooks, and backs up the original bytes", async () => {
    await writeExisting();
    const original = await readFile(settingsPath(project), "utf8");
    const result = await run({ apply: true, yes: true });
    expect(result.code).toBe(0);
    const settings = await read();
    expect(settings.permissions).toEqual(existing.permissions);
    const preTool = settings.hooks.PreToolUse as { hooks: unknown[] }[];
    expect(JSON.stringify(preTool)).toContain("echo mine");
    expect(JSON.stringify(preTool)).toContain("/v1/claude/hooks");
    const backups = (await files()).filter((name) => name.includes(".avalok-backup-"));
    expect(backups).toEqual(["settings.local.json.avalok-backup-20261007123456"]);
    expect(await readFile(join(project, ".claude", backups[0]!), "utf8")).toBe(original);
  });

  it("is idempotent: a second apply changes nothing and makes no new backup", async () => {
    await writeExisting();
    await run({ apply: true, yes: true });
    const after = await readFile(settingsPath(project), "utf8");
    const namesAfter = await files();
    const second = await run({ apply: true, yes: true });
    expect(second.code).toBe(0);
    expect(second.text).toContain("already configured");
    expect(await readFile(settingsPath(project), "utf8")).toBe(after);
    expect(await files()).toEqual(namesAfter);
  });

  it("updates the port instead of duplicating hooks", async () => {
    await run({ apply: true, yes: true, otlpPort: 4318 });
    const result = await run({ apply: true, yes: true, otlpPort: 4500 });
    expect(result.code).toBe(0);
    const text = JSON.stringify(await read());
    expect(text).toContain(":4500/v1/claude/hooks");
    expect(text).not.toContain(":4318/v1/claude/hooks");
    expect((await read()).hooks.SessionStart).toHaveLength(1);
  });

  it("removes only Avalok's hooks and restores the user's own", async () => {
    await writeExisting();
    await run({ apply: true, yes: true });
    const result = await run({ remove: true, yes: true });
    expect(result.code).toBe(0);
    const settings = await read();
    expect(settings).toEqual(existing);
  });

  it("removing from a file with no Avalok hooks is a no-op", async () => {
    await writeExisting();
    const before = await readFile(settingsPath(project), "utf8");
    const result = await run({ remove: true, yes: true });
    expect(result.text).toContain("Nothing to remove");
    expect(await readFile(settingsPath(project), "utf8")).toBe(before);
  });

  it("never edits a file that is not valid JSON", async () => {
    await mkdir(join(project, ".claude"), { recursive: true });
    await writeFile(settingsPath(project), "{ not json", "utf8");
    const result = await run({ apply: true, yes: true });
    expect(result.code).toBe(1);
    expect(result.text).toContain("not valid JSON");
    expect(await readFile(settingsPath(project), "utf8")).toBe("{ not json");
    expect(await files()).toEqual(["settings.local.json"]);
  });

  it("refuses to write without --yes outside an interactive terminal", async () => {
    const result = await run({ apply: true });
    expect(result.code).toBe(1);
    expect(result.text).toContain("Re-run with --yes");
    expect(await files()).toEqual([]);
  });

  it("asks first when interactive, and a 'no' changes nothing", async () => {
    const declined = await run({ apply: true, confirm: async () => false });
    expect(declined.code).toBe(0);
    expect(declined.text).toContain("Cancelled");
    expect(await files()).toEqual([]);
    const accepted = await run({ apply: true, confirm: async () => true });
    expect(accepted.code).toBe(0);
    expect(await files()).toEqual(["settings.local.json"]);
  });

  it("rejects hooks values it cannot merge safely", () => {
    expect(() => addAvalokHooks({ hooks: [] }, 4318)).toThrow(/not an object/);
    expect(() => addAvalokHooks({ hooks: { Stop: "x" } }, 4318)).toThrow(/not a list/);
  });

  it("recognizes only Avalok's own loopback hooks", () => {
    expect(isAvalokHook({ type: "http", url: claudeHookUrl(4318) })).toBe(true);
    expect(isAvalokHook({ type: "http", url: "http://localhost:9/v1/claude/hooks" })).toBe(true);
    expect(isAvalokHook({ type: "http", url: "https://example.com/v1/claude/hooks" })).toBe(false);
    expect(isAvalokHook({ type: "command", command: claudeHookUrl(4318) })).toBe(false);
    const { removed } = removeAvalokHooks({
      hooks: { Stop: [{ hooks: [{ type: "http", url: "https://example.com/v1/claude/hooks" }] }] },
    });
    expect(removed).toBe(0);
  });

  it("the printed snippet is exactly what apply writes into an empty file", () => {
    expect(addAvalokHooks({}, 4318).settings).toEqual(claudeHooksSnippet(4318));
  });
});

describe("setup command-line options", () => {
  it("parses setup claude with its flags and a target", () => {
    expect(parseCliOptions(["setup", "claude"])).toMatchObject({ command: "setup-claude" });
    expect(parseCliOptions(["setup", "claude", "../app", "--apply", "--yes"])).toMatchObject({
      command: "setup-claude",
      target: "../app",
      apply: true,
      yes: true,
    });
    expect(parseCliOptions(["setup", "codex"])).toMatchObject({ command: "setup-codex" });
  });

  it("rejects unknown tools and misplaced or conflicting flags", () => {
    expect(() => parseCliOptions(["setup"])).toThrow(CliUsageError);
    expect(() => parseCliOptions(["setup", "vim"])).toThrow(CliUsageError);
    expect(() => parseCliOptions(["--apply"])).toThrow(/only apply to 'setup claude'/);
    expect(() => parseCliOptions(["setup", "codex", "--remove"])).toThrow(CliUsageError);
    expect(() => parseCliOptions(["setup", "claude", "--apply", "--remove"])).toThrow(/either/);
  });
});
