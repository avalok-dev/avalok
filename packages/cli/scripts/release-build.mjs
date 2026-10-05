#!/usr/bin/env node
// Neutral-path release build.
//
//   pnpm release:build [--root <directory>] [--python <python>] [--publishable] [--skip-smoke] [--keep]
//
// This is the only supported source of release artifacts. `--publishable` (the release workflow)
// omits `private: true`; the resulting tarball is smoke-tested as-is, hashed before and after the
// smoke test, and described by artifacts/release/release-provenance.json.
//
// 1. Copies the checkout's source (tracked files plus untracked, non-ignored files, so local
//    work is included; never node_modules/dist/.next/artifacts) into a fresh temporary
//    directory whose path contains spaces and has no relation to the developer's checkout,
//    home directory, or username.
// 2. Installs with the frozen lockfile, then runs `dist:build` and `dist:pack` there.
// 3. Scans the unpacked package for build-machine path leaks: the developer's home directory,
//    the original checkout path, and the username as a path segment. Any hit fails the build.
//    Occurrences of the neutral build root itself are reported (Next.js keeps module path
//    labels in its server output); they reveal nothing about the build machine.
// 4. Runs the installed-product smoke test (including the packaged security checks) against
//    the neutral tarball, hiding the neutral checkout on POSIX.
// 5. Copies the tarball to <checkout>/artifacts/release/ and prints a summary.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const argumentsList = process.argv.slice(2);
const flag = (name) => argumentsList.includes(name);
const option = (name) => {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
};
const windows = process.platform === "win32";

const log = (message) => process.stdout.write(`• ${message}\n`);
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

// Prefer the pnpm that launched this script (works without a shell on every OS).
function pnpm(arguments_, cwd) {
  const execPath = process.env.npm_execpath;
  const [command, prefix, shell] =
    execPath && /pnpm/i.test(basename(execPath))
      ? [process.execPath, [execPath], false]
      : [windows ? "pnpm.cmd" : "pnpm", [], windows];
  const result = spawnSync(command, [...prefix, ...arguments_], {
    cwd,
    stdio: "inherit",
    shell,
    env: { ...process.env, CI: "true", NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.status !== 0)
    throw new Error(`pnpm ${arguments_.join(" ")} failed (${result.status}).`);
}

function sourceFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: checkout,
      encoding: "buffer",
    },
  );
  if (result.status !== 0) throw new Error("git ls-files failed; run from a git checkout.");
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((path) => existsSync(join(checkout, path)));
}

const textExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".txt",
  ".md",
  ".map",
  ".rsc",
  ".body",
  ".meta",
  "",
]);

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/** Raw and JSON-escaped spellings (Windows paths appear as `C:\\Users\\…` inside JS strings). */
function spellings(value) {
  const forward = value.replaceAll("\\", "/");
  return [...new Set([value, forward, JSON.stringify(value).slice(1, -1)])];
}

function scanForLeaks(directory, { forbidden, reported }) {
  const leaks = [];
  const reportedFiles = new Set();
  let scanned = 0;
  for (const file of walk(directory)) {
    if (!textExtensions.has(extname(file)) || statSync(file).size > 20 * 1024 * 1024) continue;
    const text = readFileSync(file, "utf8");
    scanned += 1;
    for (const { label, value } of forbidden)
      if (spellings(value).some((spelling) => text.includes(spelling)))
        leaks.push(`${label}: ${file.slice(directory.length + 1)}`);
    if (reported && spellings(reported).some((spelling) => text.includes(spelling)))
      reportedFiles.add(file.slice(directory.length + 1));
  }
  return { leaks, reportedFiles: [...reportedFiles].sort(), scanned };
}

