import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { legacyAgentMapDirectoryNames, platformDataRoot } from "@visual-system/telemetry-adapter";
import type { SarvadrikDataPaths } from "./index.ts";

// Migration of development data kept under the product's former working name, AgentMap, into
// the Sarvadrik platform data root. Sources, in order:
//   1. The AgentMap platform root (M7.2–M7.4A): runtime snapshots and settings.json.
//   2. The provisional M7.1 location `~/.agentmap/runtime`.
// Strategy per source: copy → verify → activate, one snapshot at a time.
//   - Only runtime snapshot files (`<source>-<sha256>.json`) are considered.
//   - Symlinks and anything else in a legacy directory are ignored.
//   - A destination file that already exists is never overwritten (newer data wins).
//   - Activation is an exclusive hard link (or exclusive copy) so a concurrent writer is never
//     clobbered and readers never observe a partial file.
//   - settings.json is copied only when Sarvadrik has none yet.
//   - Legacy directories are never modified or deleted.
//   - Each source's outcome is recorded in `<root>/migration.json`; a completed source is a
//     no-op afterwards, and a failed source is retried on the next start.

export const MIGRATION_RECORD_VERSION = 2;
const snapshotFile = /^(codex|claude|telemetry)-[0-9a-f]{64}\.json$/;

export interface LegacyDataPaths {
  root: string;
  runtime: string;
}

export interface LegacyDataSource extends LegacyDataPaths {
  /** Stable key in migration.json. */
  key: "agentmap-data-root" | "agentmap-home-directory";
  /** Human-readable location for summaries (home directory abbreviated to `~`). */
  label: string;
  settings?: string;
}

export type MigrationStatus =
  "no-legacy-data" | "migrated" | "already-migrated" | "skipped-override" | "failed";

export interface MigrationRecord {
  status: "completed" | "failed";
  source: string;
  completedAt: string;
  copied: number;
  skippedExisting: number;
  ignored: number;
  settingsCopied?: boolean;
  error?: string;
}

export interface MigrationFile {
  version: number;
  sources: Partial<Record<LegacyDataSource["key"], MigrationRecord>>;
}

export interface SourceMigrationResult {
  key: LegacyDataSource["key"];
  label: string;
  status: MigrationStatus;
  copied: number;
  skippedExisting: number;
  ignored: number;
  settingsCopied?: boolean;
  error?: string;
}

export interface MigrationResult {
  status: MigrationStatus;
  copied: number;
  skippedExisting: number;
  ignored: number;
  error?: string;
  sources?: SourceMigrationResult[];
}

/** The M7.1 provisional location. */
export function legacyAgentMapDataPaths(home = homedir()): LegacyDataPaths {
  const root = join(home, ".agentmap");
  return { root, runtime: join(root, "runtime") };
}

const abbreviate = (path: string, home: string) =>
  path === home
    ? "~"
    : path.startsWith(`${home}/`) || path.startsWith(`${home}\\`)
      ? `~${path.slice(home.length)}`
      : path;

/** Every location where AgentMap-era data may exist on this machine. */
export function legacyDataSources(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): LegacyDataSource[] {
  const root = platformDataRoot(legacyAgentMapDirectoryNames, environment, platform, home);
  const dotDirectory = legacyAgentMapDataPaths(home);
  return [
    {
      key: "agentmap-data-root",
      label: abbreviate(root, home),
      root,
      runtime: join(root, "runtime"),
      settings: join(root, "settings.json"),
    },
    {
      key: "agentmap-home-directory",
      label: abbreviate(dotDirectory.runtime, home),
      ...dotDirectory,
    },
  ];
}

export function migrationRecordPath(paths: SarvadrikDataPaths) {
  return join(paths.root, "migration.json");
}

export async function readMigrationFile(paths: SarvadrikDataPaths): Promise<MigrationFile> {
  try {
    const value = JSON.parse(await readFile(migrationRecordPath(paths), "utf8")) as MigrationFile;
    if (value && typeof value === "object" && value.sources && typeof value.sources === "object")
      return value;
  } catch {
    // Missing or unreadable: nothing recorded yet.
  }
  return { version: MIGRATION_RECORD_VERSION, sources: {} };
}

export async function readMigrationRecord(
  paths: SarvadrikDataPaths,
  key: LegacyDataSource["key"] = "agentmap-home-directory",
): Promise<MigrationRecord | undefined> {
  return (await readMigrationFile(paths)).sources[key];
}

