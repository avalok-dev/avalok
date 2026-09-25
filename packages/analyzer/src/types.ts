import type { ArchitectureGraph, EntityKind } from "@visual-system/schema";

export const ANALYZER_VERSION = "3.0.0";

export interface AnalysisLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const defaultAnalysisLimits: AnalysisLimits = {
  maxFiles: 10_000,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 26_214_400,
};

export type SupportedLanguage = "typescript" | "javascript" | "json";
export type FileRole =
  "source" | "test" | "config" | "documentation" | "generated" | "asset" | "unknown";
export type ConfidenceLabel = "confirmed" | "high" | "medium" | "low";

export interface AnalysisDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  file?: string;
  line?: number;
  stage?: AnalysisStage;
}

export type AnalysisStage =
  | "scanning-files"
  | "parsing-manifests"
  | "building-imports"
  | "detecting-architecture"
  | "generating-graph"
  | "complete";

export interface InventoryFile {
  path: string;
  absolutePath: string;
  extension: string;
  size: number;
  mtimeMs: number;
  directory: string;
  language?: SupportedLanguage;
  role: FileRole;
}

export interface PublicAnalyzedFile {
  path: string;
  extension: string;
  size: number;
  language?: SupportedLanguage;
  role: FileRole;
  imports: string[];
  exports: string[];
}

export interface FileInventory {
  files: InventoryFile[];
  discoveredCount: number;
  ignoredCount: number;
  oversizedCount: number;
  binaryCount: number;
  totalEligibleBytes: number;
  partialReasons: string[];
  diagnostics: AnalysisDiagnostic[];
  fingerprint: string;
}

export interface PackageManifest {
  path: string;
  directory: string;
  name: string;
  version?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  workspacePatterns: string[];
  isWorkspace: boolean;
}

export interface ImportReference {
  specifier: string;
  line: number;
  kind: "import" | "export" | "dynamic" | "require";
  resolvedPath?: string;
  workspaceDirectory?: string;
  expectedLocal?: boolean;
}

export interface RouteSignal {
  path: string;
  methods: string[];
  style: "next-app" | "express" | "fastify";
  line?: number;
}

export interface SourceModule {
  path: string;
  imports: ImportReference[];
  exports: string[];
  declarations: string[];
  environmentVariables: Array<{ name: string; line: number }>;
  externalHosts: Array<{ host: string; line: number }>;
  routes: RouteSignal[];
  parseError?: string;
}

export interface ArchitectureEvidence {
  kind:
    | "workspace"
    | "manifest"
    | "dependency"
    | "import"
    | "source"
    | "framework-convention"
    | "route"
    | "environment"
    | "external-host"
    | "call";
  file: string;
  line?: number;
  description: string;
  weight: number;
}

export interface ArchitectureMetadata {
  category: "application" | "package" | "route" | "integration" | "repository";
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  evidence: ArchitectureEvidence[];
  parentId?: string;
  group?: string;
  directory?: string;
  technologies: string[];
  sourceFiles: string[];
  fileCount: number;
  dependencies: string[];
  partial?: boolean;
}

export interface ArchitectureEdgeMetadata {
  relationship: "workspace-dependency" | "source-import" | "contains-route" | "uses-integration";
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  evidence: ArchitectureEvidence[];
  runtime?: boolean;
}

export interface DetectorSignal {
  detectorId: string;
  name: string;
  category: "framework" | "library" | "integration" | "database" | "orm" | "runtime";
  kind: EntityKind;
  workspaceDirectory: string;
  evidence: ArchitectureEvidence[];
  confidence: number;
  promoteToEntity: boolean;
}

export interface AnalysisContext {
  rootPath: string;
  repositoryName: string;
  inventory: FileInventory;
  manifests: PackageManifest[];
  modules: SourceModule[];
  diagnostics: AnalysisDiagnostic[];
}

export interface ArchitectureDetector {
  id: string;
  detect(context: AnalysisContext): DetectorSignal[];
}

export interface AnalysisMetrics {
  filesDiscovered: number;
  filesParsed: number;
  filesIgnored: number;
  filesOversized: number;
  packagesDiscovered: number;
  importEdges: number;
  architectureEntities: number;
  architectureEdges: number;
  unresolvedImports: number;
  warnings: number;
  durationMs: number;
  cacheHit: boolean;
}

export interface RepositoryAnalysis {
  version: string;
  repository: {
    name: string;
    rootPath: string;
  };
  graph: ArchitectureGraph;
  files: PublicAnalyzedFile[];
  technologies: string[];
  diagnostics: AnalysisDiagnostic[];
  metrics: AnalysisMetrics;
  stages: AnalysisStage[];
  partial: boolean;
  partialReasons: string[];
  fingerprint: string;
  analyzedAt: string;
}

export interface AnalyzeRepositoryOptions {
  limits?: Partial<AnalysisLimits>;
  force?: boolean;
}
