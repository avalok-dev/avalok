import type { EntityKind } from "@visual-system/schema";
import { confidenceFromEvidence } from "./confidence";
import type {
  AnalysisContext,
  ArchitectureDetector,
  ArchitectureEvidence,
  DetectorSignal,
  PackageManifest,
} from "./types";

interface DetectorDefinition {
  id: string;
  name: string;
  category: DetectorSignal["category"];
  kind: EntityKind;
  packages: string[];
  environment?: RegExp;
  hosts?: RegExp;
  promoteToEntity?: boolean;
}

const definitions: DetectorDefinition[] = [
  { id: "nextjs", name: "Next.js", category: "framework", kind: "frontend", packages: ["next"] },
  {
    id: "react",
    name: "React",
    category: "framework",
    kind: "frontend",
    packages: ["react", "react-dom"],
  },
  {
    id: "react-flow",
    name: "React Flow",
    category: "library",
    kind: "frontend",
    packages: ["@xyflow/react", "reactflow"],
  },
  { id: "zustand", name: "Zustand", category: "library", kind: "memory", packages: ["zustand"] },
  { id: "elk", name: "ELK", category: "library", kind: "tool", packages: ["elkjs"] },
  { id: "zod", name: "Zod", category: "library", kind: "tool", packages: ["zod"] },
  {
    id: "openai",
    name: "OpenAI",
    category: "integration",
    kind: "model",
    packages: ["openai", "@openai/agents"],
    environment: /^OPENAI_/,
    hosts: /(?:^|\.)openai\.com$/i,
    promoteToEntity: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    category: "integration",
    kind: "model",
    packages: ["@anthropic-ai/sdk"],
    environment: /^ANTHROPIC_/,
    hosts: /(?:^|\.)anthropic\.com$/i,
    promoteToEntity: true,
  },
  {
    id: "mcp",
    name: "MCP",
    category: "integration",
    kind: "mcp_server",
    packages: ["@modelcontextprotocol/sdk"],
    promoteToEntity: true,
  },
  {
    id: "opentelemetry",
    name: "OpenTelemetry",
    category: "integration",
    kind: "infrastructure",
    packages: ["@opentelemetry/api", "@opentelemetry/sdk-node"],
    environment: /^OTEL_/,
    promoteToEntity: true,
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    category: "database",
    kind: "database",
    packages: ["pg", "postgres"],
    environment: /^(?:POSTGRES_|DATABASE_URL$)/,
    promoteToEntity: true,
  },
  {
    id: "redis",
    name: "Redis",
    category: "database",
    kind: "database",
    packages: ["redis", "ioredis", "@upstash/redis"],
    environment: /REDIS/,
    promoteToEntity: true,
  },
  {
    id: "prisma",
    name: "Prisma",
    category: "orm",
    kind: "tool",
    packages: ["@prisma/client", "prisma"],
    promoteToEntity: true,
  },
  {
    id: "drizzle",
    name: "Drizzle",
    category: "orm",
    kind: "tool",
    packages: ["drizzle-orm", "drizzle-kit"],
    promoteToEntity: true,
  },
  {
    id: "supabase",
    name: "Supabase",
    category: "integration",
    kind: "database",
    packages: ["@supabase/supabase-js"],
    environment: /^SUPABASE_/,
    hosts: /(?:^|\.)supabase\.co$/i,
    promoteToEntity: true,
  },
  {
    id: "aws",
    name: "AWS",
    category: "integration",
    kind: "infrastructure",
    packages: ["aws-sdk", "@aws-sdk/client-s3", "@aws-sdk/client-dynamodb"],
    environment: /^AWS_/,
    hosts: /(?:^|\.)amazonaws\.com$/i,
    promoteToEntity: true,
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "integration",
    kind: "api",
    packages: ["stripe", "@stripe/stripe-js"],
    environment: /^STRIPE_/,
    hosts: /(?:^|\.)stripe\.com$/i,
    promoteToEntity: true,
  },
  {
    id: "firebase",
    name: "Firebase",
    category: "integration",
    kind: "database",
    packages: ["firebase", "firebase-admin"],
    environment: /^FIREBASE_/,
    hosts: /(?:^|\.)firebaseio\.com$/i,
    promoteToEntity: true,
  },
  {
    id: "langchain",
    name: "LangChain",
    category: "framework",
    kind: "agent",
    packages: ["langchain", "@langchain/core"],
    promoteToEntity: true,
  },
  {
    id: "llamaindex",
    name: "LlamaIndex",
    category: "framework",
    kind: "agent",
    packages: ["llamaindex"],
    promoteToEntity: true,
  },
];

function workspaces(context: AnalysisContext) {
  const selected = context.manifests.filter((manifest) => manifest.isWorkspace);
  return selected.length > 0
    ? selected
    : context.manifests.filter((manifest) => manifest.directory === ".");
}

export function workspaceForPath(path: string, manifests: readonly PackageManifest[]) {
  return manifests
    .filter(
      (manifest) =>
        manifest.directory === "." ||
        path === manifest.directory ||
        path.startsWith(`${manifest.directory}/`),
    )
    .sort((left, right) => right.directory.length - left.directory.length)[0];
}

function isTestModule(context: AnalysisContext, path: string) {
  return context.inventory.files.find((file) => file.path === path)?.role === "test";
}