/** Counts legacy snapshot files without reading their contents. */
export async function inspectLegacyData(legacy: LegacyDataPaths) {
  try {
    const details = await lstat(legacy.runtime);
    if (!details.isDirectory()) return { present: false, snapshots: 0 };
    const names = await readdir(legacy.runtime);
    return { present: true, snapshots: names.filter((name) => snapshotFile.test(name)).length };
  } catch {
    return { present: false, snapshots: 0 };
  }
}

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function activate(staged: string, destination: string) {
  try {
    await link(staged, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw error;
    // Filesystems without hard links: exclusive copy still refuses to overwrite.
    await copyFile(staged, destination, constants.COPYFILE_EXCL);
  }
}

async function writeRecord(
  paths: SarvadrikDataPaths,
  key: LegacyDataSource["key"],
  record: MigrationRecord,
) {
  const file = await readMigrationFile(paths);
  file.version = MIGRATION_RECORD_VERSION;
  file.sources[key] = record;
  await mkdir(paths.root, { recursive: true });
  const target = migrationRecordPath(paths);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function migrateSource(
  paths: SarvadrikDataPaths,
  source: LegacyDataSource,
  now: () => Date,
): Promise<SourceMigrationResult> {
  const empty = { copied: 0, skippedExisting: 0, ignored: 0 };
  const base = { key: source.key, label: source.label };
  const record = await readMigrationRecord(paths, source.key);
  if (record?.status === "completed") return { ...base, status: "already-migrated", ...empty };
  const inspection = await inspectLegacyData(source);
  const hasSettings = source.settings ? await exists(source.settings) : false;
  if (!inspection.present && !hasSettings) return { ...base, status: "no-legacy-data", ...empty };

  const staging = join(paths.runtime, `.migration-${process.pid}-${Date.now()}`);
  const counts = { ...empty, settingsCopied: false };
  const write = (status: MigrationRecord["status"], error?: string) =>
    writeRecord(paths, source.key, {
      status,
      source: source.label,
      completedAt: now().toISOString(),
      ...counts,
      ...(error ? { error } : {}),
    });

  try {
    if (inspection.present) {
      await mkdir(staging, { recursive: true });
      for (const name of await readdir(source.runtime)) {
        const from = join(source.runtime, name);
        const details = await lstat(from);
        if (!snapshotFile.test(name) || !details.isFile()) {
          counts.ignored += 1;
          continue;
        }
        const destination = join(paths.runtime, name);
        if (await exists(destination)) {
          counts.skippedExisting += 1;
          continue;
        }
        const staged = join(staging, name);
        await copyFile(from, staged, constants.COPYFILE_EXCL);
        const [expected, actual] = await Promise.all([sha256(from), sha256(staged)]);
        if (expected !== actual) throw new Error(`Verification failed for ${name}.`);
        try {
          JSON.parse(await readFile(staged, "utf8"));
        } catch {
          // A corrupt legacy snapshot is left in place and not activated.
          await unlink(staged);
          counts.ignored += 1;
          continue;
        }
        try {
          await activate(staged, destination);
          counts.copied += 1;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          counts.skippedExisting += 1;
        }
        await unlink(staged);
      }
      await rm(staging, { recursive: true, force: true });
    }
    if (source.settings && hasSettings && !(await exists(paths.settings))) {
      const details = await lstat(source.settings);
      if (details.isFile()) {
        await mkdir(paths.root, { recursive: true });
        try {
          await copyFile(source.settings, paths.settings, constants.COPYFILE_EXCL);
          counts.settingsCopied = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
    }
    await write("completed");
    return { ...base, status: "migrated", ...counts };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    const message = error instanceof Error ? error.message : "Unknown migration error.";
    await write("failed", message).catch(() => {});
    return { ...base, status: "failed", ...counts, error: message };
  }
}

export async function migrateLegacyData(options: {
  paths: SarvadrikDataPaths;
  /** One explicit M7.1-style source (tests); defaults to every legacy source on this machine. */
  legacy?: LegacyDataPaths;
  sources?: LegacyDataSource[];
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  sourceLabel?: string;
}): Promise<MigrationResult> {
  const environment = options.environment ?? process.env;
  const empty = { copied: 0, skippedExisting: 0, ignored: 0 };
  const explicit =
    options.sources ??
    (options.legacy
      ? [
          {
            key: "agentmap-home-directory" as const,
            label: options.sourceLabel ?? "~/.agentmap/runtime",
            ...options.legacy,
          },
        ]
      : undefined);
  // An explicit data-root override (development, tests, CI) is an isolated location; never
  // pull a developer's personal legacy data into it implicitly.
  if (!explicit && (environment.SARVADRIK_DATA_ROOT || environment.SARVADRIK_DATA_DIR))
    return { status: "skipped-override", ...empty };
  const sources = explicit ?? legacyDataSources(environment);
  const now = options.now ?? (() => new Date());
  const results: SourceMigrationResult[] = [];
  for (const source of sources) results.push(await migrateSource(options.paths, source, now));
  const sum = (field: "copied" | "skippedExisting" | "ignored") =>
    results.reduce((total, result) => total + result[field], 0);
  const failed = results.find((result) => result.status === "failed");
  const status: MigrationStatus = failed
    ? "failed"
    : results.some((result) => result.status === "migrated")
      ? "migrated"
      : results.some((result) => result.status === "already-migrated")
        ? "already-migrated"
        : "no-legacy-data";
  return {
    status,
    copied: sum("copied"),
    skippedExisting: sum("skippedExisting"),
    ignored: sum("ignored"),
    ...(failed?.error ? { error: failed.error } : {}),
    sources: results,
  };
}
