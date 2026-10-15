import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// `avalok setup claude`: print, and only on explicit request write, the Claude Code HTTP hooks
// that let Avalok observe a session. Hooks are observational; Avalok never blocks Claude Code.
// The target is the project-local `.claude/settings.local.json` (hook scope is the user's choice;
// this never touches ~/.claude). Nothing is written without --apply plus confirmation, an existing
// file is backed up first, and only Avalok's own hook entries are ever added, updated or removed.

const events: { name: string; matcher?: string }[] = [
  { name: "SessionStart" },
  { name: "UserPromptSubmit" },
  { name: "PreToolUse", matcher: "*" },
  { name: "PostToolUse", matcher: "*" },
  { name: "PostToolUseFailure", matcher: "*" },
  { name: "Stop" },
  { name: "StopFailure" },
  { name: "SessionEnd" },
];

type Json = Record<string, unknown>;
interface HttpHook {
  type: string;
  url?: unknown;
  timeout?: unknown;
  [key: string]: unknown;
}
interface HookEntry {
  matcher?: string;
  hooks?: HttpHook[];
  [key: string]: unknown;
}

export class SetupError extends Error {}

export function claudeHookUrl(otlpPort: number) {
  return `http://127.0.0.1:${otlpPort}/v1/claude/hooks`;
}

// Matches Avalok's loopback receiver on any port, so a changed port is updated, not duplicated.
const avalokHookUrl = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/v1\/claude\/hooks$/;

export function isAvalokHook(hook: unknown): hook is HttpHook {
  const candidate = hook as HttpHook | null;
  return (
    !!candidate &&
    candidate.type === "http" &&
    typeof candidate.url === "string" &&
    avalokHookUrl.test(candidate.url)
  );
}

function hookEntry(matcher: string | undefined, otlpPort: number): HookEntry {
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: "http", url: claudeHookUrl(otlpPort), timeout: 5 }],
  };
}

/** The settings fragment Avalok needs (only a `hooks` object). */
export function claudeHooksSnippet(otlpPort: number): Json {
  return {
    hooks: Object.fromEntries(
      events.map(({ name, matcher }) => [name, [hookEntry(matcher, otlpPort)]]),
    ),
  };
}

function hooksObject(settings: Json): Record<string, unknown> {
  const hooks = settings.hooks;
  if (hooks === undefined) return {};
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
    throw new SetupError('The existing settings have a "hooks" value that is not an object.');
  return hooks as Record<string, unknown>;
}

export interface HookChange {
  added: string[];
  updated: string[];
  unchanged: string[];
}

/** Returns new settings with Avalok's hooks present for every event; other hooks are untouched. */
export function addAvalokHooks(
  settings: Json,
  otlpPort: number,
): { settings: Json; change: HookChange } {
  const hooks = { ...hooksObject(settings) };
  const change: HookChange = { added: [], updated: [], unchanged: [] };
  const url = claudeHookUrl(otlpPort);
  for (const { name, matcher } of events) {
    const existing = hooks[name];
    if (existing !== undefined && !Array.isArray(existing))
      throw new SetupError(`The existing "${name}" hooks value is not a list.`);
    const entries = ((existing as HookEntry[] | undefined) ?? []).map((entry) => ({ ...entry }));
    let found = false;
    let updated = false;
    for (const entry of entries) {
      if (!Array.isArray(entry.hooks)) continue;
      entry.hooks = entry.hooks.map((hook) => {
        if (!isAvalokHook(hook)) return hook;
        found = true;
        if (hook.url === url) return hook;
        updated = true;
        return { ...hook, url };
      });
    }
    if (!found) {
      entries.push(hookEntry(matcher, otlpPort));
      change.added.push(name);
    } else if (updated) change.updated.push(name);
    else change.unchanged.push(name);
    hooks[name] = entries;
  }
  return { settings: { ...settings, hooks }, change };
}

/** Returns new settings without Avalok's hook entries; other hooks and keys are untouched. */
export function removeAvalokHooks(settings: Json): { settings: Json; removed: number } {
  if (settings.hooks === undefined) return { settings, removed: 0 };
  const hooks: Record<string, unknown> = { ...hooksObject(settings) };
  let removed = 0;
  for (const [name, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) continue;
    const kept: HookEntry[] = [];
    for (const entry of value as HookEntry[]) {
      if (!entry || !Array.isArray(entry.hooks)) {
        kept.push(entry);
        continue;
      }
      const remaining = entry.hooks.filter((hook) => !isAvalokHook(hook));
      removed += entry.hooks.length - remaining.length;
      if (remaining.length > 0) kept.push({ ...entry, hooks: remaining });
      else if (remaining.length === entry.hooks.length) kept.push(entry);
    }
    if (kept.length > 0) hooks[name] = kept;
    else delete hooks[name];
  }
  const next: Json = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return { settings: next, removed };
}

