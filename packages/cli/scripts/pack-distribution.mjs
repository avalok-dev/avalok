#!/usr/bin/env node
// Packs `packages/cli/dist/` into a local tarball under `<repository>/artifacts/`.
// This never publishes: the generated manifest is private and only `npm pack` is used.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(cliRoot, "../..");
const distribution = join(cliRoot, "dist");
const destination = join(repositoryRoot, "artifacts");

if (!existsSync(join(distribution, "package.json"))) {
  process.stderr.write("No distribution found. Run `pnpm dist:build` first.\n");
  process.exit(1);
}
mkdirSync(destination, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// Windows runs npm.cmd through a shell, which would split an absolute destination containing
// spaces; the relative path from the package directory has none.
const result = spawnSync(
  npm,
  ["pack", "--json", "--pack-destination", relative(distribution, destination)],
  {
    cwd: distribution,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, npm_config_ignore_scripts: "true" },
  },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const [packed] = JSON.parse(result.stdout);
const tarball = join(destination, packed.filename);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
process.stdout.write(
  [
    `Tarball:        ${relative(process.cwd(), tarball) || tarball}`,
    `Package:        ${packed.name}@${packed.version}`,
    `Packed size:    ${mb(statSync(tarball).size)}`,
    `Unpacked size:  ${mb(packed.unpackedSize)}`,
    `Files:          ${packed.entryCount}`,
    "",
  ].join("\n"),
);