class DependencyDetector implements ArchitectureDetector {
  readonly id: string;
  constructor(private readonly definition: DetectorDefinition) {
    this.id = definition.id;
  }

  detect(context: AnalysisContext): DetectorSignal[] {
    const signals: DetectorSignal[] = [];
    const workspaceManifests = workspaces(context);
    for (const workspace of workspaceManifests) {
      const evidence: ArchitectureEvidence[] = [];
      const dependencies = { ...workspace.devDependencies, ...workspace.dependencies };
      for (const packageName of this.definition.packages) {
        if (packageName in dependencies) {
          evidence.push({
            kind: "dependency",
            file: workspace.path,
            description: `${packageName} dependency`,
            weight: 0.28,
          });
        }
      }
      for (const module of context.modules) {
        if (isTestModule(context, module.path)) continue;
        if (workspaceForPath(module.path, workspaceManifests)?.directory !== workspace.directory)
          continue;
        for (const reference of module.imports) {
          const matched = this.definition.packages.some(
            (packageName) =>
              reference.specifier === packageName ||
              reference.specifier.startsWith(`${packageName}/`),
          );
          if (matched)
            evidence.push({
              kind: "import",
              file: module.path,
              line: reference.line,
              description: `${reference.specifier} imported`,
              weight: 0.48,
            });
        }
        for (const variable of module.environmentVariables) {
          if (this.definition.environment?.test(variable.name)) {
            evidence.push({
              kind: "environment",
              file: module.path,
              line: variable.line,
              description: `${variable.name} referenced (value not read)`,
              weight: 0.22,
            });
          }
        }
        for (const host of module.externalHosts) {
          if (this.definition.hosts?.test(host.host)) {
            evidence.push({
              kind: "external-host",
              file: module.path,
              line: host.line,
              description: `${host.host} referenced`,
              weight: 0.4,
            });
          }
        }
      }
      const confidence = confidenceFromEvidence(evidence);
      if (evidence.length === 0) continue;
      signals.push({
        detectorId: this.id,
        name: this.definition.name,
        category: this.definition.category,
        kind: this.definition.kind,
        workspaceDirectory: workspace.directory,
        evidence,
        confidence,
        promoteToEntity: this.definition.promoteToEntity === true && confidence >= 0.55,
      });
    }
    return signals;
  }
}

const nodeDetector: ArchitectureDetector = {
  id: "nodejs",
  detect(context) {
    const workspaceManifests = workspaces(context);
    return workspaceManifests.flatMap((workspace) => {
      const evidence: ArchitectureEvidence[] = [];
      for (const module of context.modules) {
        if (isTestModule(context, module.path)) continue;
        if (workspaceForPath(module.path, workspaceManifests)?.directory !== workspace.directory)
          continue;
        const nodeImport = module.imports.find((reference) =>
          reference.specifier.startsWith("node:"),
        );
        if (nodeImport)
          evidence.push({
            kind: "import",
            file: module.path,
            line: nodeImport.line,
            description: `${nodeImport.specifier} imported`,
            weight: 0.65,
          });
      }
      if (evidence.length === 0) return [];
      return [
        {
          detectorId: "nodejs",
          name: "Node.js",
          category: "runtime" as const,
          kind: "service" as const,
          workspaceDirectory: workspace.directory,
          evidence,
          confidence: confidenceFromEvidence(evidence),
          promoteToEntity: false,
        },
      ];
    });
  },
};

const knownHostMatchers = definitions.flatMap((definition) =>
  definition.hosts ? [definition.hosts] : [],
);
const externalHttpDetector: ArchitectureDetector = {
  id: "external-http",
  detect(context) {
    const workspaceManifests = workspaces(context);
    const byWorkspaceHost = new Map<string, ArchitectureEvidence[]>();
    for (const module of context.modules) {
      if (isTestModule(context, module.path)) continue;
      const workspace = workspaceForPath(module.path, workspaceManifests);
      if (!workspace) continue;
      for (const host of module.externalHosts) {
        if (
          /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host.host) ||
          knownHostMatchers.some((matcher) => matcher.test(host.host))
        )
          continue;
        const key = `${workspace.directory}\0${host.host}`;
        const list = byWorkspaceHost.get(key) ?? [];
        list.push({
          kind: "external-host",
          file: module.path,
          line: host.line,
          description: `${host.host} referenced`,
          weight: 0.65,
        });
        byWorkspaceHost.set(key, list);
      }
    }
    return [...byWorkspaceHost].map(([key, evidence]) => {
      const [workspaceDirectory = ".", host = "External HTTP"] = key.split("\0");
      return {
        detectorId: `external-http:${host}`,
        name: host,
        category: "integration" as const,
        kind: "api" as const,
        workspaceDirectory,
        evidence,
        confidence: confidenceFromEvidence(evidence),
        promoteToEntity: true,
      };
    });
  },
};

export const builtInDetectors: ArchitectureDetector[] = [
  ...definitions.map((definition) => new DependencyDetector(definition)),
  nodeDetector,
  externalHttpDetector,
];

export function runDetectors(context: AnalysisContext, detectors = builtInDetectors) {
  return detectors.flatMap((detector) => detector.detect(context));
}
