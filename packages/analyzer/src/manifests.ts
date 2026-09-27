import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { parse as parseToml } from "smol-toml";
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

const normalizePythonDependency = (value: string) =>
  value
    .trim()
    .match(/^([A-Za-z0-9_.-]+)/)?.[1]
    ?.toLowerCase()
    .replaceAll("_", "-");

function pythonDependencyRecord(value: unknown) {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.flatMap((item) => {
        if (typeof item !== "string") return [];
        const name = normalizePythonDependency(item);
        return name ? [[name, item.slice(name.length).trim() || "*"]] : [];
      }),
    );
  }
  const record = objectRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([name, constraint]) => {
      const normalized = normalizePythonDependency(name);
      if (!normalized || normalized === "python") return [];
      return [[normalized, typeof constraint === "string" ? constraint : "*"]];
    }),
  );
}

function requirementsDependencies(body: string) {
  const invalidLines: number[] = [];
  const dependencies = Object.fromEntries(
    body.split(/\r?\n/).flatMap((rawLine, index) => {
      const line = rawLine.replace(/\s+#.*$/, "").trim();
      if (!line || line.startsWith("-") || /^https?:/i.test(line)) return [];
      const name = normalizePythonDependency(line);
      if (!name) invalidLines.push(index + 1);
      return name ? [[name, line.slice(name.length).trim() || "*"]] : [];
    }),
  );
  return { dependencies, invalidLines };
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
        ecosystem: "node",
        runtime: "node",
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
  for (const file of inventory.files.filter((item) => basename(item.path) === "pyproject.toml")) {
    try {
      const parsed = objectRecord(
        parseToml(await readFile(file.absolutePath, "utf8"), { unsafeKeyBehaviour: "drop" }),
      );
      if (!parsed) throw new Error("pyproject.toml must contain a table.");
      const project = objectRecord(parsed.project);
      const tool = objectRecord(parsed.tool);
      const poetry = objectRecord(tool?.poetry);
      const directory = dirname(file.path) === "." ? "." : dirname(file.path);
      const fallbackName = directory === "." ? "python-service" : basename(directory);
      const dependencies = {
        ...pythonDependencyRecord(project?.dependencies),
        ...pythonDependencyRecord(poetry?.dependencies),
      };
      const optional = objectRecord(project?.["optional-dependencies"]);
      const devDependencies = {
        ...Object.values(optional ?? {}).reduce<Record<string, string>>(
          (result, group) => ({ ...result, ...pythonDependencyRecord(group) }),
          {},
        ),
        ...pythonDependencyRecord(
          objectRecord(objectRecord(objectRecord(poetry?.group)?.dev)?.dependencies),
        ),
        ...pythonDependencyRecord(poetry?.["dev-dependencies"]),
      };
      manifests.push({
        path: file.path,
        directory,
        name:
          typeof project?.name === "string"
            ? project.name
            : typeof poetry?.name === "string"
              ? poetry.name
              : fallbackName,
        ...(typeof project?.version === "string"
          ? { version: project.version }
          : typeof poetry?.version === "string"
            ? { version: poetry.version }
            : {}),
        dependencies,
        devDependencies,
        scripts: {},
        workspacePatterns: [],
        isWorkspace: true,
        ecosystem: "python",
        runtime: "python",
      });
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "manifest.invalid-pyproject",
        message: error instanceof Error ? error.message : "Invalid pyproject.toml.",
        file: file.path,
        stage: "parsing-manifests",
      });
    }
  }

  const requirementFiles = inventory.files.filter(
    (file) =>
      basename(file.path) === "requirements.txt" ||
      /(?:^|\/)requirements\/[^/]+\.txt$/i.test(file.path),
  );
  const requirementsByDirectory = new Map<string, Record<string, string>>();
  for (const file of requirementFiles) {
    const directory = /(?:^|\/)requirements\/[^/]+\.txt$/i.test(file.path)
      ? dirname(dirname(file.path))
      : dirname(file.path);
    try {
      const parsedRequirements = requirementsDependencies(
        await readFile(file.absolutePath, "utf8"),
      );
      requirementsByDirectory.set(directory, {
        ...(requirementsByDirectory.get(directory) ?? {}),
        ...parsedRequirements.dependencies,
      });
      for (const line of parsedRequirements.invalidLines)
        diagnostics.push({
          severity: "warning",
          code: "manifest.requirements-invalid",
          message: "Requirement line could not be parsed and was ignored.",
          file: file.path,
          line,
          stage: "parsing-manifests",
        });
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "manifest.requirements-unreadable",
        message: error instanceof Error ? error.message : "Requirements could not be read.",
        file: file.path,
        stage: "parsing-manifests",
      });
    }
  }

  for (const [directory, dependencies] of requirementsByDirectory) {
    const existing = manifests.find(
      (manifest) => manifest.ecosystem === "python" && manifest.directory === directory,
    );
    if (existing) {
      existing.dependencies = { ...existing.dependencies, ...dependencies };
      continue;
    }
    const path = requirementFiles.find((file) => {
      const owner = /(?:^|\/)requirements\/[^/]+\.txt$/i.test(file.path)
        ? dirname(dirname(file.path))
        : dirname(file.path);
      return owner === directory;
    })?.path;
    if (!path) continue;
    manifests.push({
      path,
      directory,
      name: directory === "." ? "python-service" : basename(directory),
      dependencies,
      devDependencies: {},
      scripts: {},
      workspacePatterns: [],
      isWorkspace: true,
      ecosystem: "python",
      runtime: "python",
    });
  }

  for (const file of inventory.files.filter((item) => basename(item.path) === "Pipfile")) {
    const directory = dirname(file.path) === "." ? "." : dirname(file.path);
    try {
      const parsed = objectRecord(
        parseToml(await readFile(file.absolutePath, "utf8"), { unsafeKeyBehaviour: "drop" }),
      );
      const dependencies = pythonDependencyRecord(parsed?.packages);
      const devDependencies = pythonDependencyRecord(parsed?.["dev-packages"]);
      const existing = manifests.find(
        (manifest) => manifest.ecosystem === "python" && manifest.directory === directory,
      );
      if (existing) {
        existing.dependencies = { ...existing.dependencies, ...dependencies };
        existing.devDependencies = { ...existing.devDependencies, ...devDependencies };
      } else {
        manifests.push({
          path: file.path,
          directory,
          name: directory === "." ? "python-service" : basename(directory),
          dependencies,
          devDependencies,
          scripts: {},
          workspacePatterns: [],
          isWorkspace: true,
          ecosystem: "python",
          runtime: "python",
        });
      }
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "manifest.invalid-pipfile",
        message: error instanceof Error ? error.message : "Invalid Pipfile.",
        file: file.path,
        stage: "parsing-manifests",
      });
    }
  }

  return manifests.sort(
    (left, right) =>
      left.directory.localeCompare(right.directory) ||
      left.ecosystem.localeCompare(right.ecosystem),
  );
}
