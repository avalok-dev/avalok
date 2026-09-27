import type { ArchitectureGraph, EntityKind, ResourceMetric } from "@visual-system/schema";

export const ANALYZER_VERSION = "6.0.0";

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

export type RepositoryLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "json"
  | "yaml"
  | "dockerfile"
  | "terraform"
  | "go"
  | "java"
  | "kotlin"
  | "rust"
  | "ruby"
  | "php"
  | "csharp"
  | "swift"
  | "c"
  | "cpp";
export type SupportedLanguage =
  "typescript" | "javascript" | "python" | "json" | "yaml" | "dockerfile" | "terraform";
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
  language?: RepositoryLanguage;
  role: FileRole;
}

export interface PublicAnalyzedFile {
  path: string;
  extension: string;
  size: number;
  language?: RepositoryLanguage;
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
  ecosystem: "node" | "python";
  runtime: "node" | "python";
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
  style: "next-app" | "express" | "fastify" | "fastapi" | "flask" | "django";
  line?: number;
}

export interface CallSignal {
  callee: string;
  line: number;
  literalArguments: string[];
}

export interface SourceModule {
  path: string;
  language?: "typescript" | "javascript" | "python" | "environment";
  imports: ImportReference[];
  exports: string[];
  declarations: string[];
  environmentVariables: Array<{ name: string; line: number }>;
  externalHosts: Array<{ host: string; line: number }>;
  routes: RouteSignal[];
  calls: CallSignal[];
  decorators: Array<{ name: string; line: number }>;
  connectionSchemes: Array<{ scheme: string; line: number }>;
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
    | "call"
    | "decorator"
    | "dockerfile"
    | "compose-service"
    | "compose-dependency"
    | "connection-scheme"
    | "terraform-block"
    | "terraform-reference"
    | "kubernetes-manifest"
    | "kubernetes-selector"
    | "helm-chart"
    | "helm-value"
    | "infrastructure-reconciliation";
  file: string;
  line?: number;
  description: string;
  weight: number;
}

export interface ArchitectureMetadata {
  category:
    | "application"
    | "service"
    | "package"
    | "component"
    | "route"
    | "integration"
    | "repository"
    | "infrastructure";
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
  languages?: string[];
  routes?: Array<{ path: string; methods: string[]; file: string; line?: number }>;
  ports?: number[];
  composeServices?: string[];
  runtimeNames?: string[];
  level?: "system" | "component";
  staticStatus?: "detected" | "inferred";
  partial?: boolean;
  layer?: "application" | "infrastructure" | "runtime";
  layers?: Array<"application" | "infrastructure" | "runtime">;
  platform?: "terraform" | "kubernetes" | "helm" | "aws";
  infrastructureKind?: string;
  resourceType?: string;
  address?: string;
  namespace?: string;
  visibility?: "system" | "detail";
  hierarchyParentId?: string;
  childIds?: string[];
  childSummaries?: string[];
  images?: string[];
  labels?: Record<string, string>;
  selectors?: Record<string, string>;
  references?: string[];
  details?: Record<string, string | number | boolean | string[]>;
  metrics?: ResourceMetric[];
}

export interface ArchitectureEdgeMetadata {
  relationship:
    | "workspace-dependency"
    | "source-import"
    | "contains-route"
    | "uses-integration"
    | "deployment-dependency"
    | "calls-service"
    | "deployed-as"
    | "contains"
    | "references"
    | "routes-to"
    | "selects"
    | "mounts"
    | "uses-config"
    | "uses-secret"
    | "uses-identity"
    | "scales"
    | "managed-by"
    | "configured-by"
    | "runs-on";
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

export interface DockerfileAnalysis {
  path: string;
  directory: string;
  stages: Array<{ image: string; alias?: string; line: number }>;
  workdir?: string;
  copiedPaths: string[];
  exposedPorts: number[];
  entrypoint?: string[];
  command?: string[];
  environmentVariables: string[];
}

export interface ComposeServiceAnalysis {
  name: string;
  file: string;
  buildContext?: string;
  dockerfile?: string;
  image?: string;
  ports: Array<{ published?: number; target: number }>;
  dependsOn: string[];
  networks: string[];
  volumes: string[];
  environmentVariables: string[];
  hasHealthcheck: boolean;
}

export interface ComposeAnalysis {
  path: string;
  services: ComposeServiceAnalysis[];
}

export interface ServiceUnit {
  id: string;
  directory: string;
  name: string;
  declaredName?: string;
  manifestPath?: string;
  ecosystems: Array<"node" | "python" | "container">;
  languages: RepositoryLanguage[];
  sourceFiles: string[];
  composeServices: string[];
  dockerfiles: string[];
  ports: number[];
  evidence: ArchitectureEvidence[];
}

export interface LanguageSummary {
  language: RepositoryLanguage | "other";
  files: number;
  bytes: number;
  percentage: number;
  analysis: "supported" | "inventory-only";
}

export interface RepositorySummary {
  languages: LanguageSummary[];
  applications: number;
  services: number;
  databases: number;
  externalIntegrations: number;
  architectureConfidence: ConfidenceLabel;
  filesAnalyzed: number;
}

export interface AnalysisContext {
  rootPath: string;
  repositoryName: string;
  inventory: FileInventory;
  manifests: PackageManifest[];
  modules: SourceModule[];
  services: ServiceUnit[];
  dockerfiles: DockerfileAnalysis[];
  compose: ComposeAnalysis[];
  infrastructure: InfrastructureAnalysis;
  diagnostics: AnalysisDiagnostic[];
}

export interface InfrastructureResource {
  id: string;
  name: string;
  kind: EntityKind;
  platform: "terraform" | "kubernetes" | "helm" | "aws";
  provider?: string;
  infrastructureKind: string;
  resourceType: string;
  address: string;
  file: string;
  line?: number;
  namespace?: string;
  group?: string;
  hierarchyParentId?: string;
  visibility: "system" | "detail";
  labels: Record<string, string>;
  selectors: Record<string, string>;
  images: string[];
  ports: number[];
  references: string[];
  details: Record<string, string | number | boolean | string[]>;
  metrics: ResourceMetric[];
  evidence: ArchitectureEvidence[];
  confidence: number;
}

export interface InfrastructureRelationship {
  source: string;
  target: string;
  relationship: ArchitectureEdgeMetadata["relationship"];
  evidence: ArchitectureEvidence[];
  confidence: number;
}

export interface InfrastructureAnalysis {
  resources: InfrastructureResource[];
  relationships: InfrastructureRelationship[];
  diagnostics: AnalysisDiagnostic[];
  terraformFiles: number;
  kubernetesDocuments: number;
  helmCharts: number;
}

export interface ArchitectureDetector {
  id: string;
  detect(context: AnalysisContext): DetectorSignal[];
}

export interface SourceAnalyzerAdapter {
  id: string;
  supports(file: InventoryFile): boolean;
  analyze(
    file: InventoryFile,
    context: {
      inventory: FileInventory;
      manifests: PackageManifest[];
      diagnostics: AnalysisDiagnostic[];
    },
  ): Promise<SourceModule | undefined>;
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
  servicesDiscovered: number;
  languagesDetected: number;
  dockerfilesParsed: number;
  composeServices: number;
  terraformFiles: number;
  kubernetesDocuments: number;
  helmCharts: number;
  infrastructureResources: number;
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
  summary: RepositorySummary;
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
