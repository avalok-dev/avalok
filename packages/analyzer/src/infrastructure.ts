import {
  ArchitectureGraphSchema,
  type ArchitectureGraph,
  type Entity,
} from "@visual-system/schema";
import { posix } from "node:path";
import { analyzeHelm } from "./helm";
import {
  infraSlug,
  infrastructureId,
  mergeInfrastructureAnalyses,
  relationship,
  resource,
} from "./infrastructure-model";
import { analyzeKubernetes } from "./kubernetes";
import { analyzeTerraform } from "./terraform";
import { confidenceLabel } from "./confidence";
import type {
  ArchitectureEdgeMetadata,
  ArchitectureEvidence,
  ArchitectureMetadata,
  FileInventory,
  InfrastructureAnalysis,
  InfrastructureResource,
} from "./types";

function normalizedName(value: string) {
  return value
    .toLowerCase()
    .replace(
      /(?:deployment|statefulset|daemonset|service|api|application|app|worker|container)/g,
      "",
    )
    .replace(/[^a-z0-9]/g, "");
}

function imageName(value: string) {
  return value.toLowerCase().split("@")[0]!.split(":")[0]!.split("/").at(-1) ?? value;
}

function architectureMetadata(entity: Entity) {
  return entity.metadata?.architecture as ArchitectureMetadata | undefined;
}

function edgeMetadata(
  relationshipKind: ArchitectureEdgeMetadata["relationship"],
  evidence: ArchitectureEvidence[],
  confidence: number,
) {
  return {
    architecture: {
      relationship: relationshipKind,
      evidence,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
    } satisfies ArchitectureEdgeMetadata,
  };
}

function engineFor(resource: InfrastructureResource) {
  const values = Object.values(resource.details).map(String).join(" ").toLowerCase();
  if (/postgres|aurora-postgresql/.test(values)) return "postgresql";
  if (/redis/.test(values) || resource.infrastructureKind === "cache") return "redis";
  if (/mysql|mariadb|aurora-mysql/.test(values)) return "mysql";
  if (/mongo/.test(values)) return "mongodb";
  return undefined;
}

