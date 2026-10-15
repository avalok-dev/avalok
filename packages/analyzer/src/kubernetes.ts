import { readFile } from "node:fs/promises";
import { parseAllDocuments } from "yaml";
import type { EntityKind, ResourceMetric } from "@visual-system/schema";
import {
  emptyInfrastructureAnalysis,
  infraTitle,
  infrastructureId,
  relationship,
  resource,
  stringRecord,
} from "./infrastructure-model";
import type { FileInventory, InfrastructureAnalysis, InfrastructureResource } from "./types";

type JsonObject = Record<string, unknown>;

const workloadKinds = new Set(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Pod"]);
const knownKinds = new Set([
  ...workloadKinds,
  "Service",
  "Ingress",
  "ConfigMap",
  "Secret",
  "PersistentVolumeClaim",
  "ServiceAccount",
  "HorizontalPodAutoscaler",
  "Namespace",
  "CustomResourceDefinition",
]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function manifestId(namespace: string, kind: string, name: string) {
  return infrastructureId("kubernetes", `${namespace}:${kind}:${name}`);
}

function namespaceId(namespace: string) {
  return manifestId(namespace, "Namespace", namespace);
}

function resourceMetric(
  name: string,
  value: unknown,
  unit: string | undefined,
  file: string,
  path: string,
): ResourceMetric[] {
  if (typeof value !== "string" && typeof value !== "number") return [];
  return [
    {
      name,
      status: "configured",
      source: `${file} · ${path}`,
      ...(unit ? { unit } : {}),
      value,
      confidence: 1,
    },
  ];
}

function workloadTemplate(kind: string, spec: JsonObject) {
  if (kind === "CronJob") return object(object(object(spec.jobTemplate).spec).template);
  if (kind === "Pod") return { metadata: {}, spec };
  return object(spec.template);
}

function referenceNames(templateSpec: JsonObject) {
  const configs = new Set<string>();
  const secrets = new Set<string>();
  const pvcs = new Set<string>();
  for (const container of [
    ...array(templateSpec.containers),
    ...array(templateSpec.initContainers),
  ].filter(isObject)) {
    for (const envFrom of array(container.envFrom).filter(isObject)) {
      const configName = string(object(envFrom.configMapRef).name);
      const secretName = string(object(envFrom.secretRef).name);
      if (configName) configs.add(configName);
      if (secretName) secrets.add(secretName);
    }
    for (const env of array(container.env).filter(isObject)) {
      const valueFrom = object(env.valueFrom);
      const configName = string(object(valueFrom.configMapKeyRef).name);
      const secretName = string(object(valueFrom.secretKeyRef).name);
      if (configName) configs.add(configName);
      if (secretName) secrets.add(secretName);
    }
  }
  for (const volume of array(templateSpec.volumes).filter(isObject)) {
    const configName = string(object(volume.configMap).name);
    const secretName = string(object(volume.secret).secretName);
    const claimName = string(object(volume.persistentVolumeClaim).claimName);
    if (configName) configs.add(configName);
    if (secretName) secrets.add(secretName);
    if (claimName) pvcs.add(claimName);
  }
  return { configs: [...configs], secrets: [...secrets], pvcs: [...pvcs] };
}

function kubernetesKind(kind: string): {
  entityKind: EntityKind;
  infrastructureKind: string;
  visibility: "system" | "detail";
} {
  if (workloadKinds.has(kind))
    return { entityKind: "workload", infrastructureKind: "workload", visibility: "system" };
  const mapping: Record<
    string,
    { entityKind: EntityKind; infrastructureKind: string; visibility: "system" | "detail" }
  > = {
    Service: { entityKind: "service", infrastructureKind: "service", visibility: "system" },
    Ingress: { entityKind: "gateway", infrastructureKind: "ingress", visibility: "system" },
    ConfigMap: { entityKind: "config", infrastructureKind: "config-map", visibility: "detail" },
    Secret: { entityKind: "config", infrastructureKind: "secret", visibility: "detail" },
    PersistentVolumeClaim: {
      entityKind: "storage",
      infrastructureKind: "persistent-volume-claim",
      visibility: "detail",
    },
    ServiceAccount: {
      entityKind: "identity",
      infrastructureKind: "service-account",
      visibility: "detail",
    },
    HorizontalPodAutoscaler: {
      entityKind: "config",
      infrastructureKind: "autoscaler",
      visibility: "detail",
    },
    Namespace: { entityKind: "namespace", infrastructureKind: "namespace", visibility: "system" },
    CustomResourceDefinition: {
      entityKind: "config",
      infrastructureKind: "custom-resource-definition",
      visibility: "detail",
    },
  };
  return (
    mapping[kind] ?? {
      entityKind: "infrastructure",
      infrastructureKind: "custom-resource",
      visibility: "detail",
    }
  );
}

function workloadDetails(
  kind: string,
  spec: JsonObject,
  file: string,
  namespace: string,
  name: string,
) {
  const template = workloadTemplate(kind, spec);
  const templateMetadata = object(template.metadata);
  const templateSpec = object(template.spec);
  const containers = array(templateSpec.containers).filter(isObject);
  const images = containers.flatMap((container) => {
    const image = string(container.image);
    return image ? [image] : [];
  });
  const ports = containers.flatMap((container) =>
    array(container.ports)
      .filter(isObject)
      .flatMap((port) => {
        const value = number(port.containerPort);
        return value === undefined ? [] : [value];
      }),
  );
  const metrics: ResourceMetric[] = [
    ...resourceMetric("replicas", number(spec.replicas), "count", file, "spec.replicas"),
  ];
  for (const container of containers) {
    const containerName = string(container.name) ?? "container";
    const resources = object(container.resources);
    const requests = object(resources.requests);
    const limits = object(resources.limits);
    metrics.push(
      ...resourceMetric("cpu-request", requests.cpu, "cpu", file, `${containerName}.requests.cpu`),
      ...resourceMetric(
        "memory-request",
        requests.memory,
        "bytes",
        file,
        `${containerName}.requests.memory`,
      ),
      ...resourceMetric("cpu-limit", limits.cpu, "cpu", file, `${containerName}.limits.cpu`),
      ...resourceMetric(
        "memory-limit",
        limits.memory,
        "bytes",
        file,
        `${containerName}.limits.memory`,
      ),
    );
  }
  return {
    templateSpec,
    labels: stringRecord(templateMetadata.labels),
    containers,
    images,
    ports,
    metrics,
    references: referenceNames(templateSpec),
    serviceAccountName: string(templateSpec.serviceAccountName),
    workloadId: manifestId(namespace, kind, name),
  };
}

export function analyzeKubernetesSource(
  file: string,
  source: string,
  options: { chartId?: string; chartName?: string } = {},
): InfrastructureAnalysis {
  const analysis = emptyInfrastructureAnalysis();
  const workloads: Array<{
    resource: InfrastructureResource;
    labels: Record<string, string>;
  }> = [];
  const services: Array<{
    resource: InfrastructureResource;
    selector: Record<string, string>;
  }> = [];

  let documents;
  try {
    documents = parseAllDocuments(source, { prettyErrors: false, strict: false });
  } catch (error) {
    analysis.diagnostics.push({
      severity: "warning",
      code: "kubernetes.parse-failed",
      message: error instanceof Error ? error.message : "Kubernetes YAML could not be parsed.",
      file,
      stage: "detecting-architecture",
    });
    return analysis;
  }

  documents.forEach((document) => {
    if (document.errors.length) {
      analysis.diagnostics.push({
        severity: "warning",
        code: "kubernetes.document-invalid",
        message: document.errors.map((error) => error.message).join("; "),
        file,
        stage: "detecting-architecture",
      });
      return;
    }
    const value = document.toJS({ maxAliasCount: 100 }) as unknown;
    if (!isObject(value)) return;
    const apiVersion = string(value.apiVersion);
    const kind = string(value.kind);
    const metadata = object(value.metadata);
    const name = string(metadata.name);
    if (!apiVersion || !kind || !name) return;
    analysis.kubernetesDocuments += 1;
    const namespace = string(metadata.namespace) ?? (kind === "Namespace" ? name : "default");
    const spec = object(value.spec);
    const mapping = kubernetesKind(kind);
    const line =
      document.range?.[0] === undefined
        ? undefined
        : source.slice(0, document.range[0]).split("\n").length;
    const evidence = {
      kind: options.chartId ? ("helm-chart" as const) : ("kubernetes-manifest" as const),
      file,
      ...(line ? { line } : {}),
      description: `${apiVersion} ${kind} ${namespace}/${name} declared${options.chartName ? ` by Helm chart ${options.chartName}` : ""}`,
      weight: options.chartId ? 0.86 : 0.96,
    };
    const address = `${namespace}:${kind}:${name}`;
    const base = {
      platform: "kubernetes" as const,
      provider: options.chartName ? "Helm / Kubernetes" : "Kubernetes",
      infrastructureKind: mapping.infrastructureKind,
      resourceType: kind,
      address,
      name: `${kind} · ${infraTitle(name)}`,
      kind: mapping.entityKind,
      file,
      ...(line ? { line } : {}),
      namespace,
      group: namespace,
      hierarchyParentId: options.chartId ?? namespaceId(namespace),
      visibility: mapping.visibility,
      labels: stringRecord(metadata.labels),
      details: {
        apiVersion,
        namespace,
        ...(options.chartName ? { chart: options.chartName } : {}),
      },
      evidence: [evidence],
      confidence: options.chartId ? 0.9 : 0.98,
    };

    if (kind === "Namespace") {
      analysis.resources.push(
        resource({
          ...base,
          name: `Namespace · ${infraTitle(name)}`,
          ...(options.chartId ? { hierarchyParentId: options.chartId } : {}),
        }),
      );
      return;
    }

    if (workloadKinds.has(kind)) {
      const workload = workloadDetails(kind, spec, file, namespace, name);
      const item = resource({
        ...base,
        labels: workload.labels,
        images: workload.images,
        ports: workload.ports,
        metrics: workload.metrics,
        details: {
          ...base.details,
          containerCount: workload.containers.length,
          ...(number(spec.replicas) !== undefined
            ? { replicas: number(spec.replicas) as number }
            : {}),
        },
      });
      analysis.resources.push(item);
      workloads.push({ resource: item, labels: workload.labels });

      workload.containers.forEach((container, index) => {
        const containerName = string(container.name) ?? `container-${index + 1}`;
        const containerEvidence = {
          ...evidence,
          description: `Container ${containerName} belongs to ${kind} ${namespace}/${name}`,
          weight: 0.94,
        };
        const containerResource = resource({
          platform: "kubernetes",
          provider: "Kubernetes",
          infrastructureKind: "container",
          resourceType: "Container",
          address: `${address}:container:${containerName}`,
          name: `Container · ${infraTitle(containerName)}`,
          kind: "container",
          file,
          ...(line ? { line } : {}),
          namespace,
          group: namespace,
          hierarchyParentId: item.id,
          visibility: "detail",
          images: string(container.image) ? [string(container.image) as string] : [],
          details: {
            ...(string(container.image) ? { image: string(container.image) as string } : {}),
          },
          evidence: [containerEvidence],
        });
        analysis.resources.push(containerResource);
        analysis.relationships.push(
          relationship(item.id, containerResource.id, "contains", containerEvidence, 0.99),
        );
      });

      for (const configName of workload.references.configs)
        analysis.relationships.push(
          relationship(
            item.id,
            manifestId(namespace, "ConfigMap", configName),
            "uses-config",
            evidence,
            0.95,
          ),
        );
      for (const secretName of workload.references.secrets)
        analysis.relationships.push(
          relationship(
            item.id,
            manifestId(namespace, "Secret", secretName),
            "uses-secret",
            evidence,
            0.95,
          ),
        );
      for (const claimName of workload.references.pvcs)
        analysis.relationships.push(
          relationship(
            item.id,
            manifestId(namespace, "PersistentVolumeClaim", claimName),
            "mounts",
            evidence,
            0.95,
          ),
        );
      if (workload.serviceAccountName)
        analysis.relationships.push(
          relationship(
            item.id,
            manifestId(namespace, "ServiceAccount", workload.serviceAccountName),
            "uses-identity",
            evidence,
            0.95,
          ),
        );
      return;
    }

    if (kind === "Service") {
      const selector = stringRecord(spec.selector);
      const ports = array(spec.ports)
        .filter(isObject)
        .flatMap((port) => {
          const target = number(port.targetPort) ?? number(port.port);
          return target === undefined ? [] : [target];
        });
      const item = resource({
        ...base,
        selectors: selector,
        ports,
        details: { ...base.details, serviceType: string(spec.type) ?? "ClusterIP" },
      });
      analysis.resources.push(item);
      services.push({ resource: item, selector });
      return;
    }

    if (kind === "Ingress") {
      const backends = new Set<string>();
      const defaultService = string(object(object(spec.defaultBackend).service).name);
      if (defaultService) backends.add(defaultService);
      for (const rule of array(spec.rules).filter(isObject))
        for (const path of array(object(rule.http).paths).filter(isObject)) {
          const serviceName = string(object(object(path.backend).service).name);
          if (serviceName) backends.add(serviceName);
        }
      const item = resource({
        ...base,
        details: { ...base.details, backendServices: [...backends] },
      });
      analysis.resources.push(item);
      for (const backend of backends)
        analysis.relationships.push(
          relationship(
            item.id,
            manifestId(namespace, "Service", backend),
            "routes-to",
            evidence,
            0.98,
          ),
        );
      return;
    }

    if (kind === "HorizontalPodAutoscaler") {
      const target = object(spec.scaleTargetRef);
      const targetKind = string(target.kind);
      const targetName = string(target.name);
      const metrics = [
        ...resourceMetric("minimum-replicas", spec.minReplicas, "count", file, "spec.minReplicas"),
        ...resourceMetric("maximum-replicas", spec.maxReplicas, "count", file, "spec.maxReplicas"),
      ];
      const item = resource({ ...base, metrics });
      analysis.resources.push(item);
      if (targetKind && targetName)
        analysis.relationships.push(
          relationship(
            item.id,
            manifestId(namespace, targetKind, targetName),
            "scales",
            evidence,
            0.98,
          ),
        );
      return;
    }

    const detailKeys =
      kind === "Secret"
        ? [
            ...new Set([
              ...Object.keys(object(value.data)),
              ...Object.keys(object(value.stringData)),
            ]),
          ].sort()
        : kind === "ConfigMap"
          ? Object.keys(object(value.data)).sort()
          : [];
    analysis.resources.push(
      resource({
        ...base,
        details: {
          ...base.details,
          ...(detailKeys.length ? { keys: detailKeys, valueCount: detailKeys.length } : {}),
          ...(!knownKinds.has(kind) ? { customResource: true } : {}),
        },
      }),
    );
  });

  const namespaces = new Set(
    analysis.resources
      .filter((item) => item.resourceType !== "Namespace")
      .map((item) => item.namespace ?? "default"),
  );
  for (const namespace of namespaces) {
    if (analysis.resources.some((item) => item.id === namespaceId(namespace))) continue;
    const evidence = {
      kind: options.chartId ? ("helm-chart" as const) : ("kubernetes-manifest" as const),
      file,
      description: `Namespace ${namespace} inferred from manifest metadata`,
      weight: 0.72,
    };
    analysis.resources.push(
      resource({
        platform: "kubernetes",
        provider: "Kubernetes",
        infrastructureKind: "namespace",
        resourceType: "Namespace",
        address: `${namespace}:Namespace:${namespace}`,
        name: `Namespace · ${infraTitle(namespace)}`,
        kind: "namespace",
        file,
        namespace,
        group: namespace,
        ...(options.chartId ? { hierarchyParentId: options.chartId } : {}),
        visibility: "system",
        evidence: [evidence],
        confidence: 0.78,
      }),
    );
  }

  for (const service of services) {
    if (!Object.keys(service.selector).length) continue;
    for (const workload of workloads) {
      if (service.resource.namespace !== workload.resource.namespace) continue;
      const matches = Object.entries(service.selector).every(
        ([key, value]) => workload.labels[key] === value,
      );
      if (!matches) continue;
      analysis.relationships.push(
        relationship(
          service.resource.id,
          workload.resource.id,
          "selects",
          {
            kind: "kubernetes-selector",
            file,
            description: `Service selector exactly matches ${workload.resource.resourceType} pod-template labels`,
            weight: 0.98,
          },
          0.99,
        ),
      );
    }
  }

  const ids = new Set(analysis.resources.map((item) => item.id));
  analysis.relationships = analysis.relationships.filter((item) => {
    if (ids.has(item.source) && ids.has(item.target)) return true;
    analysis.diagnostics.push({
      severity: "info",
      code: "kubernetes.reference-unresolved",
      message: `Reference from ${item.source} to ${item.target} could not be resolved in analyzed manifests.`,
      file,
      stage: "generating-graph",
    });
    return false;
  });
  return analysis;
}

function isKubernetesCandidate(path: string) {
  const lower = path.toLowerCase();
  return (
    /\.(?:yaml|yml)$/.test(lower) &&
    !/(?:^|\/)(?:docker-)?compose(?:\.[^/]+)?\.(?:yaml|yml)$/.test(lower) &&
    !/(?:^|\/)charts?\//.test(lower) &&
    !/(?:^|\/)templates\//.test(lower) &&
    !/(?:^|\/)(?:chart|values)(?:\.[^/]+)?\.(?:yaml|yml)$/.test(lower)
  );
}

export async function analyzeKubernetes(inventory: FileInventory): Promise<InfrastructureAnalysis> {
  const aggregate = emptyInfrastructureAnalysis();
  for (const file of inventory.files.filter(
    (item) => item.role !== "test" && isKubernetesCandidate(item.path),
  )) {
    try {
      const source = await readFile(file.absolutePath, "utf8");
      const result = analyzeKubernetesSource(file.path, source);
      aggregate.resources.push(...result.resources);
      aggregate.relationships.push(...result.relationships);
      aggregate.diagnostics.push(...result.diagnostics);
      aggregate.kubernetesDocuments += result.kubernetesDocuments;
    } catch (error) {
      aggregate.diagnostics.push({
        severity: "warning",
        code: "kubernetes.read-failed",
        message: error instanceof Error ? error.message : "Kubernetes manifest could not be read.",
        file: file.path,
        stage: "detecting-architecture",
      });
    }
  }
  return aggregate;
}