// `--root` picks the parent directory (Windows CI passes RUNNER_TEMP, which is on another drive
// than the user profile); the default is the OS temporary directory.
const parent = resolve(option("--root") ?? tmpdir());
mkdirSync(parent, { recursive: true });
const scratch = mkdtempSync(join(parent, "avalok-release-"));
const neutralRoot = join(scratch, "Avalok Release Test");
const source = join(neutralRoot, "source");
try {
  const home = resolve(homedir());
  if (source.startsWith(home + sep))
    throw new Error(`${parent} is inside the home directory; pass --root <directory>.`);
  log(`Neutral build root: ${source}`);

  const files = sourceFiles();
  for (const file of files) {
    const destination = join(source, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(checkout, file), destination);
  }
  log(`Copied ${files.length} source files (tracked + untracked, never ignored output)`);

  pnpm(["install", "--frozen-lockfile", "--prefer-offline"], source);
  pnpm(["dist:build", ...(flag("--publishable") ? ["--publishable"] : [])], source);
  pnpm(["dist:pack"], source);

  const packageDirectory = join(source, "packages", "cli", "dist");
  const username = userInfo().username;
  const forbidden = [
    { label: "home directory", value: home },
    { label: "original checkout", value: checkout },
    ...(username && username.length > 2
      ? [
          { label: "username path segment", value: `${sep}${username}${sep}` },
          { label: "username path segment", value: `/${username}/` },
        ]
      : []),
  ];
  const { leaks, reportedFiles, scanned } = scanForLeaks(packageDirectory, {
    forbidden,
    reported: source,
  });
  log(`Scanned ${scanned} text files in the unpacked package`);
  if (leaks.length) {
    process.stdout.write(`${leaks.join("\n")}\n`);
    throw new Error(`${leaks.length} build-machine path leak(s) found.`);
  }
  log("No home directory, username, or original checkout path in the package");
  log(
    `Neutral build root appears as Next.js module labels in ${reportedFiles.length} file(s)` +
      (reportedFiles.length ? ` (e.g. ${reportedFiles.slice(0, 3).join(", ")})` : ""),
  );

  const artifacts = join(source, "artifacts");
  const tarball = readdirSync(artifacts).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("No tarball was produced.");
  const released = join(checkout, "artifacts", "release");
  // Only this build's artifact may sit in artifacts/release.
  rmSync(released, { recursive: true, force: true });
  mkdirSync(released, { recursive: true });
  cpSync(join(artifacts, tarball), join(released, tarball));
  const digest = sha256(join(released, tarball));
  log(
    `Tarball: ${join("artifacts", "release", tarball)} (${(statSync(join(released, tarball)).size / 1024 / 1024).toFixed(2)} MB)`,
  );

  if (!flag("--skip-smoke")) {
    const smokeArguments = [
      join(source, "packages", "cli", "scripts", "smoke-installed.mjs"),
      "--tarball",
      join(released, tarball),
      // Windows keeps files open, so the checkout cannot be renamed there.
      ...(windows ? [] : ["--hide-workspace"]),
      ...(option("--python") ? ["--python", option("--python")] : []),
    ];
    const smoke = spawnSync(process.execPath, smokeArguments, { cwd: scratch, stdio: "inherit" });
    if (smoke.status !== 0) throw new Error("Installed-product smoke test failed.");
    if (sha256(join(released, tarball)) !== digest)
      throw new Error("The tarball changed during the smoke test; refusing to record it.");
  }
  const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  const git = (...arguments_) =>
    spawnSync("git", arguments_, { cwd: checkout, encoding: "utf8" }).stdout?.trim() ?? "";
  writeFileSync(join(released, `${tarball}.sha256`), `${digest}  ${tarball}\n`);
  writeFileSync(
    join(released, "release-provenance.json"),
    `${JSON.stringify(
      {
        package: manifest.name,
        version: manifest.version,
        publishable: manifest.private !== true,
        tarball,
        sha256: digest,
        sizeBytes: statSync(join(released, tarball)).size,
        gitCommit: git("rev-parse", "HEAD"),
        gitDirty: git("status", "--porcelain").length > 0,
        builtAt: new Date().toISOString(),
        builder: `release:build on ${process.platform}-${process.arch}, Node ${process.versions.node}`,
        buildRoot: "neutral temporary directory (see docs/development/release-build.md)",
        pathLeakScan: "passed",
        installedSmoke: flag("--skip-smoke") ? "skipped" : "passed",
      },
      null,
      2,
    )}\n`,
  );
  log(
    `SHA-256 ${digest}${manifest.private === true ? " (private build)" : " (publishable build)"}`,
  );
  log("Neutral-path release build passed");
} finally {
  if (flag("--keep")) log(`Kept: ${neutralRoot}`);
  else rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