export async function analyzeInfrastructure(
  inventory: FileInventory,
): Promise<InfrastructureAnalysis> {
  const [terraform, kubernetes, helm] = await Promise.all([
    analyzeTerraform(inventory),
    analyzeKubernetes(inventory),
    analyzeHelm(inventory),
  ]);
  const analysis = mergeInfrastructureAnalyses(terraform, kubernetes, helm);

  const awsResources = analysis.resources.filter((item) => item.provider === "AWS");
  if (awsResources.length) {
    const evidence: ArchitectureEvidence = {
      kind: "infrastructure-reconciliation",
      file: awsResources[0]!.file,
      description: `${awsResources.length} AWS resources grouped into one provider boundary`,
      weight: 0.82,
    };
    const cloud = resource({
      platform: "aws",
      provider: "AWS",
      infrastructureKind: "cloud-provider",
      resourceType: "AWS",
      address: "cloud:aws",
      name: "AWS Infrastructure",
      kind: "cloud",
      file: awsResources[0]!.file,
      group: "AWS",
      visibility: "system",
      details: { resourceCount: awsResources.length },
      evidence: [evidence],
      confidence: 0.9,
    });
    analysis.resources.push(cloud);
    for (const item of awsResources.filter((candidate) => candidate.visibility === "system")) {
      item.hierarchyParentId = cloud.id;
      analysis.relationships.push(relationship(cloud.id, item.id, "contains", evidence, 0.9));
    }
  }

  const helmCharts = analysis.resources.filter((item) => item.infrastructureKind === "helm-chart");
  for (const release of analysis.resources.filter(
    (item) => item.infrastructureKind === "helm-release",
  )) {
    const chartPath =
      typeof release.details.chart === "string"
        ? release.details.chart.replace(/^\.\//, "")
        : undefined;
    if (!chartPath) continue;
    const releaseDirectory = posix.dirname(release.file);
    const resolvedChartPath = posix.normalize(posix.join(releaseDirectory, chartPath));
    const chart = helmCharts.find((candidate) => {
      const directory = candidate.address.replace(/^chart:/, "");
      return (
        directory === resolvedChartPath ||
        directory === chartPath ||
        directory.endsWith(`/${chartPath}`) ||
        resolvedChartPath.endsWith(`/${directory}`)
      );
    });
    if (!chart) continue;
    analysis.relationships.push(
      relationship(
        release.id,
        chart.id,
        "configured-by",
        {
          kind: "infrastructure-reconciliation",
          file: release.file,
          description: `Terraform helm_release chart path resolves to ${chart.address}`,
          weight: 0.96,
        },
        0.98,
      ),
    );
  }

  const loadBalancers = analysis.resources.filter(
    (item) => item.infrastructureKind === "load-balancer",
  );
  for (const ingress of analysis.resources.filter(
    (item) => item.infrastructureKind === "ingress",
  )) {
    const loadBalancerName = ingress.labels["avalok.dev/load-balancer"];
    if (!loadBalancerName) continue;
    const matches = loadBalancers.filter((loadBalancer) =>
      [loadBalancer.name, loadBalancer.details.name]
        .filter((item): item is string => typeof item === "string")
        .some((item) => normalizedName(item) === normalizedName(loadBalancerName)),
    );
    if (matches.length !== 1) continue;
    analysis.relationships.push(
      relationship(
        matches[0]!.id,
        ingress.id,
        "routes-to",
        {
          kind: "infrastructure-reconciliation",
          file: ingress.file,
          description: `Ingress label avalok.dev/load-balancer exactly matches ${matches[0]!.address}`,
          weight: 0.97,
        },
        0.99,
      ),
    );
  }

  const clusters = analysis.resources.filter(
    (item) => item.infrastructureKind === "kubernetes-cluster",
  );
  const namespaces = analysis.resources.filter((item) => item.infrastructureKind === "namespace");
  for (const namespace of namespaces) {
    const clusterName = namespace.labels["avalok.dev/cluster"];
    if (!clusterName) continue;
    const matches = clusters.filter((cluster) =>
      [cluster.name, cluster.details.name, cluster.details.cluster_name]
        .filter((item): item is string => typeof item === "string")
        .some((item) => normalizedName(item) === normalizedName(clusterName)),
    );
    if (matches.length !== 1) continue;
    namespace.hierarchyParentId = matches[0]!.id;
    analysis.relationships.push(
      relationship(
        matches[0]!.id,
        namespace.id,
        "contains",
        {
          kind: "infrastructure-reconciliation",
          file: namespace.file,
          description: `Namespace annotation avalok.dev/cluster exactly matches ${matches[0]!.address}`,
          weight: 0.97,
        },
        0.99,
      ),
    );
  }

  return mergeInfrastructureAnalyses(analysis);
}

function infrastructureEntity(
  item: InfrastructureResource,
  children: InfrastructureResource[],
): Entity {
  const childSummaries = children
    .filter((child) => child.hierarchyParentId === item.id)
    .map((child) => `${child.resourceType} · ${child.name}`)
    .sort();
  const metadata: ArchitectureMetadata = {
    category: "infrastructure",
    confidence: item.confidence,
    confidenceLabel: confidenceLabel(item.confidence),
    evidence: item.evidence,
    ...(item.group ? { group: item.group } : {}),
    technologies: [item.provider ?? item.platform],
    sourceFiles: [item.file],
    fileCount: 1,
    dependencies: item.references,
    ports: item.ports,
    runtimeNames: [item.name, item.address, ...item.images.map(imageName)],
    level: "system",
    staticStatus: "detected",
    layer: "infrastructure",
    layers: ["infrastructure"],
    platform: item.platform,
    infrastructureKind: item.infrastructureKind,
    resourceType: item.resourceType,
    address: item.address,
    ...(item.namespace ? { namespace: item.namespace } : {}),
    visibility: item.visibility,
    ...(item.hierarchyParentId ? { hierarchyParentId: item.hierarchyParentId } : {}),
    childIds: children
      .filter((child) => child.hierarchyParentId === item.id)
      .map((child) => child.id),
    childSummaries,
    images: item.images,
    labels: item.labels,
    selectors: item.selectors,
    references: item.references,
    details: item.details,
    metrics: item.metrics,
  };
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    provider: item.provider ?? item.platform,
    description: `${item.resourceType} discovered from ${item.platform} configuration at ${item.address}.`,
    source: { file: item.file, ...(item.line ? { line: item.line } : {}) },
    ...(item.metrics.length ? { metrics: item.metrics } : {}),
    metadata: { architecture: metadata },
  };
}

