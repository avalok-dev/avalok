import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  sarvadrikDataPaths,
  clearSarvadrikData,
  inspectLegacyData,
  legacyAgentMapDataPaths,
  legacyDataSources,
  migrateLegacyData,
  readMigrationFile,
  readMigrationRecord,
} from "../src";

const snapshotName = (source: string, seed: string) =>
  `${source}-${createHash("sha256").update(seed).digest("hex")}.json`;

async function fixture() {
  const scratch = await mkdtemp(join(tmpdir(), "sarvadrik migration "));
  const home = join(scratch, "home");
  const legacy = legacyAgentMapDataPaths(home);
  const paths = sarvadrikDataPaths({ SARVADRIK_DATA_DIR: join(scratch, "New Data Root") });
  await mkdir(legacy.runtime, { recursive: true });
  const first = snapshotName("telemetry", "one");
  const second = snapshotName("claude", "two");
  await writeFile(join(legacy.runtime, first), '{"run":"legacy-one"}\n');
  await writeFile(join(legacy.runtime, second), '{"run":"legacy-two"}\n');
  return { scratch, home, legacy, paths, first, second };
}

describe("legacy data migration", () => {
  it("uses ~/.agentmap/runtime as the provisional M7.1 location", () => {
    // Host path semantics: the legacy directory lives beside the user's real home directory.
    expect(legacyAgentMapDataPaths("/home/test")).toEqual({
      root: join("/home/test", ".agentmap"),
      runtime: join("/home/test", ".agentmap", "runtime"),
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
    await writeFile(join(legacy.runtime, "notes.txt"), "not sarvadrik\n");
    await symlink(outside, join(legacy.runtime, snapshotName("telemetry", "link")));
    await writeFile(join(legacy.runtime, snapshotName("telemetry", "corrupt")), "{not json");
    const result = await migrateLegacyData({ paths, legacy });
    expect(result).toMatchObject({ status: "migrated", copied: 2, ignored: 3 });
    expect(await readdir(paths.runtime)).toHaveLength(2);
  });

  it("records failure, keeps legacy data, and retries on the next run", async () => {
    const { scratch, legacy, paths, first } = await fixture();
    const blocked = sarvadrikDataPaths({ SARVADRIK_DATA_DIR: join(scratch, "blocked") });
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
      await migrateLegacyData({ paths, environment: { SARVADRIK_DATA_DIR: paths.root } }),
    ).toMatchObject({ status: "skipped-override" });
    expect(await inspectLegacyData(legacyAgentMapDataPaths(join(scratch, "empty")))).toEqual({
      present: false,
      snapshots: 0,
    });
  });

  it("keeps data clearing inside the new root and never re-imports cleared legacy runs", async () => {
    const { legacy, paths, first } = await fixture();
    await migrateLegacyData({ paths, legacy });
    await clearSarvadrikData(paths);
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
    await clearSarvadrikData(paths);
    expect(await readFile(join(external, "keep.txt"), "utf8")).toBe("keep\n");
  });

  it("names the former AgentMap platform root and the M7.1 directory on every platform", () => {
    const [darwin] = legacyDataSources({}, "darwin", "/Users/test");
    expect(darwin).toMatchObject({
      key: "agentmap-data-root",
      label: "~/Library/Application Support/AgentMap",
      root: "/Users/test/Library/Application Support/AgentMap",
    });
    expect(legacyDataSources({}, "linux", "/home/test")[0]?.root).toBe(
      "/home/test/.local/share/agentmap",
    );
    expect(legacyDataSources({ XDG_DATA_HOME: "/xdg" }, "linux", "/home/test")[0]?.root).toBe(
      "/xdg/agentmap",
    );
    expect(
      legacyDataSources(
        { LOCALAPPDATA: "C:\\Users\\T\\AppData\\Local" },
        "win32",
        "C:\\Users\\T",
      )[0]?.root,
    ).toBe("C:\\Users\\T\\AppData\\Local\\AgentMap");
    expect(legacyDataSources({}, "linux", "/home/test")[1]).toMatchObject({
      key: "agentmap-home-directory",
      runtime: join("/home/test", ".agentmap", "runtime"),
    });
  });

  it("migrates both AgentMap sources and settings idempotently without touching originals", async () => {
    const { scratch, home, legacy, paths, first } = await fixture();
    const agentMapRoot = join(scratch, "AgentMap Root");
    const third = snapshotName("codex", "three");
    await mkdir(join(agentMapRoot, "runtime"), { recursive: true });
    await writeFile(join(agentMapRoot, "runtime", third), '{"run":"platform-three"}\n');
    // Same snapshot in both sources: the first source wins, the second skips it.
    await writeFile(join(agentMapRoot, "runtime", first), '{"run":"platform-one"}\n');
    await writeFile(join(agentMapRoot, "settings.json"), '{"gettingStartedDismissed":true}\n');
    const sources = [
      {
        key: "agentmap-data-root" as const,
        label: "AgentMap Root",
        root: agentMapRoot,
        runtime: join(agentMapRoot, "runtime"),
        settings: join(agentMapRoot, "settings.json"),
      },
      { key: "agentmap-home-directory" as const, label: "~/.agentmap/runtime", ...legacy },
    ];
    const result = await migrateLegacyData({ paths, sources });
    expect(result).toMatchObject({ status: "migrated", copied: 3, skippedExisting: 1 });
    expect(result.sources?.map((source) => [source.key, source.status, source.copied])).toEqual([
      ["agentmap-data-root", "migrated", 2],
      ["agentmap-home-directory", "migrated", 1],
    ]);
    expect(result.sources?.[0]?.settingsCopied).toBe(true);
    expect(await readFile(paths.settings, "utf8")).toBe('{"gettingStartedDismissed":true}\n');
    expect(await readFile(join(paths.runtime, first), "utf8")).toBe('{"run":"platform-one"}\n');
    expect(await readFile(join(agentMapRoot, "runtime", third), "utf8")).toBe(
      '{"run":"platform-three"}\n',
    );
    expect(await readFile(join(agentMapRoot, "settings.json"), "utf8")).toContain("true");
    const file = await readMigrationFile(paths);
    expect(Object.keys(file.sources).sort()).toEqual([
      "agentmap-data-root",
      "agentmap-home-directory",
    ]);
    expect(await migrateLegacyData({ paths, sources })).toMatchObject({
      status: "already-migrated",
      copied: 0,
    });
    expect(home).toBeTruthy();
  });

  it("never overwrites existing Sarvadrik settings", async () => {
    const { scratch, paths } = await fixture();
    const agentMapRoot = join(scratch, "AgentMap Root");
    await mkdir(agentMapRoot, { recursive: true });
    await writeFile(join(agentMapRoot, "settings.json"), '{"gettingStartedDismissed":true}\n');
    await mkdir(paths.root, { recursive: true });
    await writeFile(paths.settings, '{"gettingStartedDismissed":false}\n');
    const result = await migrateLegacyData({
      paths,
      sources: [
        {
          key: "agentmap-data-root",
          label: "AgentMap Root",
          root: agentMapRoot,
          runtime: join(agentMapRoot, "runtime"),
          settings: join(agentMapRoot, "settings.json"),
        },
      ],
    });
    expect(result.status).toBe("migrated");
    expect(result.sources?.[0]?.settingsCopied).toBe(false);
    expect(await readFile(paths.settings, "utf8")).toContain("false");
  });
});
