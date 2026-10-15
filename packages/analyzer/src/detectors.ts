import type { EntityKind } from "@visual-system/schema";
import { confidenceFromEvidence } from "./confidence";
import { serviceForPath } from "./services";
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
  imports?: string[];
  calls?: RegExp;
  schemes?: RegExp;
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
    id: "fastapi",
    name: "FastAPI",
    category: "framework",
    kind: "service",
    packages: ["fastapi"],
    imports: ["fastapi"],
    calls: /(?:^|\.)FastAPI$/,
  },
  {
    id: "flask",
    name: "Flask",
    category: "framework",
    kind: "service",
    packages: ["flask"],
    imports: ["flask"],
    calls: /(?:^|\.)(?:Flask|Blueprint)$/,
  },
  {
    id: "django",
    name: "Django",
    category: "framework",
    kind: "service",
    packages: ["django"],
    imports: ["django"],
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "integration",
    kind: "model",
    packages: ["openai", "@openai/agents", "openai-agents"],
    imports: ["openai", "@openai/agents", "agents"],
    calls: /(?:^|\.)(?:OpenAI|AsyncOpenAI|Agent)$/,
    environment: /^OPENAI_/,
    hosts: /(?:^|\.)openai\.com$/i,
    promoteToEntity: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    category: "integration",
    kind: "model",
    packages: ["@anthropic-ai/sdk", "anthropic"],
    imports: ["@anthropic-ai/sdk", "anthropic"],
    calls: /(?:^|\.)(?:Anthropic|AsyncAnthropic)$/,
    environment: /^ANTHROPIC_/,
    hosts: /(?:^|\.)anthropic\.com$/i,
    promoteToEntity: true,
  },
  {
    id: "mcp",
    name: "MCP",
    category: "integration",
    kind: "mcp_server",
    packages: ["@modelcontextprotocol/sdk", "mcp", "fastmcp"],
    imports: ["@modelcontextprotocol/sdk", "mcp", "fastmcp"],
    promoteToEntity: true,
  },
  {
    id: "opentelemetry",
    name: "OpenTelemetry",
    category: "integration",
    kind: "infrastructure",
    packages: [
      "@opentelemetry/api",
      "@opentelemetry/sdk-node",
      "opentelemetry-api",
      "opentelemetry-sdk",
    ],
    imports: ["@opentelemetry", "opentelemetry"],
    environment: /^OTEL_/,
    promoteToEntity: true,
  },
  {
    id: "openinference",
    name: "OpenInference",
    category: "integration",
    kind: "infrastructure",
    packages: ["openinference-instrumentation"],
    imports: ["openinference"],
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    category: "database",
    kind: "database",
    packages: ["pg", "postgres", "psycopg", "psycopg2", "asyncpg"],
    imports: ["pg", "postgres", "psycopg", "psycopg2", "asyncpg"],
    schemes: /^postgres(?:ql)?$/,
    environment: /^(?:POSTGRES_|DATABASE_URL$)/,
    promoteToEntity: true,
  },
  {
    id: "sqlite",
    name: "SQLite",
    category: "database",
    kind: "database",
    packages: ["aiosqlite"],
    imports: ["sqlite3", "aiosqlite"],
    schemes: /^sqlite$/,
    promoteToEntity: true,
  },
  {
    id: "mysql",
    name: "MySQL",
    category: "database",
    kind: "database",
    packages: ["pymysql", "mysql-connector-python", "mysqlclient"],
    imports: ["pymysql", "mysql", "MySQLdb"],
    schemes: /^mysql$/,
    promoteToEntity: true,
  },
  {
    id: "mongodb",
    name: "MongoDB",
    category: "database",
    kind: "database",
    packages: ["pymongo", "motor"],
    imports: ["pymongo", "motor"],
    schemes: /^mongodb(?:\+srv)?$/,
    promoteToEntity: true,
  },
  {
    id: "redis",
    name: "Redis",
    category: "database",
    kind: "database",
    packages: ["redis", "ioredis", "@upstash/redis"],
    imports: ["redis", "ioredis", "@upstash/redis"],
    schemes: /^redis$/,
    environment: /REDIS/,
    promoteToEntity: true,
  },
  {
    id: "prisma",
    name: "Prisma",
    category: "orm",
    kind: "tool",
    packages: ["@prisma/client", "prisma"],
    imports: ["@prisma/client"],
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
    id: "sqlalchemy",
    name: "SQLAlchemy",
    category: "orm",
    kind: "tool",
    packages: ["sqlalchemy"],
    imports: ["sqlalchemy"],
    calls: /(?:^|\.)(?:create_engine|create_async_engine|sessionmaker)$/,
  },
  {
    id: "celery",
    name: "Celery",
    category: "framework",
    kind: "queue",
    packages: ["celery"],
    imports: ["celery"],
    calls: /(?:^|\.)Celery$/,
  },
  {
    id: "rq",
    name: "RQ",
    category: "framework",
    kind: "queue",
    packages: ["rq"],
    imports: ["rq"],
    calls: /(?:^|\.)(?:Queue|Worker)$/,
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
    packages: ["aws-sdk", "@aws-sdk/client-s3", "@aws-sdk/client-dynamodb", "boto3"],
    imports: ["aws-sdk", "@aws-sdk", "boto3"],
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
    packages: ["langchain", "@langchain/core", "langchain-core"],
    imports: ["langchain", "@langchain"],
    promoteToEntity: true,
  },
  {
    id: "llamaindex",
    name: "LlamaIndex",
    category: "framework",
    kind: "agent",
    packages: ["llamaindex", "llama-index"],
    imports: ["llamaindex"],
    promoteToEntity: true,
  },
];

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

