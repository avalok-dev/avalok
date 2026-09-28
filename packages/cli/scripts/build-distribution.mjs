#!/usr/bin/env node
// Builds the installable AgentMap package into `packages/cli/dist/`.
//
// The result is a self-contained npm package directory: a bundled CLI (`lib/`), a Next.js
// standalone dashboard (`dashboard/`), allowlisted sample repositories (`samples/`), a small
// launcher (`bin/`), and a generated manifest that lists only real runtime dependencies.
// Nothing here publishes anything; `pack-distribution.mjs` turns the directory into a tarball.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(cliRoot, "../..");
const webRoot = join(repositoryRoot, "apps", "web");
const output = join(cliRoot, "dist");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

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

function installedVersion(name) {
  const require = createRequire(join(webRoot, "package.json"));
  let directory = dirname(require.resolve(name));
  while (
    !existsSync(join(directory, "package.json")) ||
    readJson(join(directory, "package.json")).name !== name
  )
    directory = dirname(directory);
  return readJson(join(directory, "package.json")).version;
}

function buildDashboard() {
  step("Building the standalone dashboard");
  const next = createRequire(join(webRoot, "package.json")).resolve("next/dist/bin/next");
  run(process.execPath, [next, "build"], {
    cwd: webRoot,
    env: {
      ...process.env,
      AGENTMAP_DASHBOARD_STANDALONE: "1",
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
  cpSync(join(cliRoot, "src", "dashboard-launcher.cjs"), join(destination, "agentmap-launch.cjs"));
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
  await esbuild.build({
    ...common,
    entryPoints: [join(cliRoot, "src", "bin.ts")],
    outfile: join(output, "lib", "cli.mjs"),
    external: externalRuntime,
    // Some bundled CommonJS dependencies call require() for Node built-ins.
    banner: {
      js: 'import { createRequire as __agentmapCreateRequire } from "node:module";\nconst require = __agentmapCreateRequire(import.meta.url);',
    },
  });
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
  const launcher = join(output, "bin", "agentmap.mjs");
  mkdirSync(dirname(launcher), { recursive: true });
  writeFileSync(
    launcher,
    `#!/usr/bin/env node
import { minimumNodeVersion, nodeSupport, supportedNodeRange } from "../lib/node-support.mjs";

const support = nodeSupport(process.versions.node);
if (support === "unsupported") {
  process.stderr.write(
    "${product.displayName} requires Node.js " + supportedNodeRange + " (found " + process.versions.node + ").\\n" +
      "Install Node.js " + minimumNodeVersion + " or newer in the Node 24 LTS line and try again.\\n",
  );
  process.exit(1);
}
if (support === "untested-newer" && process.env.AGENTMAP_QUIET_NODE_WARNING !== "1")
  process.stderr.write(
    "Warning: Node.js " + process.versions.node + " is newer than the tested range " + supportedNodeRange + ".\\n",
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

function writeManifest() {
  step("Writing the package manifest");
  const manifest = {
    name: product.packageName,
    version: cliManifest.version,
    description: product.description,
    // Private until naming and release decisions are made (M7.4): `npm publish` refuses it.
    private: true,
    license: rootManifest.license,
    type: "module",
    bin: { [product.cliName]: "bin/agentmap.mjs" },
    engines: { node: rootManifest.engines.node },
    files: ["bin", "lib", "dashboard", "samples"],
    dependencies: Object.fromEntries(externalRuntime.map((name) => [name, installedVersion(name)])),
  };
  writeFileSync(join(output, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  cpSync(join(repositoryRoot, "LICENSE"), join(output, "LICENSE"));
  writeFileSync(
    join(output, "README.md"),
    `# ${product.displayName} (developer preview, working name)

${product.description}

\`\`\`sh
${product.cliName} [path]            # analyze a repository and open the local dashboard
${product.cliName} doctor [path]     # diagnose the local setup without starting services
${product.cliName} data path         # show AgentMap-owned local data
${product.cliName} data clear        # clear AgentMap-owned local data
\`\`\`

Requires Node.js ${rootManifest.engines.node}. Everything runs locally and binds to 127.0.0.1.
OTLP/HTTP traces (JSON or protobuf) are accepted at http://127.0.0.1:4318/v1/traces.

Uninstalling the package does not delete AgentMap's local data; run \`${product.cliName} data path\`
to find it and \`${product.cliName} data clear\` before uninstalling if you want it removed.
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
    /^(\.env(\..*)?|node_modules|\.git|\.agentmap|coverage|\.turbo|\.venv|__pycache__|.*\.tfstate|.*\.tfvars)$/;
  for (const file of files(output))
    for (const part of relative(output, file).split(sep))
      if (forbidden.test(part)) problems.push(`artifact contains ${relative(output, file)}`);
  if (problems.length)
    throw new Error(`Distribution is not self-contained:\n- ${problems.join("\n- ")}`);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
buildDashboard();
await bundleCli();
writeLauncher();
copySamples();
writeManifest();
verifyIndependence();
step(`Distribution ready: ${relative(repositoryRoot, output)}`);