export function mergeInfrastructureGraph(
  applicationGraph: ArchitectureGraph,
  infrastructure: InfrastructureAnalysis,
): ArchitectureGraph {
  const entities = applicationGraph.entities.map((entity) => {
    const metadata = architectureMetadata(entity);
    if (!metadata) return entity;
    return {
      ...entity,
      metadata: {
        ...entity.metadata,
        architecture: {
          ...metadata,
          layer: metadata.layer ?? "application",
          layers: metadata.layers ?? ["application"],
          visibility: metadata.visibility ?? "system",
        } satisfies ArchitectureMetadata,
      },
    };
  });
  const edges = [...applicationGraph.edges];
  const aliases = new Map<string, string>();

  for (const item of infrastructure.resources) {
    const engine = item.kind === "database" ? engineFor(item) : undefined;
    const integration = engine
      ? entities.find(
          (entity) =>
            entity.kind === "database" && normalizedName(entity.name) === normalizedName(engine),
        )
      : undefined;
    if (integration) {
      aliases.set(item.id, integration.id);
      const metadata = architectureMetadata(integration)!;
      integration.provider = item.provider;
      integration.description = `${integration.name} reconciled with ${item.address}.`;
      integration.source = { file: item.file, ...(item.line ? { line: item.line } : {}) };
      integration.metrics = [...(integration.metrics ?? []), ...item.metrics];
      integration.metadata = {
        ...integration.metadata,
        architecture: {
          ...metadata,
          confidence: Math.max(metadata.confidence, item.confidence),
          confidenceLabel: confidenceLabel(Math.max(metadata.confidence, item.confidence)),
          evidence: [...metadata.evidence, ...item.evidence],
          layer: "application",
          layers: ["application", "infrastructure"],
          platform: item.platform,
          infrastructureKind: item.infrastructureKind,
          resourceType: item.resourceType,
          address: item.address,
          visibility: item.visibility,
          details: item.details,
          metrics: [...(metadata.metrics ?? []), ...item.metrics],
        } satisfies ArchitectureMetadata,
      };
      continue;
    }
    entities.push(infrastructureEntity(item, infrastructure.resources));
  }

  const edgeKeys = new Set(edges.map((edge) => `${edge.source}\0${edge.target}\0${edge.label}`));
  const addEdge = (
    source: string,
    target: string,
    relationshipKind: ArchitectureEdgeMetadata["relationship"],
    evidence: ArchitectureEvidence[],
    confidence: number,
  ) => {
    const resolvedSource = aliases.get(source) ?? source;
    const resolvedTarget = aliases.get(target) ?? target;
    if (resolvedSource === resolvedTarget) return;
    if (
      !entities.some((entity) => entity.id === resolvedSource) ||
      !entities.some((entity) => entity.id === resolvedTarget)
    )
      return;
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
    const label = labels[relationshipKind];
    const key = `${resolvedSource}\0${resolvedTarget}\0${label}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: `architecture:edge:${infraSlug(resolvedSource)}:${infraSlug(resolvedTarget)}:${infraSlug(relationshipKind)}`,
      source: resolvedSource,
      target: resolvedTarget,
      kind: "static",
      label,
      metadata: edgeMetadata(relationshipKind, evidence, confidence),
    });
  };

  for (const item of infrastructure.relationships)
    addEdge(item.source, item.target, item.relationship, item.evidence, item.confidence);

  const applicationServices = entities.filter((entity) => {
    const metadata = architectureMetadata(entity);
    return metadata && ["application", "service", "package"].includes(metadata.category);
  });
  const workloads = infrastructure.resources.filter(
    (item) => item.infrastructureKind === "workload",
  );
  for (const workload of workloads) {
    const workloadTokens = new Set([
      normalizedName(workload.name),
      normalizedName(workload.address.split(":").at(-1) ?? ""),
      ...workload.images.map((image) => normalizedName(imageName(image))),
    ]);
    const candidates = applicationServices.filter((entity) => {
      const metadata = architectureMetadata(entity)!;
      return [
        entity.name,
        metadata.directory?.split("/").at(-1),
        ...(metadata.runtimeNames ?? []),
        ...(metadata.composeServices ?? []),
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => workloadTokens.has(normalizedName(value)));
    });
    if (candidates.length !== 1) continue;
    const candidate = candidates[0]!;
    const metadata = architectureMetadata(candidate)!;
    const portsAgree =
      !workload.ports.length ||
      !metadata.ports?.length ||
      workload.ports.some((port) => metadata.ports?.includes(port));
    const evidence: ArchitectureEvidence = {
      kind: "infrastructure-reconciliation",
      file: workload.file,
      description: `Exact application/image/service identity${portsAgree ? " with compatible ports" : ""} maps ${candidate.name} to ${workload.resourceType} ${workload.address}`,
      weight: portsAgree ? 0.96 : 0.82,
    };
    addEdge(candidate.id, workload.id, "deployed-as", [evidence], portsAgree ? 0.97 : 0.84);
  }

  return ArchitectureGraphSchema.parse({
    ...applicationGraph,
    entities,
    edges,
  });
}

export const awsCloudId = infrastructureId("aws", "cloud:aws");
