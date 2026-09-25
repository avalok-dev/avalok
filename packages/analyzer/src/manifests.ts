import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnalysisDiagnostic, FileInventory, PackageManifest } from "./types";

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function stringRecord(value: unknown) {
  const record = objectRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function workspacePatterns(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  const record = objectRecord(value);
  return Array.isArray(record?.packages)
    ? record.packages.filter((item): item is string => typeof item === "string")
    : [];
}

function yamlWorkspacePatterns(body: string) {
  const patterns: string[] = [];
  let inPackages = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) break;
    const match = inPackages ? line.match(/^\s*-\s*["']?([^"']+?)["']?\s*$/) : undefined;
    if (match?.[1]) patterns.push(match[1]);
  }
  return patterns;
}

function patternRegex(pattern: string) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]+")
    .replace(/__DOUBLE_STAR__/g, ".+");
  return new RegExp(`^${escaped}/?$`);
}

export async function analyzeManifests(
  inventory: FileInventory,
  diagnostics: AnalysisDiagnostic[],
): Promise<PackageManifest[]> {
  const packageFiles = inventory.files.filter(
    (file) => file.path === "package.json" || file.path.endsWith("/package.json"),
  );
  const rootPackage = packageFiles.find((file) => file.path === "package.json");
  let rootPatterns: string[] = [];

  if (rootPackage) {
    try {
      const parsed = JSON.parse(await readFile(rootPackage.absolutePath, "utf8")) as unknown;
      rootPatterns = workspacePatterns(objectRecord(parsed)?.workspaces);
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "manifest.invalid-json",
        message: error instanceof Error ? error.message : "Invalid package.json.",
        file: rootPackage.path,
        stage: "parsing-manifests",
      });
    }
  }

  const pnpmWorkspace = inventory.files.find((file) =>
    ["pnpm-workspace.yaml", "pnpm-workspace.yml"].includes(file.path),
  );
  if (pnpmWorkspace) {
    try {
      rootPatterns.push(
        ...yamlWorkspacePatterns(await readFile(pnpmWorkspace.absolutePath, "utf8")),
      );
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "manifest.workspace-unreadable",
        message:
          error instanceof Error ? error.message : "Workspace configuration could not be read.",
        file: pnpmWorkspace.path,
        stage: "parsing-manifests",
      });
    }
  }
  rootPatterns = [...new Set(rootPatterns)];
  const workspaceMatchers = rootPatterns.map(patternRegex);
  const manifests: PackageManifest[] = [];

  for (const file of packageFiles) {
    try {
      const parsed = objectRecord(JSON.parse(await readFile(file.absolutePath, "utf8")) as unknown);
      if (!parsed) throw new Error("package.json must contain an object.");
      const directory = dirname(file.path) === "." ? "." : dirname(file.path);
      const fallbackName =
        directory === "." ? "repository" : (directory.split("/").at(-1) ?? "package");
      const name = typeof parsed.name === "string" ? parsed.name : fallbackName;
      const isWorkspace =
        rootPatterns.length === 0
          ? directory === "."
          : directory !== "." && workspaceMatchers.some((matcher) => matcher.test(directory));
      manifests.push({
        path: file.path,
        directory,
        name,
        ...(typeof parsed.version === "string" ? { version: parsed.version } : {}),
        dependencies: stringRecord(parsed.dependencies),
        devDependencies: stringRecord(parsed.devDependencies),
        scripts: stringRecord(parsed.scripts),
        workspacePatterns: directory === "." ? rootPatterns : [],
        isWorkspace,
      });
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "manifest.invalid-json",
        message: error instanceof Error ? error.message : "Invalid package.json.",
        file: file.path,
        stage: "parsing-manifests",
      });
    }
  }

  return manifests.sort((left, right) => left.directory.localeCompare(right.directory));
}