export function settingsPath(target: string) {
  return join(target, ".claude", "settings.local.json");
}

function stamp(now: Date) {
  return now.toISOString().replace(/[-:T]/g, "").replace(/\..*$/, "");
}

async function readSettings(file: string): Promise<{ exists: boolean; settings: Json }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, settings: {} };
    throw new SetupError(`Could not read ${file}.`);
  }
  if (text.trim() === "") return { exists: true, settings: {} };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");
    return { exists: true, settings: parsed as Json };
  } catch {
    throw new SetupError(
      `${file} is not valid JSON, so Avalok will not edit it. Fix or remove the file and try again.`,
    );
  }
}

async function writeSettings(file: string, settings: Json, existed: boolean, now: Date) {
  await mkdir(join(file, ".."), { recursive: true });
  let backup: string | undefined;
  if (existed) {
    backup = `${file}.avalok-backup-${stamp(now)}`;
    await copyFile(file, backup);
  }
  const temporary = `${file}.avalok-tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  return backup;
}

export interface SetupClaudeOptions {
  target: string;
  otlpPort: number;
  apply: boolean;
  remove: boolean;
  yes: boolean;
  output: { write(text: string): unknown };
  /** Asks the user to confirm a write. Absent means non-interactive. */
  confirm?: (question: string) => Promise<boolean>;
  now?: () => Date;
}

function list(names: string[]) {
  return names.join(", ");
}

/** Runs the command and returns the process exit code. */
export async function runSetupClaude(options: SetupClaudeOptions): Promise<number> {
  const { output } = options;
  const file = settingsPath(options.target);
  const now = (options.now ?? (() => new Date()))();
  let current: { exists: boolean; settings: Json };
  try {
    current = await readSettings(file);
  } catch (error) {
    if (error instanceof SetupError) {
      output.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  try {
    if (options.remove) {
      const { settings, removed } = removeAvalokHooks(current.settings);
      if (removed === 0) {
        output.write(`No Avalok hooks found in ${file}. Nothing to remove.\n`);
        return 0;
      }
      return await confirmAndWrite(
        options,
        file,
        settings,
        current.exists,
        now,
        `Remove ${removed} Avalok hook entries from ${file}`,
        "Removed.",
      );
    }

    const { settings, change } = addAvalokHooks(current.settings, options.otlpPort);
    const needsChange = change.added.length + change.updated.length > 0;

    if (!options.apply) {
      output.write(
        [
          "Avalok can observe Claude Code sessions through HTTP hooks. They are observational:",
          "Avalok responds successfully and never blocks or changes Claude Code.",
          "",
          `Project file: ${file}`,
          needsChange
            ? "Nothing has been written. This is the hooks block Avalok needs:"
            : "Avalok's hooks are already configured in this file. Nothing to do.",
          "",
          JSON.stringify(claudeHooksSnippet(options.otlpPort), null, 2),
          "",
          needsChange
            ? `To add it (you will be asked to confirm; an existing file is backed up first):\n  avalok setup claude --apply\nTo remove it later:\n  avalok setup claude --remove\n`
            : "To remove them: avalok setup claude --remove\n",
        ].join("\n"),
      );
      return 0;
    }

    if (!needsChange) {
      output.write(`Avalok's hooks are already configured in ${file}. Nothing to change.\n`);
      return 0;
    }
    const summary = [
      change.added.length ? `add ${list(change.added)}` : "",
      change.updated.length ? `update the URL for ${list(change.updated)}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    return await confirmAndWrite(
      options,
      file,
      settings,
      current.exists,
      now,
      `In ${file}: ${summary}`,
      "Hooks added.",
    );
  } catch (error) {
    if (error instanceof SetupError) {
      output.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

async function confirmAndWrite(
  options: SetupClaudeOptions,
  file: string,
  settings: Json,
  existed: boolean,
  now: Date,
  summary: string,
  done: string,
) {
  const { output } = options;
  output.write(`${summary}.\n`);
  output.write(
    existed
      ? "The file is backed up first; other settings and hooks are kept as they are (the file is re-saved as standard JSON).\n"
      : "The file does not exist yet and will be created.\n",
  );
  if (!options.yes) {
    if (!options.confirm) {
      output.write(
        "Not confirmed: this is not an interactive terminal. Re-run with --yes to apply.\n",
      );
      return 1;
    }
    if (!(await options.confirm("Apply this change? [y/N] "))) {
      output.write("Cancelled. Nothing was changed.\n");
      return 0;
    }
  }
  const backup = await writeSettings(file, settings, existed, now);
  output.write(`${done}${backup ? ` Backup: ${backup}` : ""}\n`);
  output.write(
    "Start a new Claude Code session in this project. Avalok shows it once its first event arrives.\n",
  );
  return 0;
}
