import {
  ArchitectureGraphSchema,
  type ArchitectureGraph,
  type Entity,
  type GraphEdge,
} from "@visual-system/schema";
import { confidenceFromEvidence, confidenceLabel } from "./confidence";
import { workspaceForPath } from "./detectors";
import type {
  AnalysisContext,
  ArchitectureEdgeMetadata,
  ArchitectureEvidence,
  ArchitectureMetadata,
  DetectorSignal,
  PackageManifest,
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

function workspaces(context: AnalysisContext) {
  const selected = context.manifests.filter((manifest) => manifest.isWorkspace);
  return selected.length > 0
    ? selected
    : context.manifests.filter((manifest) => manifest.directory === ".");
}

function workspaceId(directory: string) {
  return `architecture:workspace:${directory === "." ? "root" : slug(directory)}`;
}

function friendlyWorkspaceName(manifest: PackageManifest, technologies: readonly string[]) {
  const base =
    manifest.directory === "."
      ? manifest.name
      : (manifest.directory.split("/").at(-1) ?? manifest.name);
  if (technologies.includes("Next.js")) return "Web Application";
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

function packageKind(manifest: PackageManifest, technologies: readonly string[]): Entity["kind"] {
  const base = manifest.directory.split("/").at(-1) ?? manifest.name;
  if (
    technologies.some((item) => item === "Next.js" || item === "React") ||
    /^(?:ui|components)$/.test(base)
  )
    return "frontend";
  if (/schema/.test(base)) return "document";
  return "service";
}

function groupFor(directory: string) {
  if (directory === ".") return "repository";
  return directory.split("/")[0] ?? "repository";
}

function entityMetadata(
  category: ArchitectureMetadata["category"],
  evidence: ArchitectureEvidence[],
  options: Omit<ArchitectureMetadata, "category" | "confidence" | "confidenceLabel" | "evidence">,
  partial: boolean,
) {
  const confidence = confidenceFromEvidence(evidence, partial ? 0.08 : 0);
  const architecture: ArchitectureMetadata = {
    category,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidence,
    ...options,
    ...(partial ? { partial: true } : {}),
  };
  return { architecture };
}

function edgeMetadata(
  relationship: ArchitectureEdgeMetadata["relationship"],
  evidence: ArchitectureEvidence[],
  partial: boolean,
) {
  const confidence = confidenceFromEvidence(evidence, partial ? 0.08 : 0);
  const architecture: ArchitectureEdgeMetadata = {
    relationship,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidence,
  };
  return { architecture };
}

export function generateArchitectureGraph(
  context: AnalysisContext,
  signals: readonly DetectorSignal[],
): ArchitectureGraph {
  const workspaceManifests = workspaces(context);
  const entities: Entity[] = [];
  const edges: GraphEdge[] = [];
  const packageIds = new Map(
    workspaceManifests.map((manifest) => [manifest.directory, workspaceId(manifest.directory)]),
  );
  const partial = context.inventory.partialReasons.length > 0;

  for (const manifest of workspaceManifests) {
    const ownedModules = context.modules.filter(
      (module) =>
        workspaceForPath(module.path, workspaceManifests)?.directory === manifest.directory,
    );
    const ownedFiles = context.inventory.files.filter(
      (file) => workspaceForPath(file.path, workspaceManifests)?.directory === manifest.directory,
    );
    const packageSignals = signals.filter(
      (signal) => signal.workspaceDirectory === manifest.directory,
    );
    const technologies = [...new Set(packageSignals.map((signal) => signal.name))].sort();
    const evidence: ArchitectureEvidence[] = [
      {
        kind: "workspace",
        file: manifest.path,
        description: `${manifest.name} workspace manifest`,
        weight: 0.85,
      },
    ];
    const firstSource = ownedModules[0];
    if (firstSource)
      evidence.push({
        kind: "source",
        file: firstSource.path,
        description: `${ownedModules.length} parsed source modules owned by this workspace`,
        weight: 0.7,
      });
    const name = friendlyWorkspaceName(manifest, technologies);
    entities.push({
      id: workspaceId(manifest.directory),
      kind: packageKind(manifest, technologies),
      name,
      provider: technologies[0] ?? "Local",
      description: `${manifest.name} detected from workspace metadata and owned source files.`,
      source: { file: manifest.path },
      metadata: entityMetadata(
        "package",
        evidence,
        {
          group: groupFor(manifest.directory),
          directory: manifest.directory,
          technologies,
          sourceFiles: ownedFiles.map((file) => file.path),
          fileCount: ownedFiles.length,
          dependencies: [],
        },
        partial,
      ),
    });
  }

  const edgeEvidence = new Map<string, ArchitectureEvidence[]>();
  const edgeRelationships = new Map<string, ArchitectureEdgeMetadata["relationship"]>();
  const addEdgeEvidence = (
    sourceDirectory: string,
    targetDirectory: string,
    relationship: ArchitectureEdgeMetadata["relationship"],
    evidence: ArchitectureEvidence,
  ) => {
    if (sourceDirectory === targetDirectory) return;
    const source = packageIds.get(sourceDirectory);
    const target = packageIds.get(targetDirectory);
    if (!source || !target) return;
    const key = `${source}\0${target}`;
    edgeEvidence.set(key, [...(edgeEvidence.get(key) ?? []), evidence]);
    if (!edgeRelationships.has(key) || relationship === "workspace-dependency")
      edgeRelationships.set(key, relationship);
  };

  const manifestByName = new Map(workspaceManifests.map((manifest) => [manifest.name, manifest]));
  for (const manifest of workspaceManifests) {
    const dependencies = { ...manifest.devDependencies, ...manifest.dependencies };
    for (const dependencyName of Object.keys(dependencies)) {
      const target = manifestByName.get(dependencyName);
      if (!target) continue;
      addEdgeEvidence(manifest.directory, target.directory, "workspace-dependency", {
        kind: "dependency",
        file: manifest.path,
        description: `${manifest.name} depends on ${dependencyName}`,
        weight: 0.72,
      });
    }
  }
  for (const module of context.modules) {
    if (context.inventory.files.find((file) => file.path === module.path)?.role === "test")
      continue;
    const sourceWorkspace = workspaceForPath(module.path, workspaceManifests);
    if (!sourceWorkspace) continue;
    for (const reference of module.imports) {
      let targetDirectory = reference.workspaceDirectory;
      if (!targetDirectory && reference.resolvedPath)
        targetDirectory = workspaceForPath(reference.resolvedPath, workspaceManifests)?.directory;
      if (!targetDirectory) continue;
      addEdgeEvidence(sourceWorkspace.directory, targetDirectory, "source-import", {
        kind: "import",
        file: module.path,
        line: reference.line,
        description: `${reference.specifier} imported`,
        weight: 0.58,
      });
    }
  }

  for (const [key, evidence] of edgeEvidence) {
    const [source = "", target = ""] = key.split("\0");
    const relationship = edgeRelationships.get(key) ?? "source-import";
    edges.push({
      id: `architecture:edge:${slug(source)}:${slug(target)}`,
      source,
      target,
      kind: "static",
      label: relationship === "workspace-dependency" ? "depends on" : "imports",
      metadata: edgeMetadata(relationship, evidence, partial),
    });
  }

  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  for (const edge of edges) {
    const source = entityById.get(edge.source);
    const target = entityById.get(edge.target);
    const architecture = source?.metadata?.architecture as ArchitectureMetadata | undefined;
    if (source && target && architecture && !architecture.dependencies.includes(target.name))
      architecture.dependencies.push(target.name);
  }

  const routeModules = context.modules.filter(
    (module) =>
      module.routes.length > 0 &&
      context.inventory.files.find((file) => file.path === module.path)?.role !== "test",
  );
  const routeLimit = 20;
  for (const module of routeModules.slice(0, routeLimit)) {
    const owner = workspaceForPath(module.path, workspaceManifests);
    const ownerId = owner ? packageIds.get(owner.directory) : undefined;
    if (!ownerId) continue;
    for (const route of module.routes) {
      const evidence: ArchitectureEvidence[] = [
        {
          kind: "route",
          file: module.path,
          ...(route.line ? { line: route.line } : {}),
          description: `${route.style} route convention for ${route.path}`,
          weight: 0.78,
        },
      ];
      if (route.methods.length > 0)
        evidence.push({
          kind: "source",
          file: module.path,
          description: `${route.methods.join(", ")} method export detected`,
          weight: 0.78,
        });
      const id = `architecture:route:${slug(module.path)}:${slug(route.path)}`;
      entities.push({
        id,
        kind: "api",
        name: route.path,
        provider: route.style === "next-app" ? "Next.js" : title(route.style),
        description: `${route.methods.join(", ") || "HTTP"} route detected from static source conventions.`,
        source: { file: module.path, ...(route.line ? { line: route.line } : {}) },
        metadata: entityMetadata(
          "route",
          evidence,
          {
            parentId: ownerId,
            group: "routes",
            directory: module.path,
            technologies: [route.style === "next-app" ? "Next.js" : title(route.style)],
            sourceFiles: [module.path],
            fileCount: 1,
            dependencies: [],
          },
          partial,
        ),
      });
      edges.push({
        id: `architecture:edge:${slug(ownerId)}:${slug(id)}`,
        source: ownerId,
        target: id,
        kind: "static",
        label: "exposes",
        metadata: edgeMetadata("contains-route", evidence, partial),
      });
    }
  }
  if (routeModules.length > routeLimit) {
    context.diagnostics.push({
      severity: "info",
      code: "inference.route-limit",
      message: `Only the first ${routeLimit} route modules are shown on the default graph.`,
      stage: "detecting-architecture",
    });
  }

  const promotedGroups = new Map<string, DetectorSignal[]>();
  for (const signal of signals.filter((item) => item.promoteToEntity)) {
    promotedGroups.set(signal.detectorId, [
      ...(promotedGroups.get(signal.detectorId) ?? []),
      signal,
    ]);
  }
  for (const [detectorId, integrationSignals] of promotedGroups) {
    const evidence = integrationSignals.flatMap((signal) => signal.evidence);
    const first = integrationSignals[0];
    if (!first) continue;
    const integrationId = `architecture:integration:${slug(detectorId)}`;
    entities.push({
      id: integrationId,
      kind: first.kind,
      name: first.name,
      provider: first.name,
      description: `${first.name} inferred from static dependency and usage evidence.`,
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
        },
        partial,
      ),
    });
    for (const signal of integrationSignals) {
      const ownerId = packageIds.get(signal.workspaceDirectory);
      if (!ownerId) continue;
      edges.push({
        id: `architecture:edge:${slug(ownerId)}:${slug(integrationId)}`,
        source: ownerId,
        target: integrationId,
        kind: "static",
        label: "uses",
        metadata: edgeMetadata("uses-integration", signal.evidence, partial),
      });
    }
  }

  return ArchitectureGraphSchema.parse({
    id: `repository:${slug(context.repositoryName)}`,
    title: context.repositoryName,
    entities,
    edges,
  });
}
