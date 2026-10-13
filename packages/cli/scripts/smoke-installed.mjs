#!/usr/bin/env node
// Clean-install smoke test for the packed Avalok artifact.
//
//   pnpm dist:smoke [--tarball <path>] [--hide-workspace] [--keep]
//
// 1. Copies the tarball and external fixture repositories into a fresh temporary directory
//    whose path contains spaces (and a Unicode repository name).
// 2. Installs the tarball with plain `npm install` — no links, no workspace protocol, no NODE_PATH.
// 3. Optionally renames the Avalok source checkout for the rest of the run so the installed
//    package cannot silently resolve anything from it (restored in `finally`).
// 4. Drives the installed CLI: --version/--help, doctor per fixture, startup, dashboard assets,
//    repository/sample analysis, capabilities, test trace, OTLP JSON + protobuf, restart
//    persistence, Ctrl+C shutdown with port release, and data clearing safety.
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(cliRoot, "../..");
const argumentsList = process.argv.slice(2);
const flag = (name) => argumentsList.includes(name);
const option = (name) => {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
};
const product = JSON.parse(readFileSync(join(cliRoot, "product.json"), "utf8"));

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  process.stdout.write(`${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}\n`);
  if (!condition) throw new Error(`Smoke check failed: ${name}`);
}

