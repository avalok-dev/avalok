import {
  ArchitectureGraphSchema,
  type ArchitectureGraph,
  type Entity,
  type GraphEdge,
} from "@visual-system/schema";
import { confidenceFromEvidence, confidenceLabel } from "./confidence";
import { serviceForPath } from "./services";
import type {
  AnalysisContext,
  ArchitectureEdgeMetadata,
  ArchitectureEvidence,
  ArchitectureMetadata,
  DetectorSignal,
  ServiceUnit,
} from "./types";

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
const title = (value: string) =>
  value
    .replace(/^@[^/]+\//, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

function serviceName(service: ServiceUnit, technologies: readonly string[]) {
  const base =
    service.directory === "."
      ? service.name
      : (service.directory.split("/").at(-1) ?? service.name);
  if (technologies.includes("Next.js"))
    return /frontend/i.test(base) ? "Frontend" : "Web Application";
  if (technologies.includes("FastAPI"))
    return /backend|api/i.test(base) ? "Backend API" : "FastAPI API";
  if (technologies.includes("Flask"))
    return /backend|api/i.test(base) ? "Backend API" : "Flask API";
  if (technologies.includes("Django"))
    return /backend|api/i.test(base) ? "Backend API" : "Django Application";
  if (technologies.includes("Celery") || technologies.includes("RQ") || /worker/i.test(base))
    return "Worker";
  if (/^(?:graph|graph-engine)$/i.test(base)) return "Graph Engine";
  if (/^(?:replay|replay-engine)$/i.test(base)) return "Replay Engine";
  if (/^(?:schema|schemas)$/i.test(base)) return "Schema";
  if (/^(?:ui|components|component-library)$/i.test(base)) return "UI Components";
  if (/^adapter[-_]/i.test(base)) return `${title(base.replace(/^adapter[-_]/i, ""))} Adapter`;
  if (/[-_]adapter$/i.test(base)) return `${title(base.replace(/[-_]adapter$/i, ""))} Adapter`;
  if (/^(?:analyzer|repo-analyzer|repository-analyzer)$/i.test(base)) return "Repository Analyzer";
  if (/^(?:reconcile|reconciliation)$/i.test(base)) return "Reconciliation";
  return title(base);
}

function serviceKind(service: ServiceUnit, technologies: readonly string[]): Entity["kind"] {
  const base = service.directory.split("/").at(-1) ?? service.name;
  if (
    technologies.some((item) => item === "Next.js" || item === "React") ||
    /^(?:ui|frontend|web)$/.test(base)
  )
    return "frontend";
  if (/schema/.test(base)) return "document";
  return "service";
}

function entityMetadata(
  category: ArchitectureMetadata["category"],
  evidence: ArchitectureEvidence[],
  options: Omit<ArchitectureMetadata, "category" | "confidence" | "confidenceLabel" | "evidence">,
  partial: boolean,
) {
  const confidence = confidenceFromEvidence(evidence, partial ? 0.08 : 0);
  return {
    architecture: {
      category,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      evidence,
      ...options,
      ...(partial ? { partial: true } : {}),
    } satisfies ArchitectureMetadata,
  };
}

function edgeMetadata(
  relationship: ArchitectureEdgeMetadata["relationship"],
  evidence: ArchitectureEvidence[],
  partial: boolean,
) {
  const confidence = confidenceFromEvidence(evidence, partial ? 0.08 : 0);
  return {
    architecture: {
      relationship,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      evidence,
    } satisfies ArchitectureEdgeMetadata,
  };
}

function knownImage(image: string) {
  const name = image.toLowerCase().split("@")[0]!.split(":")[0]!.split("/").at(-1) ?? image;
  if (name.startsWith("postgres"))
    return { id: "postgresql", name: "PostgreSQL", kind: "database" as const };
  if (name.startsWith("redis")) return { id: "redis", name: "Redis", kind: "database" as const };
  if (name.startsWith("mysql") || name.startsWith("mariadb"))
    return { id: "mysql", name: "MySQL", kind: "database" as const };
  if (name.startsWith("mongo"))
    return { id: "mongodb", name: "MongoDB", kind: "database" as const };
  if (name.startsWith("rabbitmq"))
    return { id: "rabbitmq", name: "RabbitMQ", kind: "queue" as const };
  return undefined;
}

export function generateArchitectureGraph(
  context: AnalysisContext,
  signals: readonly DetectorSignal[],
): ArchitectureGraph {
  const entities: Entity[] = [];
  const edges: GraphEdge[] = [];
  const partial = context.inventory.partialReasons.length > 0;
  const serviceIds = new Map(context.services.map((service) => [service.directory, service.id]));

  for (const service of context.services) {
    const serviceSignals = signals.filter(
      (signal) => signal.workspaceDirectory === service.directory,
    );
    const technologies = [...new Set(serviceSignals.map((signal) => signal.name))].sort();
    const modules = context.modules.filter(
      (module) => serviceForPath(module.path, context.services)?.directory === service.directory,
    );
    const routes = modules.flatMap((module) =>
      module.routes.map((route) => ({
        path: route.path,
        methods: route.methods,
        file: module.path,
        ...(route.line ? { line: route.line } : {}),
      })),
    );
    const evidence = [...service.evidence];
    if (modules[0])
      evidence.push({
        kind: "source",
        file: modules[0].path,
        description: `${modules.length} parsed source modules owned by this service`,
        weight: 0.7,
      });
    const name = serviceName(service, technologies);
    entities.push({
      id: service.id,
      kind: serviceKind(service, technologies),
      name,
      provider:
        technologies.find((item) => !["Python", "Node.js"].includes(item)) ??
        technologies[0] ??
        "Local",
      description: `${name} detected from service ownership, manifests, and source evidence.`,
      source: {
        file: service.manifestPath ?? service.sourceFiles[0] ?? service.dockerfiles[0] ?? ".",
      },
      metadata: entityMetadata(
        "service",
        evidence,
        {
          group:
            service.directory === "."
              ? "repository"
              : (service.directory.split("/")[0] ?? "services"),
          directory: service.directory,
          technologies,
          sourceFiles: service.sourceFiles,
          fileCount: service.sourceFiles.length,
          dependencies: [],
          languages: service.languages,
          routes,
          ports: service.ports,
          composeServices: service.composeServices,
          runtimeNames: [
            ...(service.declaredName ? [service.declaredName] : []),
            ...service.composeServices,
          ],
          level: "system",
          staticStatus: "detected",
        },
        partial,
      ),
    });
  }

  const edgeEvidence = new Map<string, ArchitectureEvidence[]>();
  const relationships = new Map<string, ArchitectureEdgeMetadata["relationship"]>();
  const addEdge = (
    source: string | undefined,
    target: string | undefined,
    relationship: ArchitectureEdgeMetadata["relationship"],
    evidence: ArchitectureEvidence,
  ) => {
    if (!source || !target || source === target) return;
    const key = `${source}\0${target}\0${relationship}`;
    edgeEvidence.set(key, [...(edgeEvidence.get(key) ?? []), evidence]);
    relationships.set(key, relationship);
  };

  const manifestByName = new Map(context.manifests.map((manifest) => [manifest.name, manifest]));
  for (const manifest of context.manifests) {
    const source = serviceIds.get(manifest.directory);
    for (const dependencyName of Object.keys({
      ...manifest.devDependencies,
      ...manifest.dependencies,
    })) {
      const targetManifest = manifestByName.get(dependencyName);
      addEdge(
        source,
        targetManifest ? serviceIds.get(targetManifest.directory) : undefined,
        "workspace-dependency",
        {
          kind: "dependency",
          file: manifest.path,
          description: `${manifest.name} depends on ${dependencyName}`,
          weight: 0.72,
        },
      );
    }
  }
  for (const module of context.modules) {
    if (context.inventory.files.find((file) => file.path === module.path)?.role === "test")
      continue;
    const source = serviceForPath(module.path, context.services);
    if (!source) continue;
    for (const reference of module.imports) {
      const target = reference.resolvedPath
        ? serviceForPath(reference.resolvedPath, context.services)
        : context.services.find((service) => service.directory === reference.workspaceDirectory);
      addEdge(source.id, target?.id, "source-import", {
        kind: "import",
        file: module.path,
        line: reference.line,
        description: `${reference.specifier} imported`,
        weight: 0.58,
      });
    }
  }

  const integrationGroups = new Map<string, DetectorSignal[]>();
  for (const signal of signals.filter((item) => item.promoteToEntity))
    integrationGroups.set(signal.detectorId, [
      ...(integrationGroups.get(signal.detectorId) ?? []),
      signal,
    ]);

  const composeEntityIds = new Map<string, string>();
  for (const composeFile of context.compose) {
    for (const composeService of composeFile.services) {
      const application = composeService.buildContext
        ? context.services.find((service) => service.directory === composeService.buildContext)
        : context.services.find((service) => service.composeServices.includes(composeService.name));
      if (application) {
        composeEntityIds.set(`${composeFile.path}\0${composeService.name}`, application.id);
        continue;
      }
      const image = composeService.image ? knownImage(composeService.image) : undefined;
      if (!image) continue;
      const detectorId = image.id;
      const evidence: ArchitectureEvidence[] = [
        {
          kind: "compose-service",
          file: composeFile.path,
          description: `Compose service ${composeService.name} uses image ${composeService.image}`,
          weight: 0.82,
        },
      ];
      integrationGroups.set(detectorId, [
        ...(integrationGroups.get(detectorId) ?? []),
        {
          detectorId,
          name: image.name,
          category: image.kind === "database" ? "database" : "integration",
          kind: image.kind,
          workspaceDirectory: ".",
          evidence,
          confidence: confidenceFromEvidence(evidence),
          promoteToEntity: true,
        },
      ]);
      composeEntityIds.set(
        `${composeFile.path}\0${composeService.name}`,
        `architecture:integration:${slug(detectorId)}`,
      );
    }
  }

  for (const [detectorId, integrationSignals] of integrationGroups) {
    const first = integrationSignals[0];
    if (!first) continue;
    const evidence = integrationSignals.flatMap((signal) => signal.evidence);
    const id = `architecture:integration:${slug(detectorId)}`;
    entities.push({
      id,
      kind: first.kind,
      name: first.name,
      provider: first.name,
      description: `${first.name} inferred from static source, dependency, or deployment evidence.`,
      source: evidence[0]
        ? { file: evidence[0].file, ...(evidence[0].line ? { line: evidence[0].line } : {}) }
        : undefined,
      metadata: entityMetadata(
        "integration",
        evidence,
        {
          group: "integrations",
          technologies: [first.name],
          sourceFiles: [...new Set(evidence.map((item) => item.file))],
          fileCount: new Set(evidence.map((item) => item.file)).size,
          dependencies: [],
          level: "system",
          staticStatus: "inferred",
        },
        partial,
      ),
    });
    for (const signal of integrationSignals) {
      const ownerId = serviceIds.get(signal.workspaceDirectory);
      addEdge(
        ownerId,
        id,
        "uses-integration",
        signal.evidence[0] ?? {
          kind: "source",
          file: ".",
          description: `${first.name} usage detected`,
          weight: 0.55,
        },
      );
    }
  }

  for (const composeFile of context.compose) {
    for (const service of composeFile.services) {
      const source = composeEntityIds.get(`${composeFile.path}\0${service.name}`);
      for (const dependency of service.dependsOn) {
        const target = composeEntityIds.get(`${composeFile.path}\0${dependency}`);
        addEdge(source, target, "deployment-dependency", {
          kind: "compose-dependency",
          file: composeFile.path,
          description: `Compose service ${service.name} depends_on ${dependency}`,
          weight: 0.78,
        });
      }
    }
  }

  for (const module of context.modules) {
    const source = serviceForPath(module.path, context.services);
    if (!source) continue;
    for (const host of module.externalHosts) {
      const [hostName, portText] = host.host.split(":");
      const port = Number.parseInt(portText ?? "", 10);
      const target = context.services.find(
        (service) =>
          service.id !== source.id &&
          (service.composeServices.includes(hostName ?? "") ||
            (Number.isInteger(port) && service.ports.includes(port))),
      );
      addEdge(source.id, target?.id, "calls-service", {
        kind: "external-host",
        file: module.path,
        line: host.line,
        description: `${host.host} uniquely matches ${target?.name ?? "a service"}`,
        weight: 0.72,
      });
    }
  }

  for (const [key, evidence] of edgeEvidence) {
    const [source = "", target = "", relationship = "source-import"] = key.split("\0");
    const typedRelationship =
      relationships.get(key) ?? (relationship as ArchitectureEdgeMetadata["relationship"]);
    const labels: Record<ArchitectureEdgeMetadata["relationship"], string> = {
      "workspace-dependency": "depends on",
      "source-import": "imports",
      "contains-route": "contains",
      "uses-integration": "uses",
      "deployment-dependency": "depends on",
      "calls-service": "calls",
      "deployed-as": "deployed as",
      contains: "contains",
      references: "references",
      "routes-to": "routes to",
      selects: "selects",
      mounts: "mounts",
      "uses-config": "uses config",
      "uses-secret": "uses secret",
      "uses-identity": "uses identity",
      scales: "scales",
      "managed-by": "managed by",
      "configured-by": "configured by",
      "runs-on": "runs on",
    };
    edges.push({
      id: `architecture:edge:${slug(source)}:${slug(target)}:${slug(typedRelationship)}`,
      source,
      target,
      kind: "static",
      label: labels[typedRelationship],
      metadata: edgeMetadata(typedRelationship, evidence, partial),
    });
  }

  const boundedEntities =
    entities.length <= 30
      ? entities
      : [
          ...entities.filter(
            (entity) =>
              (entity.metadata?.architecture as ArchitectureMetadata | undefined)?.category ===
              "service",
          ),
          ...entities
            .filter(
              (entity) =>
                (entity.metadata?.architecture as ArchitectureMetadata | undefined)?.category !==
                "service",
            )
            .sort((left, right) => {
              const leftConfidence =
                (left.metadata?.architecture as ArchitectureMetadata | undefined)?.confidence ?? 0;
              const rightConfidence =
                (right.metadata?.architecture as ArchitectureMetadata | undefined)?.confidence ?? 0;
              return rightConfidence - leftConfidence || left.id.localeCompare(right.id);
            })
            .slice(0, Math.max(0, 30 - context.services.length)),
        ];
  if (boundedEntities.length < entities.length) {
    context.diagnostics.push({
      severity: "info",
      code: "inference.node-budget",
      message: `${entities.length - boundedEntities.length} lower-confidence entities were grouped out of the default 30-node system view.`,
      stage: "generating-graph",
    });
  }
  const boundedIds = new Set(boundedEntities.map((entity) => entity.id));
  return ArchitectureGraphSchema.parse({
    id: `repository:${slug(context.repositoryName)}`,
    title: context.repositoryName,
    entities: boundedEntities,
    edges: edges.filter((edge) => boundedIds.has(edge.source) && boundedIds.has(edge.target)),
  });
}