const importMatches = (specifier: string, names: readonly string[]) =>
  names.some(
    (name) =>
      specifier === name || specifier.startsWith(`${name}/`) || specifier.startsWith(`${name}.`),
  );

class DependencyDetector implements ArchitectureDetector {
  readonly id: string;
  constructor(private readonly definition: DetectorDefinition) {
    this.id = definition.id;
  }

  detect(context: AnalysisContext): DetectorSignal[] {
    return context.services.flatMap((service) => {
      const evidence: ArchitectureEvidence[] = [];
      const manifests = context.manifests.filter(
        (manifest) => manifest.directory === service.directory,
      );
      const dependencies = Object.assign(
        {},
        ...manifests.map((manifest) => ({ ...manifest.devDependencies, ...manifest.dependencies })),
      ) as Record<string, string>;
      for (const packageName of this.definition.packages) {
        if (!(packageName in dependencies)) continue;
        const manifest = manifests.find(
          (item) => packageName in item.dependencies || packageName in item.devDependencies,
        );
        evidence.push({
          kind: "dependency",
          file: manifest?.path ?? service.manifestPath ?? ".",
          description: `${packageName} dependency`,
          weight: 0.28,
        });
      }
      for (const module of context.modules) {
        if (isTestModule(context, module.path)) continue;
        if (serviceForPath(module.path, context.services)?.directory !== service.directory)
          continue;
        for (const reference of module.imports) {
          if (
            !importMatches(reference.specifier, this.definition.imports ?? this.definition.packages)
          )
            continue;
          evidence.push({
            kind: "import",
            file: module.path,
            line: reference.line,
            description: `${reference.specifier} imported`,
            weight: 0.48,
          });
        }
        for (const call of module.calls) {
          if (!this.definition.calls?.test(call.callee)) continue;
          evidence.push({
            kind: "call",
            file: module.path,
            line: call.line,
            description: `${call.callee} constructed or called`,
            weight: 0.44,
          });
        }
        for (const connection of module.connectionSchemes) {
          if (!this.definition.schemes?.test(connection.scheme)) continue;
          evidence.push({
            kind: "connection-scheme",
            file: module.path,
            line: connection.line,
            description: `${connection.scheme} connection scheme referenced (value redacted)`,
            weight: 0.52,
          });
        }
        for (const variable of module.environmentVariables) {
          if (!this.definition.environment?.test(variable.name)) continue;
          evidence.push({
            kind: "environment",
            file: module.path,
            line: variable.line,
            description: `${variable.name} referenced (value not read)`,
            weight: 0.22,
          });
        }
        for (const host of module.externalHosts) {
          if (!this.definition.hosts?.test(host.host)) continue;
          evidence.push({
            kind: "external-host",
            file: module.path,
            line: host.line,
            description: `${host.host} referenced`,
            weight: 0.4,
          });
        }
      }
      const confidence = confidenceFromEvidence(evidence);
      if (evidence.length === 0) return [];
      return [
        {
          detectorId: this.id,
          name: this.definition.name,
          category: this.definition.category,
          kind: this.definition.kind,
          workspaceDirectory: service.directory,
          evidence,
          confidence,
          promoteToEntity: this.definition.promoteToEntity === true && confidence >= 0.55,
        },
      ];
    });
  }
}

