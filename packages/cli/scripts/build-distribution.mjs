#!/usr/bin/env node
// Builds the installable Avalok package into `packages/cli/dist/`.
//
// The result is a self-contained npm package directory: a bundled CLI (`lib/`), a Next.js
// standalone dashboard (`dashboard/`), allowlisted sample repositories (`samples/`), a small
// launcher (`bin/`), and a generated manifest that lists only real runtime dependencies.
// Nothing here publishes anything; `pack-distribution.mjs` turns the directory into a tarball.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  collectPackages,
  mergePackages,
  readModuleManifests,
  renderNotices,
} from "./third-party-notices.mjs";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(cliRoot, "../..");
const webRoot = join(repositoryRoot, "apps", "web");
const output = join(cliRoot, "dist");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
// `--publishable` (release workflow only) omits `private: true` so the exact artifact that was
// built and smoke-tested is the one a later, explicitly approved `npm publish` would upload.
const publishable = process.argv.includes("--publishable");
const moduleManifests = mkdtempSync(join(tmpdir(), "avalok-modules-"));
let cliInputs = [];

const cliManifest = readJson(join(cliRoot, "package.json"));
const rootManifest = readJson(join(repositoryRoot, "package.json"));
const product = readJson(join(cliRoot, "product.json"));

// Runtime packages that cannot be bundled: the standalone dashboard requires Next/React from
// node_modules, the analyzer uses the TypeScript compiler API, and the HCL parser loads an
// adjacent WebAssembly file. Versions are pinned to exactly what the dashboard was built with.
const externalRuntime = ["next", "react", "react-dom", "typescript", "@cdktf/hcl2json"];

// Allowlisted analysis samples offered by the dashboard source selector.
const samples = {
  fastapi: "packages/analyzer/tests/fixtures/python-fastapi",
  polyglot: "examples/polyglot-ai-platform",
  terraform: "packages/analyzer/tests/fixtures/terraform-aws",
  kubernetes: "packages/analyzer/tests/fixtures/kubernetes-app",
  helm: "packages/analyzer/tests/fixtures/helm-app",
  infrastructure: "examples/infrastructure-ai-platform",
};
const excludedSampleEntries = new Set([
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".DS_Store",
  ".agentmap",
  ".sarvadrik",
  ".avalok",
  ".terraform",
]);

function step(message) {
  process.stdout.write(`• ${message}\n`);
}

function run(command, arguments_, options) {
  const result = spawnSync(command, arguments_, { stdio: "inherit", ...options });
  if (result.status !== 0)
    throw new Error(`${basename(command)} ${arguments_.join(" ")} failed (${result.status}).`);
}

function installedManifest(name) {
  const require = createRequire(join(webRoot, "package.json"));
  let directory = dirname(require.resolve(name));
  while (
    !existsSync(join(directory, "package.json")) ||
    readJson(join(directory, "package.json")).name !== name
  )
    directory = dirname(directory);
  return readJson(join(directory, "package.json"));
}

function installedVersion(name) {
  return installedManifest(name).version;
}

// Workspace packages that export compiled `dist/` files must be built before Next resolves them.
function buildCompiledPackages() {
  step("Building compiled workspace packages");
  const schemaRoot = join(repositoryRoot, "packages", "schema");
  const tsc = createRequire(join(schemaRoot, "package.json")).resolve("typescript/bin/tsc");
  run(process.execPath, [tsc, "-p", "tsconfig.build.json"], { cwd: schemaRoot });
}

