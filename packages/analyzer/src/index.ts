import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import { runDetectors } from "./detectors";
import { confidenceLabel } from "./confidence";
import { analyzeCompose, analyzeDockerfiles } from "./configuration";
import { analyzeInfrastructure, mergeInfrastructureGraph } from "./infrastructure";
import { generateArchitectureGraph } from "./inference";
import { inventoryRepository } from "./inventory";
import { analyzeManifests } from "./manifests";
import { parseSources } from "./source-parser";
import { discoverServices } from "./services";
import {
  ANALYZER_VERSION,
  defaultAnalysisLimits,
  type AnalysisContext,
  type AnalysisMetrics,
  type AnalyzeRepositoryOptions,
  type RepositoryAnalysis,
  type ArchitectureMetadata,
  type RepositoryLanguage,
} from "./types";

export * from "./types";
export { builtInDetectors, runDetectors } from "./detectors";
export { confidenceFromEvidence, confidenceLabel } from "./confidence";
export { inventoryRepository } from "./inventory";
export { analyzeManifests } from "./manifests";
export { parseSources } from "./source-parser";
export { generateArchitectureGraph } from "./inference";
export { analyzeCompose, analyzeDockerfiles } from "./configuration";
export { analyzeInfrastructure, mergeInfrastructureGraph } from "./infrastructure";
export { analyzeTerraform } from "./terraform";
export { analyzeKubernetes, analyzeKubernetesSource } from "./kubernetes";
export { analyzeHelm } from "./helm";
export { discoverServices, serviceForPath } from "./services";

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
  const dockerfiles = await analyzeDockerfiles(inventory, diagnostics);
  const compose = await analyzeCompose(inventory, diagnostics);
  const infrastructure = await analyzeInfrastructure(inventory);
  diagnostics.push(...infrastructure.diagnostics);
  const services = discoverServices(inventory, manifests, dockerfiles, compose);
  const modules = await parseSources(inventory, manifests, diagnostics);
  const repositoryName = basename(rootPath);
  const context: AnalysisContext = {
    rootPath,
    repositoryName,
    inventory,
    manifests,
    modules,
    services,
    dockerfiles,
    compose,
    infrastructure,
    diagnostics,
  };
  const signals = runDetectors(context);
  const graph = mergeInfrastructureGraph(
    generateArchitectureGraph(context, signals),
    infrastructure,
  );
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
  const workspaceCount = services.length;
  const parsedPaths = new Set(modules.map((module) => module.path));
  for (const file of inventory.files) if (file.language === "json") parsedPaths.add(file.path);
  for (const file of inventory.files)
    if (["yaml", "dockerfile", "terraform"].includes(file.language ?? ""))
      parsedPaths.add(file.path);
  const languageTotals = new Map<RepositoryLanguage | "other", { files: number; bytes: number }>();
  for (const file of inventory.files) {
    const language = file.language ?? "other";
    const current = languageTotals.get(language) ?? { files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += file.size;
    languageTotals.set(language, current);
  }
  const totalLanguageBytes = [...languageTotals.values()].reduce(
    (sum, item) => sum + item.bytes,
    0,
  );
  const deepLanguages = new Set([
    "typescript",
    "javascript",
    "python",
    "json",
    "yaml",
    "dockerfile",
    "terraform",
  ]);
  const unsupported = [...languageTotals.keys()].filter(
    (language) => language !== "other" && !deepLanguages.has(language),
  );
  for (const language of unsupported)
    diagnostics.push({
      severity: "info",
      code: "language.inventory-only",
      message: `${language} detected; static architecture analysis is not yet supported.`,
      stage: "detecting-architecture",
    });
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
    servicesDiscovered: services.length,
    languagesDetected: languageTotals.size,
    dockerfilesParsed: dockerfiles.length,
    composeServices: compose.reduce((sum, item) => sum + item.services.length, 0),
    terraformFiles: infrastructure.terraformFiles,
    kubernetesDocuments: infrastructure.kubernetesDocuments,
    helmCharts: infrastructure.helmCharts,
    infrastructureResources: infrastructure.resources.length,
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
    technologies: [
      ...new Set([
        ...signals.map((signal) => signal.name),
        ...infrastructure.resources.map((item) => item.provider ?? item.platform),
      ]),
    ].sort(),
    summary: {
      languages: [...languageTotals]
        .map(([language, value]) => ({
          language,
          files: value.files,
          bytes: value.bytes,
          percentage:
            totalLanguageBytes === 0
              ? 0
              : Math.round((value.bytes / totalLanguageBytes) * 1_000) / 10,
          analysis: deepLanguages.has(language)
            ? ("supported" as const)
            : ("inventory-only" as const),
        }))
        .sort(
          (left, right) => right.bytes - left.bytes || left.language.localeCompare(right.language),
        ),
      applications: graph.entities.filter((entity) => entity.kind === "frontend").length,
      services: services.length,
      databases: graph.entities.filter((entity) => entity.kind === "database").length,
      externalIntegrations: graph.entities.filter((entity) => {
        const category = (entity.metadata?.architecture as ArchitectureMetadata | undefined)
          ?.category;
        return category === "integration" && entity.kind !== "database";
      }).length,
      architectureConfidence: confidenceLabel(
        graph.entities.length === 0
          ? 0
          : graph.entities.reduce(
              (sum, entity) =>
                sum +
                ((entity.metadata?.architecture as ArchitectureMetadata | undefined)?.confidence ??
                  0),
              0,
            ) / graph.entities.length,
      ),
      filesAnalyzed: parsedPaths.size,
    },
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
