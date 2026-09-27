import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentMapDataPaths,
  clearAgentMapData,
  inspectLegacyData,
  legacyAgentMapDataPaths,
  migrateLegacyData,
  readMigrationRecord,
} from "../src";

const snapshotName = (source: string, seed: string) =>
  `${source}-${createHash("sha256").update(seed).digest("hex")}.json`;

async function fixture() {
  const scratch = await mkdtemp(join(tmpdir(), "agentmap migration "));
  const home = join(scratch, "home");
  const legacy = legacyAgentMapDataPaths(home);
  const paths = agentMapDataPaths({ AGENTMAP_DATA_DIR: join(scratch, "New Data Root") });
  await mkdir(legacy.runtime, { recursive: true });
  const first = snapshotName("telemetry", "one");
  const second = snapshotName("claude", "two");
  await writeFile(join(legacy.runtime, first), '{"run":"legacy-one"}\n');
  await writeFile(join(legacy.runtime, second), '{"run":"legacy-two"}\n');
  return { scratch, home, legacy, paths, first, second };
}

describe("legacy data migration", () => {
  it("uses ~/.agentmap/runtime as the provisional M7.1 location", () => {
    expect(legacyAgentMapDataPaths("/home/test")).toEqual({
      root: "/home/test/.agentmap",
      runtime: "/home/test/.agentmap/runtime",
    });
  });

  it("copies, verifies, and activates snapshots without touching the legacy copy", async () => {
    const { legacy, paths, first, second } = await fixture();
    const result = await migrateLegacyData({ paths, legacy });
    expect(result).toMatchObject({ status: "migrated", copied: 2, skippedExisting: 0 });
    expect(await readFile(join(paths.runtime, first), "utf8")).toBe('{"run":"legacy-one"}\n');
    expect(await readFile(join(legacy.runtime, second), "utf8")).toBe('{"run":"legacy-two"}\n');
    expect((await readdir(legacy.runtime)).sort()).toEqual([first, second].sort());
    expect((await readdir(paths.runtime)).filter((name) => name.startsWith("."))).toEqual([]);
    expect(await readMigrationRecord(paths)).toMatchObject({ status: "completed", copied: 2 });
  });

  it("is idempotent", async () => {
    const { legacy, paths } = await fixture();
    await migrateLegacyData({ paths, legacy });
    expect(await migrateLegacyData({ paths, legacy })).toMatchObject({
      status: "already-migrated",
      copied: 0,
    });
    expect(await readdir(paths.runtime)).toHaveLength(2);
  });

  it("never overwrites newer data already in the new location", async () => {
    const { legacy, paths, first } = await fixture();
    await mkdir(paths.runtime, { recursive: true });
    await writeFile(join(paths.runtime, first), '{"run":"newer"}\n');
    const result = await migrateLegacyData({ paths, legacy });
    expect(result).toMatchObject({ status: "migrated", copied: 1, skippedExisting: 1 });
    expect(await readFile(join(paths.runtime, first), "utf8")).toBe('{"run":"newer"}\n');
  });

  it("ignores unrelated files, symlinks, and corrupt snapshots", async () => {
    const { scratch, legacy, paths } = await fixture();
    const outside = join(scratch, "outside.json");
    await writeFile(outside, "secret\n");
    await writeFile(join(legacy.runtime, "notes.txt"), "not agentmap\n");
    await symlink(outside, join(legacy.runtime, snapshotName("telemetry", "link")));
    await writeFile(join(legacy.runtime, snapshotName("telemetry", "corrupt")), "{not json");
    const result = await migrateLegacyData({ paths, legacy });
    expect(result).toMatchObject({ status: "migrated", copied: 2, ignored: 3 });
    expect(await readdir(paths.runtime)).toHaveLength(2);
  });

  it("records failure, keeps legacy data, and retries on the next run", async () => {
    const { scratch, legacy, paths, first } = await fixture();
    const blocked = agentMapDataPaths({ AGENTMAP_DATA_DIR: join(scratch, "blocked") });
    await mkdir(blocked.root, { recursive: true });
    await writeFile(blocked.runtime, "a file where the runtime directory should be");
    const failed = await migrateLegacyData({ paths: blocked, legacy });
    expect(failed.status).toBe("failed");
    expect(await readMigrationRecord(blocked)).toMatchObject({ status: "failed" });
    expect(await readFile(join(legacy.runtime, first), "utf8")).toBe('{"run":"legacy-one"}\n');
    // A healthy location migrates normally afterwards.
    expect((await migrateLegacyData({ paths, legacy })).status).toBe("migrated");
  });

  it("leaves partially unreadable legacy data in place", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const { legacy, paths, second } = await fixture();
    await chmod(join(legacy.runtime, second), 0o000);
    const result = await migrateLegacyData({ paths, legacy });
    await chmod(join(legacy.runtime, second), 0o600);
    expect(result.status).toBe("failed");
    expect(await readFile(join(legacy.runtime, second), "utf8")).toBe('{"run":"legacy-two"}\n');
    expect((await migrateLegacyData({ paths, legacy })).status).toBe("migrated");
  });

  it("does nothing without legacy data or under an explicit data-root override", async () => {
    const { scratch, paths } = await fixture();
    expect(
      await migrateLegacyData({ paths, legacy: legacyAgentMapDataPaths(join(scratch, "empty")) }),
    ).toMatchObject({ status: "no-legacy-data" });
    expect(
      await migrateLegacyData({ paths, environment: { AGENTMAP_DATA_DIR: paths.root } }),
    ).toMatchObject({ status: "skipped-override" });
    expect(await inspectLegacyData(legacyAgentMapDataPaths(join(scratch, "empty")))).toEqual({
      present: false,
      snapshots: 0,
    });
  });

  it("keeps data clearing inside the new root and never re-imports cleared legacy runs", async () => {
    const { legacy, paths, first } = await fixture();
    await migrateLegacyData({ paths, legacy });
    await clearAgentMapData(paths);
    expect(await readFile(join(legacy.runtime, first), "utf8")).toBe('{"run":"legacy-one"}\n');
    expect(await migrateLegacyData({ paths, legacy })).toMatchObject({
      status: "already-migrated",
    });
    await expect(readdir(paths.runtime)).rejects.toThrow();
  });

  it("clears a symlinked runtime directory without following it", async () => {
    const { scratch, paths } = await fixture();
    const external = join(scratch, "external data");
    await mkdir(external);
    await writeFile(join(external, "keep.txt"), "keep\n");
    await mkdir(paths.root, { recursive: true });
    await symlink(external, paths.runtime);
    await clearAgentMapData(paths);
    expect(await readFile(join(external, "keep.txt"), "utf8")).toBe("keep\n");
  });
});
