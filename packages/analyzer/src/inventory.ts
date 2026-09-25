import { createHash } from "node:crypto";
import { open, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type {
  AnalysisDiagnostic,
  AnalysisLimits,
  FileInventory,
  FileRole,
  InventoryFile,
  SupportedLanguage,
} from "./types";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".nyc_output",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "out",
  "target",
  "tmp",
  "temp",
]);

const binaryExtensions = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".bmp",
  ".class",
  ".dmg",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".png",
  ".so",
  ".tar",
  ".tgz",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".zip",
]);

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const configNames = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "turbo.json",
  "pnpm-workspace.yaml",
  "pnpm-workspace.yml",
]);

const toPosix = (value: string) => value.split(sep).join("/");

function languageFor(extension: string): SupportedLanguage | undefined {
  if ([".ts", ".tsx"].includes(extension)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return "javascript";
  if (extension === ".json") return "json";
  return undefined;
}

function roleFor(path: string, extension: string): FileRole {
  const name = basename(path);
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|tests?|fixtures)\//.test(path))
    return "test";
  if (/\.generated\.|\.gen\.|\.min\.[jt]s$|\.tsbuildinfo$/.test(path)) return "generated";
  if (sourceExtensions.has(extension)) return "source";
  if (configNames.has(name) || /(?:^|\.)config\.[cm]?[jt]s$/.test(name) || extension === ".json")
    return "config";
  if ([".md", ".mdx", ".txt", ".rst"].includes(extension)) return "documentation";
  if ([".css", ".scss", ".sass", ".less", ".svg"].includes(extension)) return "asset";
  return "unknown";
}

function regexForGitignore(pattern: string) {
  const anchored = pattern.startsWith("/");
  const directory = pattern.endsWith("/");
  const clean = pattern.replace(/^\//, "").replace(/\/$/, "");
  const escaped = clean
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/__DOUBLE_STAR__/g, ".*");
  const prefix = anchored ? "^" : "(?:^|/)";
  return new RegExp(`${prefix}${escaped}${directory ? "(?:/|$)" : "$"}`);
}

async function readGitignore(rootPath: string) {
  try {
    const body = await readFile(join(rootPath, ".gitignore"), "utf8");
    return body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
      .map(regexForGitignore);
  } catch {
    return [];
  }
}

async function looksBinary(path: string) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    for (let index = 0; index < bytesRead; index += 1) {
      if (buffer[index] === 0) return true;
    }
    return false;
  } finally {
    await handle.close();
  }
}

function isSecretEnvironmentFile(name: string) {
  if (!name.startsWith(".env")) return false;
  return !/(?:example|sample|template)$/.test(name);
}

export async function inventoryRepository(
  requestedRoot: string,
  limits: AnalysisLimits,
): Promise<{ rootPath: string; inventory: FileInventory }> {
  const rootPath = await realpath(requestedRoot);
  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) throw new Error("Repository target must be a directory.");

  const gitignore = await readGitignore(rootPath);
  const files: InventoryFile[] = [];
  const diagnostics: AnalysisDiagnostic[] = [];
  const partialReasons: string[] = [];
  let discoveredCount = 0;
  let ignoredCount = 0;
  let oversizedCount = 0;
  let binaryCount = 0;
  let totalEligibleBytes = 0;
  let stopped = false;

  const visit = async (directory: string): Promise<void> => {
    if (stopped) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "inventory.directory-unreadable",
        message: error instanceof Error ? error.message : "Directory could not be read.",
        file: toPosix(relative(rootPath, directory)) || ".",
        stage: "scanning-files",
      });
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (stopped) return;
      const absolutePath = join(directory, entry.name);
      const relativePath = toPosix(relative(rootPath, absolutePath));
      if (entry.isSymbolicLink()) {
        ignoredCount += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (
          ignoredDirectories.has(entry.name) ||
          gitignore.some((pattern) => pattern.test(`${relativePath}/`))
        ) {
          ignoredCount += 1;
          continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      discoveredCount += 1;
      if (discoveredCount > limits.maxFiles) {
        const reason = `File limit reached (${limits.maxFiles}).`;
        partialReasons.push(reason);
        diagnostics.push({
          severity: "warning",
          code: "limit.files",
          message: reason,
          stage: "scanning-files",
        });
        stopped = true;
        return;
      }
      if (
        gitignore.some((pattern) => pattern.test(relativePath)) ||
        isSecretEnvironmentFile(entry.name)
      ) {
        ignoredCount += 1;
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (binaryExtensions.has(extension)) {
        binaryCount += 1;
        ignoredCount += 1;
        continue;
      }
      let fileStat;
      try {
        fileStat = await stat(absolutePath);
      } catch {
        ignoredCount += 1;
        continue;
      }
      if (fileStat.size > limits.maxFileBytes) {
        oversizedCount += 1;
        ignoredCount += 1;
        continue;
      }
      if (fileStat.size > 0 && (await looksBinary(absolutePath))) {
        binaryCount += 1;
        ignoredCount += 1;
        continue;
      }
      if (totalEligibleBytes + fileStat.size > limits.maxTotalBytes) {
        const reason = `Parsed byte limit reached (${limits.maxTotalBytes} bytes).`;
        if (!partialReasons.includes(reason)) {
          partialReasons.push(reason);
          diagnostics.push({
            severity: "warning",
            code: "limit.bytes",
            message: reason,
            stage: "scanning-files",
          });
        }
        ignoredCount += 1;
        continue;
      }
      totalEligibleBytes += fileStat.size;
      const language = languageFor(extension);
      files.push({
        path: relativePath,
        absolutePath,
        extension,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        directory: toPosix(relative(rootPath, directory)) || ".",
        ...(language ? { language } : {}),
        role: roleFor(relativePath, extension),
      });
    }
  };

  await visit(rootPath);
  const hash = createHash("sha256");
  for (const file of files)
    hash.update(`${file.path}\0${file.size}\0${Math.floor(file.mtimeMs)}\n`);
  return {
    rootPath,
    inventory: {
      files,
      discoveredCount: Math.min(discoveredCount, limits.maxFiles),
      ignoredCount,
      oversizedCount,
      binaryCount,
      totalEligibleBytes,
      partialReasons,
      diagnostics,
      fingerprint: hash.digest("hex"),
    },
  };
}
