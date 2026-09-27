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
import type { AgentMapDataPaths } from "./index.ts";

// Migration from the provisional M7.1 location `~/.agentmap/runtime` into the stable
// platform data root. Strategy: copy → verify → activate, one snapshot at a time.
//   - Only AgentMap runtime snapshot files (`<source>-<sha256>.json`) are considered.
//   - Symlinks and anything else in the legacy directory are ignored.
//   - A destination file that already exists is never overwritten (newer data wins).
//   - Activation is an exclusive hard link (or exclusive copy) so a concurrent writer is never
//     clobbered and readers never observe a partial file.
//   - The legacy directory is never modified or deleted.
//   - The outcome is recorded in `<root>/migration.json`; a completed record makes later runs
//     a no-op, and a failed record is retried on the next start.

export const MIGRATION_RECORD_VERSION = 1;
const snapshotFile = /^(codex|claude|telemetry)-[0-9a-f]{64}\.json$/;

export interface LegacyDataPaths {
  root: string;
  runtime: string;
}

export type MigrationStatus =
  "no-legacy-data" | "migrated" | "already-migrated" | "skipped-override" | "failed";

export interface MigrationRecord {
  version: number;
  status: "completed" | "failed";
  source: string;
  completedAt: string;
  copied: number;
  skippedExisting: number;
  ignored: number;
  error?: string;
}

export interface MigrationResult {
  status: MigrationStatus;
  copied: number;
  skippedExisting: number;
  ignored: number;
  error?: string;
}

export function legacyAgentMapDataPaths(home = homedir()): LegacyDataPaths {
  const root = join(home, ".agentmap");
  return { root, runtime: join(root, "runtime") };
}

export function migrationRecordPath(paths: AgentMapDataPaths) {
  return join(paths.root, "migration.json");
}

export async function readMigrationRecord(
  paths: AgentMapDataPaths,
): Promise<MigrationRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(migrationRecordPath(paths), "utf8")) as MigrationRecord;
    return value && typeof value === "object" && typeof value.status === "string"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
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

export async function migrateLegacyData(options: {
  paths: AgentMapDataPaths;
  legacy?: LegacyDataPaths;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  sourceLabel?: string;
}): Promise<MigrationResult> {
  const environment = options.environment ?? process.env;
  const legacy = options.legacy ?? legacyAgentMapDataPaths();
  const empty = { copied: 0, skippedExisting: 0, ignored: 0 };
  // An explicit data-root override (development, tests, CI) is an isolated location; never
  // pull a developer's personal legacy data into it implicitly.
  if (!options.legacy && (environment.AGENTMAP_DATA_ROOT || environment.AGENTMAP_DATA_DIR))
    return { status: "skipped-override", ...empty };
  const record = await readMigrationRecord(options.paths);
  if (record?.status === "completed") return { status: "already-migrated", ...empty };
  const inspection = await inspectLegacyData(legacy);
  if (!inspection.present) return { status: "no-legacy-data", ...empty };

  const staging = join(options.paths.runtime, `.migration-${process.pid}-${Date.now()}`);
  const counts = { ...empty };
  const write = async (status: MigrationRecord["status"], error?: string) => {
    const value: MigrationRecord = {
      version: MIGRATION_RECORD_VERSION,
      status,
      source: options.sourceLabel ?? "~/.agentmap/runtime",
      completedAt: (options.now ?? (() => new Date()))().toISOString(),
      ...counts,
      ...(error ? { error } : {}),
    };
    await mkdir(options.paths.root, { recursive: true });
    const target = migrationRecordPath(options.paths);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  };

  try {
    await mkdir(staging, { recursive: true });
    for (const name of await readdir(legacy.runtime)) {
      const source = join(legacy.runtime, name);
      const details = await lstat(source);
      if (!snapshotFile.test(name) || !details.isFile()) {
        counts.ignored += 1;
        continue;
      }
      const destination = join(options.paths.runtime, name);
      if (await exists(destination)) {
        counts.skippedExisting += 1;
        continue;
      }
      const staged = join(staging, name);
      await copyFile(source, staged, constants.COPYFILE_EXCL);
      const [expected, actual] = await Promise.all([sha256(source), sha256(staged)]);
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
    await write("completed");
    return { status: "migrated", ...counts };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    const message = error instanceof Error ? error.message : "Unknown migration error.";
    await write("failed", message).catch(() => {});
    return { status: "failed", ...counts, error: message };
  }
}