const runtimeDetector: ArchitectureDetector = {
  id: "runtimes",
  detect(context) {
    return context.services.flatMap((service) => {
      const signals: DetectorSignal[] = [];
      if (service.languages.includes("python"))
        signals.push({
          detectorId: "python",
          name: "Python",
          category: "runtime",
          kind: "service",
          workspaceDirectory: service.directory,
          evidence: [
            {
              kind: "source",
              file:
                service.sourceFiles.find((path) => path.endsWith(".py")) ??
                service.manifestPath ??
                ".",
              description: "Python source owned by this service",
              weight: 0.7,
            },
          ],
          confidence: 0.7,
          promoteToEntity: false,
        });
      if (
        service.languages.some((language) => language === "typescript" || language === "javascript")
      )
        signals.push({
          detectorId: "nodejs",
          name: "Node.js",
          category: "runtime",
          kind: "service",
          workspaceDirectory: service.directory,
          evidence: [
            {
              kind: "source",
              file:
                service.sourceFiles.find((path) => /\.[cm]?[jt]sx?$/.test(path)) ??
                service.manifestPath ??
                ".",
              description: "JavaScript/TypeScript source owned by this service",
              weight: 0.7,
            },
          ],
          confidence: 0.7,
          promoteToEntity: false,
        });
      return signals;
    });
  },
};

const knownHostMatchers = definitions.flatMap((definition) =>
  definition.hosts ? [definition.hosts] : [],
);
const externalHttpDetector: ArchitectureDetector = {
  id: "external-http",
  detect(context) {
    const byServiceHost = new Map<string, ArchitectureEvidence[]>();
    const internalHosts = new Set(
      context.services
        .flatMap((service) => [
          service.declaredName,
          service.directory.split("/").at(-1),
          ...service.composeServices,
        ])
        .filter((host): host is string => Boolean(host)),
    );
    for (const module of context.modules) {
      if (isTestModule(context, module.path)) continue;
      const service = serviceForPath(module.path, context.services);
      if (!service) continue;
      for (const host of module.externalHosts) {
        const hostname = host.host.replace(/:\d+$/, "");
        if (
          /^(?:localhost|127\.0\.0\.1)$/i.test(hostname) ||
          internalHosts.has(hostname) ||
          knownHostMatchers.some((matcher) => matcher.test(hostname))
        )
          continue;
        const key = `${service.directory}\0${host.host}`;
        byServiceHost.set(key, [
          ...(byServiceHost.get(key) ?? []),
          {
            kind: "external-host",
            file: module.path,
            line: host.line,
            description: `${host.host} referenced`,
            weight: 0.65,
          },
        ]);
      }
    }
    return [...byServiceHost].map(([key, evidence]) => {
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
  runtimeDetector,
  externalHttpDetector,
];

export function runDetectors(context: AnalysisContext, detectors = builtInDetectors) {
  return detectors.flatMap((detector) => detector.detect(context));
}
