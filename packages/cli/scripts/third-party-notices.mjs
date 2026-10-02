// Generates THIRD_PARTY_NOTICES.md for the installable package from authoritative metadata.
//
// Inputs are the exact files that ship inside the package's JavaScript:
//   - the esbuild metafile of lib/cli.mjs (CLI, collector, analyzers, adapters), and
//   - the module manifests recorded by apps/web/next.config.ts while building the dashboard
//     (every module webpack bundled into .next/server and .next/static).
// Each file is mapped to its nearest named package.json inside node_modules; workspace source
// (Avalok's own code) is excluded. License identifiers come from package.json and license
// texts from the package's own LICENSE/LICENCE/COPYING/NOTICE files. Nothing is written by hand.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

const licenseFile = /^(licen[sc]e|copying|notice)([.-].*)?$/i;

const vendoredMarker = `${sep}next${sep}dist${sep}compiled${sep}`;

function readManifest(directory) {
  const manifestPath = join(directory, "package.json");
  return existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : undefined;
}

function packageFor(file) {
  if (!file.includes(`${sep}node_modules${sep}`)) return undefined;
  let directory = dirname(file);
  while (directory.includes(`${sep}node_modules${sep}`)) {
    const manifest = readManifest(directory);
    if (typeof manifest?.name === "string" && manifest.name) {
      // Next.js ships precompiled copies of some packages under next/dist/compiled with stub
      // manifests (often no version); attribute them to the Next.js release that vendors them.
      const vendored = directory.lastIndexOf(vendoredMarker);
      const vendoredBy =
        vendored === -1 ? undefined : readManifest(directory.slice(0, vendored + sep.length + 4));
      return { directory, manifest, vendoredBy };
    }
    directory = dirname(directory);
  }
  return undefined;
}

function licenseId(manifest) {
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license && typeof manifest.license.type === "string") return manifest.license.type;
  if (Array.isArray(manifest.licenses))
    return manifest.licenses.map((item) => item.type ?? item).join(" OR ");
  return "UNKNOWN";
}

function repositoryUrl(manifest) {
  const repository = manifest.repository;
  const url = typeof repository === "string" ? repository : repository?.url;
  if (!url) return manifest.homepage;
  // npm shorthand: "owner/repo" means GitHub.
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  return url
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^github:/, "https://github.com/")
    .replace(/^git:\/\//, "https://");
}

function licenseTexts(directory) {
  return readdirSync(directory)
    .filter((name) => licenseFile.test(name) && statSync(join(directory, name)).isFile())
    .sort()
    .map((name) => ({ name, text: readFileSync(join(directory, name), "utf8").trim() }));
}

/** Distinct third-party packages (name@version) whose files appear in `files`. */
export function collectPackages(files, { exclude = () => false } = {}) {
  const packages = new Map();
  for (const file of files) {
    const found = packageFor(resolve(file));
    if (!found || exclude(found.manifest.name)) continue;
    const version =
      found.manifest.version ??
      (found.vendoredBy ? `vendored in next@${found.vendoredBy.version}` : "unversioned");
    const key = `${found.manifest.name}@${version}`;
    const texts = licenseTexts(found.directory);
    const declared = licenseId(found.manifest);
    const entry = packages.get(key) ?? {
      name: found.manifest.name,
      version,
      license: declared === "UNKNOWN" && texts.length ? "see license text" : declared,
      repository:
        repositoryUrl(found.manifest) ??
        (found.vendoredBy ? repositoryUrl(found.vendoredBy) : undefined),
      directory: found.directory,
      texts,
      usedBy: new Set(),
    };
    packages.set(key, entry);
  }
  return packages;
}

export function mergePackages(target, source, usedBy) {
  for (const [key, entry] of source) {
    const existing = target.get(key) ?? { ...entry, usedBy: new Set() };
    existing.usedBy.add(usedBy);
    target.set(key, existing);
  }
  return target;
}

/** Renders the notices file; returns the text and packages whose archives lack license text. */
export function renderNotices(packages, { product, runtimeDependencies = [] }) {
  const sorted = [...packages.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
  const missingText = sorted.filter((entry) => entry.texts.length === 0);
  // Weak/strong copyleft components get an explicit source-availability statement. Avalok
  // applies no patches to dependencies (no pnpm patchedDependencies), so every component ships
  // exactly as published.
  const copyleft = sorted.filter((entry) => /\b(EPL|MPL|LGPL|GPL|CDDL|EUPL)\b/.test(entry.license));
  const lines = [
    `# Third-party notices for ${product.displayName}`,
    "",
    `${product.displayName} is licensed under the Apache License 2.0 (see LICENSE). This package also`,
    "contains the third-party software listed below, bundled into `lib/cli.mjs` (CLI, receiver,",
    "analyzers) and `dashboard/` (compiled web dashboard). Each component remains under its own",
    "license, reproduced from the component's published package. Generated by",
    "`packages/cli/scripts/third-party-notices.mjs` during `pnpm dist:build`; do not edit by hand.",
    "",
    ...(copyleft.length
      ? [
          "## Copyleft-licensed components",
          "",
          "The following components are distributed unmodified, compiled into this package's",
          "JavaScript, under the licenses shown (full texts below). Their complete corresponding",
          "source code is available from the listed repositories and from the npm registry at the",
          "exact versions listed.",
          "",
          ...copyleft.map(
            (entry) =>
              `- ${entry.name} ${entry.version}: ${entry.license}. Source: ${entry.repository ?? `https://www.npmjs.com/package/${entry.name}/v/${entry.version}`}`,
          ),
          "",
        ]
      : []),
    "## Components",
    "",
    "| Package | Version | License | Included in | Source |",
    "| ------- | ------- | ------- | ----------- | ------ |",
    ...sorted.map(
      (entry) =>
        `| ${entry.name} | ${entry.version} | ${entry.license} | ${[...entry.usedBy].sort().join(", ")} | ${entry.repository ?? ""} |`,
    ),
    "",
  ];
  if (runtimeDependencies.length)
    lines.push(
      "## Runtime dependencies installed separately",
      "",
      "npm installs these alongside Avalok from their own published packages, which carry",
      "their own license files:",
      "",
      ...runtimeDependencies.map((entry) => `- ${entry.name} ${entry.version} (${entry.license})`),
      "",
    );
  lines.push("## License texts", "");
  for (const entry of sorted) {
    lines.push(`### ${entry.name} ${entry.version} (${entry.license})`, "");
    if (entry.texts.length === 0)
      lines.push(
        `No license file is included in the published ${entry.name} package; its package.json`,
        `declares the license as ${entry.license}. Source: ${entry.repository ?? "npm registry"}.`,
        "",
      );
    for (const { name, text } of entry.texts)
      lines.push(`#### ${name}`, "", "```text", text, "```", "");
  }
  return { text: `${lines.join("\n").trimEnd()}\n`, missingText, count: sorted.length };
}

export function readModuleManifests(directory) {
  if (!existsSync(directory)) return new Map();
  const byCompiler = new Map();
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".json")))
    byCompiler.set(
      basename(name, ".json"),
      JSON.parse(readFileSync(join(directory, name), "utf8")),
    );
  return byCompiler;
}