function newestTarball() {
  const directory = join(repositoryRoot, "artifacts");
  const candidates = existsSync(directory)
    ? readdirSync(directory).filter(
        (name) => name.startsWith(`${product.packageName}-`) && name.endsWith(".tgz"),
      )
    : [];
  if (!candidates.length)
    throw new Error("No tarball found. Run `pnpm dist:build && pnpm dist:pack`.");
  return join(directory, candidates.sort().at(-1));
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function portFree(port) {
  return new Promise((resolveFree) => {
    const server = createServer();
    server.once("error", () => resolveFree(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolveFree(true)));
  });
}

function runSync(command, arguments_, options = {}) {
  return spawnSync(command, arguments_, { encoding: "utf8", ...options });
}

function startAvalok(bin, target, ports, environment) {
  const child = spawn(
    process.execPath,
    [
      bin,
      target,
      "--no-open",
      "--port",
      String(ports.dashboard),
      "--otlp-port",
      String(ports.otlp),
    ],
    { cwd: target, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise((resolveExit) =>
    child.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Startup timed out.\n${stdout}\n${stderr}`)),
      90_000,
    );
    child.stdout.on("data", () => {
      if (stdout.includes("Press Ctrl+C to stop")) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    void exited.then(({ code }) => {
      clearTimeout(timer);
      reject(new Error(`Avalok exited during startup (${code}).\n${stdout}\n${stderr}`));
    });
  });
  return { child, exited, ready, output: () => ({ stdout, stderr }) };
}

const windows = process.platform === "win32";

async function portsReleased(ports, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await portFree(ports.dashboard)) && (await portFree(ports.otlp))) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  return false;
}

// POSIX: SIGINT is what Ctrl+C delivers. Windows cannot deliver a console Ctrl+C to a single
// process from Node, so there the child is terminated and the orphan watchdog is verified.
async function stop(running) {
  running.child.kill("SIGINT");
  return Promise.race([
    running.exited,
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout({ code: "timeout" }), 15_000)),
  ]);
}

// `fetch` cannot set Host, so browser-abuse checks use node:http with explicit headers.
function raw(url, { method = "GET", headers = {}, body } = {}) {
  const target = new URL(url);
  return new Promise((resolveResponse, reject) => {
    const request = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers: { Host: target.host, ...headers },
        setHost: false,
        agent: false,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolveResponse(response.statusCode));
      },
    );
    request.once("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

async function json(url, init) {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() };
}

const tarballSource = resolve(option("--tarball") ?? newestTarball());
const expectedVersion = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")).version;
// Former names; must not appear in anything a user sees.
const legacyBrand = /agentmap|sarvadrik/i;
const scratch = mkdtempSync(join(tmpdir(), "avalok smoke "));
const install = join(scratch, "Install Dir With Spaces");
const repositories = join(scratch, "External Repos");
const dataRoot = join(scratch, "Avalok Data");
const outsideSentinel = join(scratch, "not-avalok-data", "keep.txt");
const hiddenWorkspace = `${repositoryRoot}.hidden-by-avalok-smoke`;
let workspaceHidden = false;

// Load everything needed from the workspace *before* it may be hidden.
const protobufFixture = join(
  repositoryRoot,
  "packages/telemetry-adapter/tests/fixtures/openinference-trace.otlp.pb",
);
const protobufPayload = existsSync(protobufFixture) ? readFileSync(protobufFixture) : undefined;
// Optional: `--python <venv python>` runs the standard-exporter example against the install.
const python = option("--python");
const pythonExample = readFileSync(
  join(repositoryRoot, "examples/python-otel-direct/app.py"),
  "utf8",
);
const jsonPayload = {
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: "smoke-json-service" } }],
      },
      scopeSpans: [
        {
          scope: { name: "avalok-smoke" },
          spans: [
            {
              traceId: "5b8efff798038103d269b633813fc60c",
              spanId: "eee19b7ec3c1b174",
              name: "smoke json llm",
              kind: 1,
              startTimeUnixNano: "1700000000000000000",
              endTimeUnixNano: "1700000000250000000",
              attributes: [
                { key: "openinference.span.kind", value: { stringValue: "LLM" } },
                { key: "llm.model_name", value: { stringValue: "smoke-model" } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

try {
  mkdirSync(install, { recursive: true });
  mkdirSync(repositories, { recursive: true });
  mkdirSync(dirname(outsideSentinel), { recursive: true });
  writeFileSync(outsideSentinel, "must survive data clear\n");

  const fixtures = {
    "Simple JS App": undefined,
    "Python Service": "packages/analyzer/tests/fixtures/python-fastapi",
    "Polyglot Project": "examples/polyglot-ai-platform",
    "Infra Platform": "examples/infrastructure-ai-platform",
    "Ünïcode Répo": undefined,
  };
  for (const [name, source] of Object.entries(fixtures)) {
    const destination = join(repositories, name);
    if (source)
      cpSync(join(repositoryRoot, source), destination, {
        recursive: true,
        filter: (path) => !["node_modules", "__pycache__", ".venv"].includes(basename(path)),
      });
    else {
      mkdirSync(join(destination, "src"), { recursive: true });
      writeFileSync(
        join(destination, "package.json"),
        JSON.stringify({
          name: name.toLowerCase().replaceAll(" ", "-"),
          dependencies: { express: "^4.0.0", openai: "^4.0.0" },
        }),
      );
      writeFileSync(
        join(destination, "src", "server.ts"),
        'import express from "express";\nimport OpenAI from "openai";\nconst app = express();\nconst client = new OpenAI();\napp.post("/chat", async () => client.chat.completions.create({ model: "x", messages: [] }));\napp.listen(3000);\n',
      );
    }
  }

  cpSync(tarballSource, join(install, basename(tarballSource)));
  writeFileSync(
    join(install, "package.json"),
    JSON.stringify({ name: "avalok-smoke-host", private: true }),
  );
  if (flag("--hide-workspace")) {
    if (existsSync(hiddenWorkspace))
      throw new Error(`${hiddenWorkspace} already exists; restore it first.`);
    renameSync(repositoryRoot, hiddenWorkspace);
    workspaceHidden = true;
    check("workspace hidden for the rest of the run", !existsSync(repositoryRoot), hiddenWorkspace);
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const installResult = runSync(
    npm,
    ["install", "--no-audit", "--no-fund", `./${basename(tarballSource)}`],
    {
      cwd: install,
      shell: process.platform === "win32",
      env: { ...process.env, NODE_PATH: "" },
    },
  );
  check(
    "npm install of the packed tarball",
    installResult.status === 0,
    installResult.stderr.trim().split("\n").at(-1),
  );
  const packageRoot = join(install, "node_modules", ...product.packageName.split("/"));
  const bin = join(packageRoot, "bin", `${product.cliName}.mjs`);
  const shim = join(
    install,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${product.cliName}.cmd` : product.cliName,
  );
  check(
    "installed as a real directory (no link)",
    existsSync(bin) && !lstatSync(packageRoot).isSymbolicLink(),
  );
  check("bin shim created", existsSync(shim));
  const installedManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  check(
    "package identity",
    installedManifest.name === product.packageName &&
      installedManifest.version === expectedVersion &&
      installedManifest.homepage === product.homepage,
    `${installedManifest.name}@${installedManifest.version}${installedManifest.private ? " (private)" : " (publishable)"}`,
  );
  check(
    "LICENSE shipped",
    /Apache License/.test(readFileSync(join(packageRoot, "LICENSE"), "utf8")),
  );
  const packageReadme = readFileSync(join(packageRoot, "README.md"), "utf8");
  check(
    "README shipped with product branding",
    packageReadme.includes(product.displayName) && !legacyBrand.test(packageReadme),
  );
  const notices = readFileSync(join(packageRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
  check(
    "third-party notices shipped (elkjs EPL-2.0 text and source)",
    /\| elkjs \| [\d.]+ \| EPL-2\.0 \|/.test(notices) &&
      notices.includes("Eclipse Public License - v 2.0") &&
      notices.includes("github.com/kieler/elkjs"),
    `${(notices.match(/^\| /gm) ?? []).length - 2} packages`,
  );
  const dashboardModules = join(packageRoot, "dashboard", "node_modules");
  const hasSymlink = (directory) =>
    readdirSync(directory, { withFileTypes: true }).some((entry) =>
      entry.isSymbolicLink()
        ? true
        : entry.isDirectory() && hasSymlink(join(directory, entry.name)),
    );
  check(
    "dashboard ships its own flat runtime modules (no pnpm store, symlinks, or platform binaries)",
    existsSync(join(dashboardModules, "next", "package.json")) &&
      existsSync(join(dashboardModules, "react", "package.json")) &&
      !existsSync(join(dashboardModules, ".pnpm")) &&
      !existsSync(join(dashboardModules, "@img")) &&
      !existsSync(join(dashboardModules, "sharp")) &&
      !(existsSync(join(dashboardModules, "@next"))
        ? readdirSync(join(dashboardModules, "@next")).some((name) => name.startsWith("swc-"))
        : false) &&
      !hasSymlink(dashboardModules),
  );

  const environment = {
    ...process.env,
    AVALOK_DATA_DIR: dataRoot,
    AVALOK_QUIET_NODE_WARNING: "1",
    NODE_PATH: "",
    // A shell HOSTNAME must never widen the dashboard bind.
    HOSTNAME: "0.0.0.0",
  };
  delete environment.AVALOK_DASHBOARD_DIR;
  delete environment.AVALOK_SAMPLES_DIR;

  // The npm-generated shim is exercised directly on POSIX. On Windows it is a .cmd file that
  // needs a shell, and shell argument joining would break this intentionally spaced path, so
  // the shim's existence is asserted above and the same entry runs through Node.
  const version = windows
    ? runSync(process.execPath, [bin, "--version"], { env: environment })
    : runSync(shim, ["--version"], { env: environment });
  check("avalok --version", version.stdout.trim() === expectedVersion, version.stdout.trim());
  const help = runSync(process.execPath, [bin, "--help"], { env: environment });
  check(
    `${product.cliName} --help`,
    help.status === 0 &&
      help.stdout.includes(`${product.cliName} doctor`) &&
      help.stdout.includes(product.displayName) &&
      !legacyBrand.test(help.stdout),
  );
  const path = runSync(process.execPath, [bin, "data", "path"], { env: environment });
  check("avalok data path", path.stdout.trim() === dataRoot, path.stdout.trim());

  // Shareable artifacts and agent setup, from the installed package only. An empty Codex home keeps
  // every command away from real sessions.
  const emptyCodex = join(scratch, "Empty Codex Home");
  mkdirSync(emptyCodex, { recursive: true });
  const sharingEnvironment = { ...environment, CODEX_HOME: emptyCodex };
  const diagramOut = join(scratch, "installed diagram.svg");
  const diagramRun = runSync(
    process.execPath,
    [
      bin,
      "recap",
      join(repositories, "Infra Platform"),
      "--format",
      "diagram",
      "--out",
      diagramOut,
    ],
    { env: sharingEnvironment },
  );
  const diagramSvg = existsSync(diagramOut) ? readFileSync(diagramOut, "utf8") : "";
  check(
    "avalok recap --format diagram (bundled layout engine and export code)",
    diagramRun.status === 0 &&
      diagramSvg.startsWith("<svg ") &&
      diagramSvg.includes("Made with Avalok") &&
      !diagramSvg.includes(repositories) &&
      !diagramSvg.includes(scratch) &&
      !/<script|href=/i.test(diagramSvg),
    `${(diagramSvg.length / 1024).toFixed(0)} KB`,
  );
  const noSession = runSync(process.execPath, [bin, "recap", join(repositories, "Simple JS App")], {
    env: sharingEnvironment,
  });
  check(
    "avalok recap explains when no session ran in the repository",
    noSession.status === 1 && noSession.stdout.includes("No agent session with events ran inside"),
  );
  const noWeek = runSync(process.execPath, [bin, "wrapped", "--format", "md"], {
    env: sharingEnvironment,
  });
  check(
    "avalok wrapped explains when there are no sessions",
    noWeek.status === 1 &&
      noWeek.stdout.includes("No agent sessions with events in the last 7 days"),
  );
  // A run Avalok stored from Claude Code hooks (not a Codex file) is recapped by the installed
  // package. Seeded in its own data root, named by id so the check does not depend on how each
  // operating system spells the repository path. The title and prompt are secrets that must not leak.
  const seededRoot = join(scratch, "Seeded Data");
  mkdirSync(join(seededRoot, "runtime"), { recursive: true });
  const seededStart = new Date(Date.now() - 3_600_000).toISOString();
  const seededEvent = (id, timestamp, durationMs) => ({
    id,
    traceId: "t",
    timestamp,
    category: "tool",
    action: "tool.call",
    sourceEntityId: "claude",
    targetEntityId: "terminal",
    durationMs,
  });
  const seededEvents = [seededEvent("a", 0, 20_000), seededEvent("b", 60_000, 5_000)];
  const seededSnapshot = {
    source: { id: "claude", name: "Claude Code", description: "", capabilities: {} },
    session: {
      id: "smoke-claude-session",
      source: "claude",
      title: "SMOKE-SECRET-TITLE",
      startedAt: seededStart,
      modifiedAt: new Date().toISOString(),
      status: "completed",
      eventCount: 2,
      cwd: join(repositories, "Simple JS App"),
    },
    architecture: {
      id: "exec",
      title: "Claude Code",
      entities: [
        { id: "claude", kind: "agent", name: "Claude Code" },
        { id: "terminal", kind: "tool", name: "Terminal" },
      ],
      edges: [{ id: "e", source: "claude", target: "terminal" }],
    },
    run: {
      id: "smoke-claude-session",
      title: "SMOKE-SECRET-TITLE",
      prompt: "SMOKE-SECRET-PROMPT",
      startedAt: seededStart,
      totalDurationMs: 65_000,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      toolCallCount: 2,
      modelCallCount: 0,
      status: "completed",
      events: seededEvents,
    },
    rawEvents: {},
    diagnostics: [],
  };
  writeFileSync(
    join(
      seededRoot,
      "runtime",
      `claude-${createHash("sha256").update("claude\0smoke-claude-session").digest("hex")}.json`,
    ),
    JSON.stringify(seededSnapshot),
  );
  const seededEnvironment = { ...sharingEnvironment, AVALOK_DATA_DIR: seededRoot };
  const storedRecap = runSync(
    process.execPath,
    [bin, "recap", join(repositories, "Simple JS App"), "--session", "claude:smoke-claude-session"],
    { env: seededEnvironment },
  );
  check(
    "avalok recap reads a stored Claude Code run, without its title or prompt",
    storedRecap.status === 0 &&
      storedRecap.stdout.includes("2 steps observed") &&
      !storedRecap.stdout.includes("SMOKE-SECRET"),
  );
  const storedWeek = runSync(process.execPath, [bin, "wrapped", "--format", "md"], {
    env: seededEnvironment,
  });
  check(
    "avalok wrapped counts a stored Claude Code run",
    storedWeek.status === 0 &&
      storedWeek.stdout.includes("1 session on 1 day") &&
      !storedWeek.stdout.includes("SMOKE-SECRET"),
  );
  const feedback = runSync(process.execPath, [bin, "feedback"], { env: sharingEnvironment });
  check(
    "avalok feedback prints a prefilled issue link and nothing private",
    feedback.status === 0 &&
      feedback.stdout.includes("template=feedback.yml") &&
      !feedback.stdout.includes(scratch) &&
      !feedback.stdout.includes(repositories),
  );
  const claudeSetup = runSync(
    process.execPath,
    [bin, "setup", "claude", join(repositories, "Simple JS App")],
    { env: sharingEnvironment },
  );
  check(
    "avalok setup claude prints the hooks and writes nothing",
    claudeSetup.status === 0 &&
      claudeSetup.stdout.includes("Nothing has been written") &&
      claudeSetup.stdout.includes("/v1/claude/hooks") &&
      !existsSync(join(repositories, "Simple JS App", ".claude")),
  );
  const codexSetup = runSync(process.execPath, [bin, "setup", "codex"], {
    env: sharingEnvironment,
  });
  check(
    "avalok setup codex reports the (empty) session count",
    codexSetup.status === 0 && codexSetup.stdout.includes("Found 0 local Codex sessions"),
  );

  const importPage = join(scratch, "saved trace page.json");
  const importRoot = join(scratch, "Import Data");
  writeFileSync(
    importPage,
    JSON.stringify({
      object: "list",
      data: [
        {
          object: "agent.session.trace",
          id: "turn_smoke",
          session_id: "sess_smoke",
          otlp: jsonPayload,
        },
      ],
      first_id: "turn_smoke",
      last_id: "turn_smoke",
      has_more: false,
    }),
  );
  const importEnvironment = { ...environment, AVALOK_DATA_DIR: importRoot };
  const imported = runSync(process.execPath, [bin, "import", "openai", importPage], {
    env: importEnvironment,
  });
  check(
    "installed offline OpenAI trace import",
    imported.status === 0 && imported.stdout.includes("1 distinct spans"),
    imported.stderr.trim(),
  );
  const reimported = runSync(process.execPath, [bin, "import", "openai", importPage], {
    env: importEnvironment,
  });
  check(
    "installed trace reimport is idempotent",
    reimported.status === 0 && readdirSync(join(importRoot, "runtime")).length === 1,
  );

  const expectations = {
    "Simple JS App": /typescript/,
    "Python Service": /python/,
    "Polyglot Project": /python.*typescript|typescript.*python/,
    "Infra Platform": /Terraform.*Kubernetes|Kubernetes.*Terraform/s,
    "Ünïcode Répo": /typescript/,
  };
  for (const [name, pattern] of Object.entries(expectations)) {
    const doctorPort = await freePort();
    const doctor = runSync(
      process.execPath,
      [bin, "doctor", join(repositories, name), "--otlp-port", String(doctorPort)],
      {
        env: environment,
      },
    );
    check(
      `doctor: ${name}`,
      doctor.status === 0 && pattern.test(doctor.stdout),
      doctor.status === 0 ? "Ready" : doctor.stdout,
    );
  }

  const ports = { dashboard: await freePort(), otlp: await freePort() };
  const target = join(repositories, "Polyglot Project");
  let running = startAvalok(bin, target, ports, environment);
  await running.ready;
  const dashboard = `http://127.0.0.1:${ports.dashboard}`;
  const otlp = `http://127.0.0.1:${ports.otlp}`;
  check("startup summary names the target", running.output().stdout.includes("Polyglot Project"));
  check(
    "startup banner shows the product name only",
    running.output().stdout.startsWith(product.displayName) &&
      !legacyBrand.test(running.output().stdout),
  );

  const page = await fetch(dashboard);
  const html = await page.text();
  check("dashboard HTML served", page.status === 200 && html.includes("<html"));
  check(
    "dashboard branding",
    html.includes(`<title>${product.displayName}`) && !legacyBrand.test(html),
  );
  const asset = html.match(/\/_next\/static\/[^"']+\.js/)?.[0];
  const assetResponse = asset ? await fetch(`${dashboard}${asset}`) : undefined;
  check("dashboard static asset served", assetResponse?.status === 200, asset);

  const repository = await json(`${dashboard}/api/repository`);
  check(
    "repository analyzed from the installed dashboard",
    repository.status === 200 &&
      repository.body.repository.name === "Polyglot Project" &&
      repository.body.graph.entities.length > 0,
    `${repository.body.graph?.entities.length} entities`,
  );
  const infrastructure = await json(`${dashboard}/api/repository?fixture=infrastructure`);
  check(
    "packaged infrastructure sample analyzed",
    infrastructure.status === 200 &&
      infrastructure.body.metrics.terraformFiles > 0 &&
      infrastructure.body.metrics.helmCharts > 0,
  );
  for (const sample of ["fastapi", "polyglot", "terraform", "kubernetes", "helm"]) {
    const response = await fetch(`${dashboard}/api/repository?fixture=${sample}`);
    check(`packaged sample: ${sample}`, response.status === 200);
  }
  const traversal = await fetch(`${dashboard}/api/repository?fixture=..%2F..%2Fetc`);
  check("unknown sample names rejected", traversal.status === 404);

  const capabilities = await json(`${dashboard}/api/capabilities`);
  check(
    "capabilities report packaged version",
    capabilities.body.version === expectedVersion,
    capabilities.body.version,
  );
  if (protobufPayload)
    check(
      "capabilities advertise protobuf",
      /protobuf/i.test(capabilities.body.telemetry?.protocol ?? ""),
      capabilities.body.telemetry?.protocol,
    );

  const testTrace = await json(`${dashboard}/api/telemetry/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  check("Send Test Trace", testTrace.status === 200 && testTrace.body.synthetic === true);

  const jsonResponse = await fetch(`${otlp}/v1/traces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(jsonPayload),
  });
  check("OTLP/HTTP JSON accepted", jsonResponse.status === 200);
  if (protobufPayload) {
    const protobufResponse = await fetch(`${otlp}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/x-protobuf" },
      body: protobufPayload,
    });
    check(
      "OTLP/HTTP protobuf accepted",
      protobufResponse.status === 200 &&
        protobufResponse.headers.get("content-type") === "application/x-protobuf",
    );
  }
  if (python) {
    const script = join(scratch, "python example", "app.py");
    mkdirSync(dirname(script), { recursive: true });
    writeFileSync(script, pythonExample);
    const exported = runSync(python, [script], {
      env: {
        ...process.env,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${otlp}/v1/traces`,
        OTEL_SERVICE_NAME: "smoke-python-standard-exporter",
      },
    });
    check(
      "Python standard OTLP protobuf exporter",
      exported.status === 0 && exported.stdout.includes("SUCCESS"),
      exported.stdout.trim() || exported.stderr.trim().split("\n").at(-1),
    );
  }
  // Local HTTP security (M7.4A) against the installed production servers.
  const foreignHost = (port) => ({ Host: `attacker.example:${port}` });
  const hook = JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    session_id: "smoke-security",
    prompt: "smoke",
  });
  const securityChecks = [
    [
      "dashboard rejects a foreign Host",
      `${dashboard}/api/repository`,
      {},
      403,
      foreignHost(ports.dashboard),
    ],
    [
      "dashboard rejects a rebound Host on Codex reads",
      `${dashboard}/api/codex/sessions/smoke-id`,
      {},
      403,
      foreignHost(ports.dashboard),
    ],
    [
      "dashboard rejects localhost.attacker.example",
      `${dashboard}/api/runtime/runs`,
      {},
      403,
      { Host: `localhost.attacker.example:${ports.dashboard}` },
    ],
    [
      "dashboard page rejects a foreign Host",
      `${dashboard}/`,
      {},
      403,
      foreignHost(ports.dashboard),
    ],
    [
      "dashboard accepts localhost Host",
      `${dashboard}/api/health`,
      {},
      200,
      { Host: `localhost:${ports.dashboard}` },
    ],
    [
      "settings rejects a foreign Origin",
      `${dashboard}/api/settings`,
      { method: "POST", body: '{"gettingStartedDismissed":false}' },
      403,
      { Origin: "https://attacker.example", "Content-Type": "application/json" },
    ],
    [
      "settings rejects Origin null",
      `${dashboard}/api/settings`,
      { method: "POST", body: '{"gettingStartedDismissed":false}' },
      403,
      { Origin: "null", "Content-Type": "application/json" },
    ],
    [
      "settings rejects text/plain",
      `${dashboard}/api/settings`,
      { method: "POST", body: '{"gettingStartedDismissed":false}' },
      415,
      { "Content-Type": "text/plain" },
    ],
    [
      "settings accepts the dashboard origin",
      `${dashboard}/api/settings`,
      { method: "POST", body: '{"gettingStartedDismissed":false}' },
      200,
      { Origin: dashboard, "Content-Type": "application/json" },
    ],
    [
      "test trace proxy rejects a foreign Origin",
      `${dashboard}/api/telemetry/test`,
      { method: "POST", body: "{}" },
      403,
      { Origin: "https://attacker.example", "Content-Type": "application/json" },
    ],
    ["collector rejects a foreign Host", `${otlp}/health`, {}, 403, foreignHost(ports.otlp)],
    [
      "OTLP rejects a foreign Host",
      `${otlp}/v1/traces`,
      { method: "POST", body: JSON.stringify(jsonPayload) },
      403,
      { ...foreignHost(ports.otlp), "Content-Type": "application/json" },
    ],
    [
      "Claude hook rejects text/plain",
      `${otlp}/v1/claude/hooks`,
      { method: "POST", body: hook },
      415,
      { "Content-Type": "text/plain" },
    ],
    [
      "Claude hook rejects a foreign Origin",
      `${otlp}/v1/claude/hooks`,
      { method: "POST", body: hook },
      403,
      { Origin: "https://attacker.example", "Content-Type": "application/json" },
    ],
    [
      "Claude hook accepts the Claude Code request",
      `${otlp}/v1/claude/hooks`,
      { method: "POST", body: hook },
      200,
      { "Content-Type": "application/json" },
    ],
    [
      "test trace rejects a bodiless simple POST",
      `${otlp}/v1/avalok/test-trace`,
      { method: "POST" },
      415,
      {},
    ],
    [
      "test trace rejects a foreign Origin",
      `${otlp}/v1/avalok/test-trace`,
      { method: "POST", body: "{}" },
      403,
      { Origin: "https://attacker.example", "Content-Type": "application/json" },
    ],
  ];
  for (const [name, url, init, expected, headers] of securityChecks) {
    const status = await raw(url, { ...init, headers });
    check(`security: ${name}`, status === expected, `HTTP ${status}`);
  }

  const unsupported = await fetch(`${otlp}/v1/traces`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "x",
  });
  check("unsupported content type rejected", unsupported.status === 415);

  const runs = await json(`${dashboard}/api/runtime/runs`);
  const services = runs.body.runs.map((run) => run.title ?? run.id).join(", ");
  const expectedRuns = 2 + (protobufPayload ? 1 : 0) + (python ? 1 : 0);
  check("runs visible to the dashboard", runs.body.runs.length >= expectedRuns, services);
  if (python)
    check(
      "Python trace visible with OpenInference semantics",
      runs.body.runs.some(
        (run) => run.serviceName === "smoke-python-standard-exporter" && run.eventCount === 4,
      ),
    );

  let stopped = await stop(running);
  if (!windows) check("Ctrl+C exits cleanly", stopped.code === 0, JSON.stringify(stopped));
  check("dashboard and OTLP ports released", await portsReleased(ports));

  running = startAvalok(bin, target, ports, environment);
  await running.ready;
  const persisted = await json(`${dashboard}/api/runtime/runs`);
  check(
    "runs persist across restart",
    persisted.body.runs.length === runs.body.runs.length,
    `${persisted.body.runs.length} runs`,
  );
  stopped = await stop(running);
  if (!windows) check("second shutdown clean", stopped.code === 0);
  check("ports released after restart", await portsReleased(ports));

  running = startAvalok(bin, target, ports, environment);
  await running.ready;
  running.child.kill("SIGKILL");
  await running.exited;
  check("force-killed CLI leaves no orphaned dashboard", await portsReleased(ports));

  const clear = runSync(process.execPath, [bin, "data", "clear", "--yes"], { env: environment });
  check("data clear", clear.status === 0);
  check("Avalok runs removed", !existsSync(join(dataRoot, "runtime")));
  check("non-Avalok data untouched", existsSync(outsideSentinel));
  check("target repository untouched", existsSync(join(target, "docker-compose.yml")));
} finally {
  if (workspaceHidden) {
    // Next can recreate only its ignored build cache at the original checkout path while the
    // workspace is hidden. Remove that cache only after checking the entire new tree's shape.
    if (existsSync(repositoryRoot)) {
      const onlyDirectory = (path, name) =>
        lstatSync(path).isDirectory() &&
        readdirSync(path).length === 1 &&
        readdirSync(path)[0] === name;
      const apps = join(repositoryRoot, "apps");
      const web = join(apps, "web");
      const next = join(web, ".next");
      if (
        !onlyDirectory(repositoryRoot, "apps") ||
        !onlyDirectory(apps, "web") ||
        !onlyDirectory(web, ".next") ||
        !lstatSync(next).isDirectory()
      ) {
        throw new Error(`Workspace path was recreated with unexpected files: ${repositoryRoot}`);
      }
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
    renameSync(hiddenWorkspace, repositoryRoot);
    process.stdout.write(`Workspace restored: ${repositoryRoot}\n`);
  }
  if (!flag("--keep")) rmSync(scratch, { recursive: true, force: true });
  else process.stdout.write(`Kept: ${scratch}\n`);
  const failed = results.filter((result) => !result.ok).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} smoke checks passed\n`);
}
