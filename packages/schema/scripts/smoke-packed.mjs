#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), "avalok-schema-pack-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;

function run(binary, args, cwd) {
  const result = spawnSync(binary, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, npm_config_cache: join(temporary, "npm-cache") },
  });
  if (result.status !== 0) throw new Error(`${binary} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

try {
  const packedDirectory = join(temporary, "packed");
  const consumer = join(temporary, "consumer");
  mkdirSync(packedDirectory);
  mkdirSync(consumer);
  const [packed] = JSON.parse(
    run(npm, ["pack", "--json", "--pack-destination", packedDirectory], packageRoot),
  );
  assert.equal(packed.name, "@visual-system/schema");
  assert.deepEqual(packed.files.map((entry) => entry.path).sort(), [
    "LICENSE",
    "README.md",
    "dist/index.d.ts",
    "dist/index.js",
    "package.json",
  ]);
  const tarball = join(packedDirectory, packed.filename);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "schema-clean-install-smoke",
      private: true,
      type: "module",
      dependencies: { "@visual-system/schema": `file:${tarball}` },
      devDependencies: { typescript: "5.9.3" },
    }),
  );
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
      },
      include: ["check.ts"],
    }),
  );
  writeFileSync(
    join(consumer, "check.ts"),
    `
    import { RunExportV1Schema } from "@visual-system/schema";
    import type { RunExportV1 } from "@visual-system/schema";
    const payload: RunExportV1 = {
      format: "avalok.run-export", version: 1, source: "demo",
      run: { status: "completed", totalDurationMs: 1, inputTokens: null,
        outputTokens: null, toolCallCount: 0, modelCallCount: 0 },
      entities: [], events: []
    };
    RunExportV1Schema.parse(payload);
  `,
  );
  writeFileSync(
    join(consumer, "check.mjs"),
    `
    import assert from "node:assert/strict";
    import { RunExportV1Schema } from "@visual-system/schema";
    const payload = {
      format: "avalok.run-export", version: 1, source: "demo",
      run: { status: "completed", totalDurationMs: 1, inputTokens: null,
        outputTokens: null, toolCallCount: 0, modelCallCount: 0 },
      entities: [], events: []
    };
    assert.equal(RunExportV1Schema.safeParse(payload).success, true);
    assert.equal(RunExportV1Schema.safeParse({ ...payload, version: 2 }).success, false);
    assert.equal(RunExportV1Schema.safeParse({ ...payload, prompt: "content" }).success, false);
  `,
  );
  run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
  const installed = JSON.parse(
    readFileSync(
      join(consumer, "node_modules", "@visual-system", "schema", "package.json"),
      "utf8",
    ),
  );
  assert.equal(installed.version, packed.version);
  assert.equal(installed.exports["."].import, "./dist/index.js");
  assert.equal(installed.exports["."].types, "./dist/index.d.ts");
  run(node, ["check.mjs"], consumer);
  run(
    join(consumer, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc"),
    ["--noEmit"],
    consumer,
  );
  process.stdout.write(`Clean packed install passed: ${packed.name}@${packed.version}\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
