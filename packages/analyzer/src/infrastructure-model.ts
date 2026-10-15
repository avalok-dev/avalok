import type { EntityKind, ResourceMetric } from "@visual-system/schema";
import type {
  ArchitectureEvidence,
  InfrastructureAnalysis,
  InfrastructureRelationship,
  InfrastructureResource,
} from "./types";

export const infraSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";

export const infraTitle = (value: string) =>
  value
    .replace(/^aws_/, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export function emptyInfrastructureAnalysis(): InfrastructureAnalysis {
  return {
    resources: [],
    relationships: [],
    diagnostics: [],
    terraformFiles: 0,
    kubernetesDocuments: 0,
    helmCharts: 0,
  };
}

export function infrastructureId(platform: string, address: string) {
  return `infrastructure:${infraSlug(platform)}:${infraSlug(address)}`;
}

export function resource(input: {
  platform: InfrastructureResource["platform"];
  provider?: string;
  infrastructureKind: string;
  resourceType: string;
  address: string;
  name: string;
  kind?: EntityKind;
  file: string;
  line?: number;
  namespace?: string;
  group?: string;
  hierarchyParentId?: string;
  visibility?: "system" | "detail";
  labels?: Record<string, string>;
  selectors?: Record<string, string>;
  images?: string[];
  ports?: number[];
  references?: string[];
  details?: Record<string, string | number | boolean | string[]>;
  metrics?: ResourceMetric[];
  evidence: ArchitectureEvidence[];
  confidence?: number;
}): InfrastructureResource {
  return {
    id: infrastructureId(input.platform, input.address),
    name: input.name,
    kind: input.kind ?? "infrastructure",
    platform: input.platform,
    ...(input.provider ? { provider: input.provider } : {}),
    infrastructureKind: input.infrastructureKind,
    resourceType: input.resourceType,
    address: input.address,
    file: input.file,
    ...(input.line ? { line: input.line } : {}),
    ...(input.namespace ? { namespace: input.namespace } : {}),
    ...(input.group ? { group: input.group } : {}),
    ...(input.hierarchyParentId ? { hierarchyParentId: input.hierarchyParentId } : {}),
    visibility: input.visibility ?? "system",
    labels: input.labels ?? {},
    selectors: input.selectors ?? {},
    images: [...new Set(input.images ?? [])].sort(),
    ports: [...new Set(input.ports ?? [])].sort((left, right) => left - right),
    references: [...new Set(input.references ?? [])].sort(),
    details: input.details ?? {},
    metrics: input.metrics ?? [],
    evidence: input.evidence,
    confidence: input.confidence ?? 0.9,
  };
}

export function relationship(
  source: string,
  target: string,
  relationshipKind: InfrastructureRelationship["relationship"],
  evidence: ArchitectureEvidence | ArchitectureEvidence[],
  confidence = 0.9,
): InfrastructureRelationship {
  return {
    source,
    target,
    relationship: relationshipKind,
    evidence: Array.isArray(evidence) ? evidence : [evidence],
    confidence,
  };
}

export function mergeInfrastructureAnalyses(
  ...analyses: readonly InfrastructureAnalysis[]
): InfrastructureAnalysis {
  const resources = new Map<string, InfrastructureResource>();
  for (const item of analyses.flatMap((analysis) => analysis.resources)) {
    const previous = resources.get(item.id);
    resources.set(
      item.id,
      previous
        ? {
            ...previous,
            ...item,
            labels: { ...previous.labels, ...item.labels },
            selectors: { ...previous.selectors, ...item.selectors },
            images: [...new Set([...previous.images, ...item.images])].sort(),
            ports: [...new Set([...previous.ports, ...item.ports])].sort((a, b) => a - b),
            references: [...new Set([...previous.references, ...item.references])].sort(),
            details: { ...previous.details, ...item.details },
            metrics: [...previous.metrics, ...item.metrics],
            evidence: [...previous.evidence, ...item.evidence],
            confidence: Math.max(previous.confidence, item.confidence),
          }
        : item,
    );
  }
  const relationshipMap = new Map<string, InfrastructureRelationship>();
  for (const item of analyses.flatMap((analysis) => analysis.relationships)) {
    const key = `${item.source}\0${item.target}\0${item.relationship}`;
    const previous = relationshipMap.get(key);
    relationshipMap.set(
      key,
      previous
        ? {
            ...previous,
            evidence: [...previous.evidence, ...item.evidence],
            confidence: Math.max(previous.confidence, item.confidence),
          }
        : item,
    );
  }
  return {
    resources: [...resources.values()].sort((left, right) => left.id.localeCompare(right.id)),
    relationships: [...relationshipMap.values()].sort((left, right) =>
      `${left.source}:${left.target}:${left.relationship}`.localeCompare(
        `${right.source}:${right.target}:${right.relationship}`,
      ),
    ),
    diagnostics: analyses.flatMap((analysis) => analysis.diagnostics),
    terraformFiles: analyses.reduce((sum, analysis) => sum + analysis.terraformFiles, 0),
    kubernetesDocuments: analyses.reduce((sum, analysis) => sum + analysis.kubernetesDocuments, 0),
    helmCharts: analyses.reduce((sum, analysis) => sum + analysis.helmCharts, 0),
  };
}

export function safeScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") return value.length <= 300 ? value : `${value.slice(0, 297)}...`;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean"
        ? [[key, String(item)]]
        : [],
    ),
  );
}

export function redactSensitiveDetails(
  value: Record<string, unknown>,
): Record<string, string | number | boolean | string[]> {
  const safe: Record<string, string | number | boolean | string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(?:secret|password|passwd|token|credential|private.?key|access.?key)/i.test(key)) {
      safe[key] = "[redacted]";
      continue;
    }
    const scalar = safeScalar(item);
    if (scalar !== undefined) safe[key] = scalar;
  }
  return safe;
}
