import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { transform } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

// Next's production build runs @vercel/nft over every dashboard server module. nft evaluates
// `os.homedir()` with the real `os` module and globs any resulting directory path. It skips
// paths outside the tracing root only when `path.relative` starts with `..`, which is false on
// Windows when the checkout and the home directory are on different drives (CI: D:\ vs C:\).
// M7.3's Windows distribution build failed exactly this way (EPERM on the home directory),
// and a successful glob would have traced private files such as ~/.codex sessions.
//
// Tracing with base "/" reproduces that condition on every OS: the fake home is "inside" the
// root, so any home-derived static path becomes a glob this test can observe.

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const requireFromCli = createRequire(import.meta.url);
const nft = createRequire(requireFromCli.resolve("next/package.json"))(
  "next/dist/compiled/@vercel/nft",
) as {
  nodeFileTrace: (
    files: string[],
    options: Record<string, unknown>,
  ) => Promise<{ fileList: Set<string> }>;
};

const dashboardSources = [
  "apps/web/src",
  ...[
    "analyzer",
    "capabilities",
    "codex-adapter",
    "graph",
    "local-security",
    "reconcile",
    "replay",
    "runtime-adapter",
    "schema",
    "telemetry-adapter",
    "ui",
  ].map((name) => `packages/${name}/src`),
];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return Promise.resolve(/\.tsx?$/.test(entry.name) ? [path] : []);
    }),
  );
  return nested.flat();
}

const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("dashboard build tracing", () => {
  it("never globs the build machine's home directory or private agent data", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "avalok-trace-"));
    const home = join(scratch, "home");
    await mkdir(join(home, ".codex", "sessions"), { recursive: true });
    await mkdir(join(home, "Documents"), { recursive: true });
    await writeFile(join(home, ".codex", "sessions", "rollout.jsonl"), "{}\n");
    await writeFile(join(home, "Documents", "private.txt"), "private\n");

    // Transpile 1:1 (CommonJS, bare builtins), roughly what Next hands the tracer.
    const output = join(scratch, "sources");
    const files: string[] = [];
    for (const directory of dashboardSources)
      for (const source of await sourceFiles(join(repositoryRoot, directory))) {
        const { code } = await transform(await readFile(source, "utf8"), {
          loader: source.endsWith(".tsx") ? "tsx" : "ts",
          format: "cjs",
        });
        const destination = join(
          output,
          relative(repositoryRoot, source).replace(/\.tsx?$/, ".cjs"),
        );
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(
          destination,
          code.replace(/"node:(\w+)"/g, (_match, name: string) => JSON.stringify(name)),
        );
        files.push(destination);
      }

    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const { fileList } = await nft.nodeFileTrace(files, {
      base: "/",
      processCwd: join(output, "apps/web"),
      ignore: (path: string) => path.includes("node_modules"),
    });
    const traced = [...fileList].map((path) => resolve("/", path));
    // nft reports real paths (macOS temp directories live behind the /var symlink).
    const realHome = await realpath(home);
    expect(traced.filter((path) => path.startsWith(realHome) || path.startsWith(home))).toEqual([]);
    expect(traced.filter((path) => /[\\/]\.claude[\\/]settings/.test(path))).toEqual([]);
  }, 60_000);
});