function buildDashboard() {
  step("Building the standalone dashboard");
  const next = createRequire(join(webRoot, "package.json")).resolve("next/dist/bin/next");
  run(process.execPath, [next, "build"], {
    cwd: webRoot,
    env: {
      ...process.env,
      AVALOK_DASHBOARD_STANDALONE: "1",
      AVALOK_MODULE_MANIFEST: moduleManifests,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
    },
  });
  const standalone = join(webRoot, ".next", "standalone", relative(repositoryRoot, webRoot));
  if (!existsSync(join(standalone, "server.js")))
    throw new Error("Next.js did not produce a standalone server.");
  const destination = join(output, "dashboard");
  cpSync(standalone, destination, {
    recursive: true,
    // Dependencies come from the installed package's node_modules, never the workspace.
    filter: (source) => basename(source) !== "node_modules",
  });
  // Build traces and the workspace manifest are build-time metadata, not runtime inputs.
  rmSync(join(destination, "package.json"), { force: true });
  rmSync(join(destination, ".next", "cache"), { recursive: true, force: true });
  cpSync(join(webRoot, ".next", "static"), join(destination, ".next", "static"), {
    recursive: true,
  });
  if (existsSync(join(webRoot, "public")))
    cpSync(join(webRoot, "public"), join(destination, "public"), { recursive: true });
  cpSync(join(cliRoot, "src", "dashboard-launcher.cjs"), join(destination, "avalok-launch.cjs"));
  // The package root is ESM; the standalone server is CommonJS.
  writeFileSync(
    join(destination, "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  );
}

async function bundleCli() {
  step("Bundling the CLI, collector, analyzer, and adapters");
  // import() needs a file URL: a bare `D:\…` path is rejected by the ESM loader on Windows.
  const esbuild = await import(
    pathToFileURL(createRequire(join(cliRoot, "package.json")).resolve("esbuild")).href
  );
  const common = {
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    legalComments: "linked",
    logLevel: "warning",
  };
  const cli = await esbuild.build({
    ...common,
    metafile: true,
    entryPoints: [join(cliRoot, "src", "bin.ts")],
    outfile: join(output, "lib", "cli.mjs"),
    external: externalRuntime,
    // Some bundled CommonJS dependencies call require() for Node built-ins.
    banner: {
      js: 'import { createRequire as __avalokCreateRequire } from "node:module";\nconst require = __avalokCreateRequire(import.meta.url);',
    },
  });
  cliInputs = Object.keys(cli.metafile.inputs).map((input) => resolve(process.cwd(), input));
  // The launcher loads this before anything else, so keep it tiny and syntax-conservative.
  await esbuild.build({
    ...common,
    entryPoints: [join(cliRoot, "src", "node-support.ts")],
    outfile: join(output, "lib", "node-support.mjs"),
    target: "es2017",
  });
}

function writeLauncher() {
  step("Writing the launcher");
  const launcher = join(output, "bin", `${product.cliName}.mjs`);
  mkdirSync(dirname(launcher), { recursive: true });
  writeFileSync(
    launcher,
    `#!/usr/bin/env node
import { nodeSupport, supportedNodeRange, testedNodeLines } from "../lib/node-support.mjs";

const support = nodeSupport(process.versions.node);
if (support === "unsupported") {
  process.stderr.write(
    "${product.displayName} requires Node.js " + supportedNodeRange + " (found " + process.versions.node + ").\\n" +
      "Install " + testedNodeLines + " (nodejs.org) and try again.\\n",
  );
  process.exit(1);
}
if (support === "untested" && process.env.AVALOK_QUIET_NODE_WARNING !== "1")
  process.stderr.write(
    "Warning: Node.js " + process.versions.node + " is outside the tested lines (" + testedNodeLines + "); it may work.\\n",
  );

const { formatCliError, runCli } = await import("../lib/cli.mjs");
try {
  process.exitCode = await runCli();
} catch (error) {
  process.stderr.write(formatCliError(error));
  process.exitCode = 1;
}
`,
  );
  chmodSync(launcher, 0o755);
}

function copySamples() {
  step("Copying allowlisted sample repositories");
  // Samples keep their source directory names so analysis shows the same repository names.
  for (const source of Object.values(samples))
    cpSync(join(repositoryRoot, source), join(output, "samples", basename(source)), {
      recursive: true,
      filter: (path) =>
        !excludedSampleEntries.has(basename(path)) && !/^\.env(\.|$)/.test(basename(path)),
    });
}

function writeNotices() {
  step("Generating third-party notices from bundled packages");
  const manifests = readModuleManifests(moduleManifests);
  const dashboardFiles = [...manifests.values()].flat();
  if (cliInputs.length === 0 || dashboardFiles.length === 0)
    throw new Error("Bundled module lists are missing; cannot generate third-party notices.");
  const packages = new Map();
  mergePackages(packages, collectPackages(cliInputs), "cli");
  mergePackages(packages, collectPackages(dashboardFiles), "dashboard");
  const runtimeDependencies = externalRuntime.map((name) => {
    const manifest = installedManifest(name);
    return { name, version: manifest.version, license: manifest.license ?? "UNKNOWN" };
  });
  const { text, missingText, count } = renderNotices(packages, { product, runtimeDependencies });
  const unknown = [...packages.values()].filter((entry) => entry.license === "UNKNOWN");
  if (unknown.length)
    throw new Error(
      `Packages without license metadata: ${unknown.map((entry) => entry.name).join(", ")}`,
    );
  writeFileSync(join(output, "THIRD_PARTY_NOTICES.md"), text);
  rmSync(moduleManifests, { recursive: true, force: true });
  step(
    `THIRD_PARTY_NOTICES.md: ${count} packages` +
      (missingText.length
        ? `; ${missingText.length} publish no license file (identifier recorded): ${missingText.map((entry) => entry.name).join(", ")}`
        : ""),
  );
}

function writeManifest() {
  step(`Writing the package manifest${publishable ? " (publishable)" : " (private)"}`);
  const manifest = {
    name: product.packageName,
    version: cliManifest.version,
    description: product.description,
    // Everyday builds are private so `npm publish` refuses them; only the release workflow's
    // `--publishable` build (smoke-tested as-is) can be published, after explicit approval.
    ...(publishable ? {} : { private: true }),
    license: rootManifest.license,
    homepage: product.homepage,
    ...(product.repository
      ? {
          repository: { type: "git", url: `git+${product.repository}.git` },
          bugs: { url: `${product.repository}/issues` },
        }
      : {}),
    keywords: product.keywords,
    type: "module",
    bin: { [product.cliName]: `bin/${product.cliName}.mjs` },
    engines: { node: product.nodeRange },
    files: ["bin", "lib", "dashboard", "samples", "THIRD_PARTY_NOTICES.md"],
    dependencies: Object.fromEntries(externalRuntime.map((name) => [name, installedVersion(name)])),
  };
  writeFileSync(join(output, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  cpSync(join(repositoryRoot, "LICENSE"), join(output, "LICENSE"));
  writeFileSync(
    join(output, "README.md"),
    `# ${product.displayName}

**${product.tagline}**

${product.description}

Developer preview. Website: ${product.homepage}

\`\`\`sh
${product.cliName} [path]            # analyze a repository and open the local dashboard
${product.cliName} doctor [path]     # diagnose the local setup without starting services
${product.cliName} data path         # show Avalok-owned local data
${product.cliName} data clear        # clear Avalok-owned local data
\`\`\`

Requires Node.js ${product.nodeRange} (tested on Node 22 LTS and Node 24 LTS). Everything runs locally; both servers bind to 127.0.0.1.
OTLP/HTTP traces (protobuf or JSON) are accepted at http://127.0.0.1:4318/v1/traces.

Terraform, Kubernetes, Helm, and AWS support analyzes configuration files in your repository;
${product.displayName} does not connect to cloud or cluster APIs.

Uninstalling the package does not delete Avalok's local data; run \`${product.cliName} data path\`
to find it and \`${product.cliName} data clear\` before uninstalling if you want it removed.

Licensed under Apache-2.0. Bundled third-party components and their licenses are listed in
THIRD_PARTY_NOTICES.md.
`,
  );
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to ship a symlink: ${path}`);
    return entry.isDirectory() ? files(path) : [path];
  });
}

// Fails the build if the artifact could resolve anything from this workspace at runtime.
function verifyIndependence() {
  step("Verifying the artifact is independent of the workspace");
  const problems = [];
  const manifest = readFileSync(join(output, "package.json"), "utf8");
  if (manifest.includes("workspace:")) problems.push("package.json uses the workspace: protocol");
  for (const file of files(output)) {
    if (!/\.(m?js|cjs|json)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const relativeFile = relative(output, file);
    // The CLI bundle and launcher must not embed the build machine's checkout path at all.
    if (/^(lib|bin)\b/.test(relativeFile) && text.includes(repositoryRoot))
      problems.push(`${relativeFile} embeds the workspace path`);
    // Next.js server output keeps build-time source paths as module labels (metadata only);
    // it must never *load* anything from them.
    for (const pattern of [
      `require("${repositoryRoot}`,
      `from "${repositoryRoot}`,
      `import("${repositoryRoot}`,
    ])
      if (text.includes(pattern)) problems.push(`${relativeFile} loads from the workspace`);
    if (/(?:require\(|import\(|from\s*)"@visual-system\//.test(text))
      problems.push(`${relativeFile} loads an internal workspace package at runtime`);
  }
  const forbidden =
    /^(\.env(\..*)?|node_modules|\.git|\.agentmap|\.sarvadrik|\.avalok|coverage|\.turbo|\.venv|__pycache__|.*\.tfstate|.*\.tfvars)$/;
  for (const file of files(output))
    for (const part of relative(output, file).split(sep))
      if (forbidden.test(part)) problems.push(`artifact contains ${relative(output, file)}`);
  if (problems.length)
    throw new Error(`Distribution is not self-contained:\n- ${problems.join("\n- ")}`);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
buildCompiledPackages();
buildDashboard();
await bundleCli();
writeLauncher();
copySamples();
writeNotices();
writeManifest();
verifyIndependence();
step(`Distribution ready: ${relative(repositoryRoot, output)}`);
