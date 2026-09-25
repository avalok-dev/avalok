import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import { runDetectors } from "./detectors";
import { generateArchitectureGraph } from "./inference";
import { inventoryRepository } from "./inventory";
import { analyzeManifests } from "./manifests";
import { parseSources } from "./source-parser";
import {
  ANALYZER_VERSION,
  defaultAnalysisLimits,
  type AnalysisContext,
  type AnalysisMetrics,
  type AnalyzeRepositoryOptions,
  type RepositoryAnalysis,
} from "./types";

export * from "./types";
export { builtInDetectors, runDetectors } from "./detectors";
export { confidenceFromEvidence, confidenceLabel } from "./confidence";
export { inventoryRepository } from "./inventory";
export { analyzeManifests } from "./manifests";
export { parseSources } from "./source-parser";
export { generateArchitectureGraph } from "./inference";

const analysisCache = new Map<string, RepositoryAnalysis>();

export async function analyzeRepository(
  requestedRoot: string,
  options: AnalyzeRepositoryOptions = {},
): Promise<RepositoryAnalysis> {
  const startedAt = performance.now();
  const limits = { ...defaultAnalysisLimits, ...options.limits };
  const { rootPath, inventory } = await inventoryRepository(requestedRoot, limits);
  const cacheKey = `${ANALYZER_VERSION}\0${rootPath}`;
  const cached = analysisCache.get(cacheKey);
  if (!options.force && cached?.fingerprint === inventory.fingerprint) {
    return {
      ...cached,
      metrics: {
        ...cached.metrics,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        cacheHit: true,
      },
    };
  }

  const diagnostics = [...inventory.diagnostics];
  const manifests = await analyzeManifests(inventory, diagnostics);
  const modules = await parseSources(inventory, manifests, diagnostics);
  const repositoryName = basename(rootPath);
  const context: AnalysisContext = {
    rootPath,
    repositoryName,
    inventory,
    manifests,
    modules,
    diagnostics,
  };
  const signals = runDetectors(context);
  const graph = generateArchitectureGraph(context, signals);
  const unresolvedImports = modules
    .flatMap((module) => module.imports)
    .filter(
      (reference) =>
        reference.expectedLocal === true &&
        !reference.resolvedPath &&
        !reference.workspaceDirectory,
    ).length;
  if (unresolvedImports > 0) {
    diagnostics.push({
      severity: "info",
      code: "imports.unresolved",
      message: `${unresolvedImports} local or aliased imports could not be resolved statically.`,
      stage: "building-imports",
    });
  }
  const workspaceCount =
    manifests.filter((manifest) => manifest.isWorkspace).length ||
    manifests.filter((manifest) => manifest.directory === ".").length;
  const parsedPaths = new Set(modules.map((module) => module.path));
  for (const file of inventory.files) if (file.language === "json") parsedPaths.add(file.path);
  const metrics: AnalysisMetrics = {
    filesDiscovered: inventory.discoveredCount,
    filesParsed: parsedPaths.size,
    filesIgnored: inventory.ignoredCount,
    filesOversized: inventory.oversizedCount,
    packagesDiscovered: workspaceCount,
    importEdges: modules
      .flatMap((module) => module.imports)
      .filter((reference) => reference.resolvedPath || reference.workspaceDirectory).length,
    architectureEntities: graph.entities.length,
    architectureEdges: graph.edges.length,
    unresolvedImports,
    warnings: diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning" || diagnostic.severity === "error",
    ).length,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    cacheHit: false,
  };
  const modulesByPath = new Map(modules.map((module) => [module.path, module]));
  const analysis: RepositoryAnalysis = {
    version: ANALYZER_VERSION,
    repository: { name: repositoryName, rootPath },
    graph,
    files: inventory.files.map((file) => {
      const module = modulesByPath.get(file.path);
      return {
        path: file.path,
        extension: file.extension,
        size: file.size,
        ...(file.language ? { language: file.language } : {}),
        role: file.role,
        imports: module?.imports.map((reference) => reference.specifier) ?? [],
        exports: module?.exports ?? [],
      };
    }),
    technologies: [...new Set(signals.map((signal) => signal.name))].sort(),
    diagnostics,
    metrics,
    stages: [
      "scanning-files",
      "parsing-manifests",
      "building-imports",
      "detecting-architecture",
      "generating-graph",
      "complete",
    ],
    partial: inventory.partialReasons.length > 0,
    partialReasons: inventory.partialReasons,
    fingerprint: inventory.fingerprint,
    analyzedAt: new Date().toISOString(),
  };
  analysisCache.set(cacheKey, analysis);
  return analysis;
}

export function clearAnalysisCache() {
  analysisCache.clear();
}
