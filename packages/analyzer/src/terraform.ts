import { readFile } from "node:fs/promises";
import { parse } from "@cdktf/hcl2json";
import type { EntityKind, ResourceMetric } from "@visual-system/schema";
import {
  emptyInfrastructureAnalysis,
  infraTitle,
  infrastructureId,
  relationship,
  resource,
  safeScalar,
} from "./infrastructure-model";
import type { AnalysisDiagnostic, FileInventory, InfrastructureAnalysis } from "./types";

type JsonObject = Record<string, unknown>;

const awsTypes: Record<
  string,
  { kind: EntityKind; infrastructureKind: string; visibility: "system" | "detail" }
> = {
  aws_vpc: { kind: "network", infrastructureKind: "vpc", visibility: "system" },
  aws_subnet: { kind: "network", infrastructureKind: "subnet", visibility: "detail" },
  aws_internet_gateway: {
    kind: "gateway",
    infrastructureKind: "internet-gateway",
    visibility: "detail",
  },
  aws_nat_gateway: { kind: "gateway", infrastructureKind: "nat-gateway", visibility: "detail" },
  aws_route: { kind: "network", infrastructureKind: "route", visibility: "detail" },
  aws_route_table: { kind: "network", infrastructureKind: "route-table", visibility: "detail" },
  aws_route53_record: { kind: "gateway", infrastructureKind: "dns-record", visibility: "system" },
  aws_lb: { kind: "load_balancer", infrastructureKind: "load-balancer", visibility: "system" },
  aws_alb: { kind: "load_balancer", infrastructureKind: "load-balancer", visibility: "system" },
  aws_lb_listener: { kind: "gateway", infrastructureKind: "listener", visibility: "detail" },
  aws_lb_target_group: {
    kind: "gateway",
    infrastructureKind: "target-group",
    visibility: "detail",
  },
  aws_security_group: {
    kind: "network",
    infrastructureKind: "security-group",
    visibility: "detail",
  },
  aws_eks_cluster: {
    kind: "cluster",
    infrastructureKind: "kubernetes-cluster",
    visibility: "system",
  },
  aws_eks_node_group: { kind: "cluster", infrastructureKind: "node-group", visibility: "detail" },
  aws_instance: { kind: "workload", infrastructureKind: "virtual-machine", visibility: "system" },
  aws_ecs_cluster: {
    kind: "cluster",
    infrastructureKind: "container-cluster",
    visibility: "system",
  },
  aws_ecs_service: {
    kind: "workload",
    infrastructureKind: "container-service",
    visibility: "system",
  },
  aws_ecs_task_definition: {
    kind: "config",
    infrastructureKind: "task-definition",
    visibility: "detail",
  },
  aws_lambda_function: { kind: "function", infrastructureKind: "function", visibility: "system" },
  aws_db_instance: {
    kind: "database",
    infrastructureKind: "relational-database",
    visibility: "system",
  },
  aws_rds_cluster: {
    kind: "database",
    infrastructureKind: "relational-database",
    visibility: "system",
  },
  aws_elasticache_cluster: { kind: "database", infrastructureKind: "cache", visibility: "system" },
  aws_elasticache_replication_group: {
    kind: "database",
    infrastructureKind: "cache",
    visibility: "system",
  },
  aws_msk_cluster: { kind: "queue", infrastructureKind: "event-stream", visibility: "system" },
  aws_s3_bucket: { kind: "storage", infrastructureKind: "object-storage", visibility: "system" },
  aws_sqs_queue: { kind: "queue", infrastructureKind: "queue", visibility: "system" },
  aws_sns_topic: { kind: "queue", infrastructureKind: "topic", visibility: "system" },
  aws_dynamodb_table: {
    kind: "database",
    infrastructureKind: "key-value-database",
    visibility: "system",
  },
  aws_iam_role: { kind: "identity", infrastructureKind: "iam-role", visibility: "detail" },
  aws_iam_policy: { kind: "identity", infrastructureKind: "iam-policy", visibility: "detail" },
  aws_iam_role_policy: { kind: "identity", infrastructureKind: "iam-policy", visibility: "detail" },
  aws_iam_role_policy_attachment: {
    kind: "identity",
    infrastructureKind: "iam-binding",
    visibility: "detail",
  },
  helm_release: { kind: "config", infrastructureKind: "helm-release", visibility: "system" },
};

const safeAttributes = new Set([
  "name",
  "cluster_name",
  "function_name",
  "bucket",
  "engine",
  "engine_version",
  "instance_class",
  "instance_type",
  "allocated_storage",
  "memory_size",
  "desired_count",
  "desired_size",
  "min_size",
  "max_size",
  "runtime",
  "handler",
  "chart",
  "namespace",
  "repository",
  "service_name",
  "port",
  "protocol",
  "type",
  "region",
  "cidr_block",
]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function blocks(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter(isObject);
  return isObject(value) ? [value] : [];
}

function literalString(value: unknown) {
  return typeof value === "string" && !value.includes("${") ? value : undefined;
}

function referenceAddresses(value: unknown, references = new Set<string>()): string[] {
  if (typeof value === "string") {
    for (const match of value.matchAll(
      /(?:\$\{)?((?:data\.)?[A-Za-z_][\w-]*\.[A-Za-z_][\w-]*)(?:\.[\w*-]+)*/g,
    )) {
      const address = match[1];
      if (address && !address.startsWith("var.") && !address.startsWith("local."))
        references.add(address);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) referenceAddresses(item, references);
  } else if (isObject(value)) {
    for (const item of Object.values(value)) referenceAddresses(item, references);
  }
  return [...references].sort();
}

function terraformLine(body: string, blockType: string, type: string, name: string) {
  const escaped = [blockType, type, name].map((item) =>
    item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const pattern =
    blockType === "resource" || blockType === "data"
      ? new RegExp(`^\\s*${escaped[0]}\\s+"${escaped[1]}"\\s+"${escaped[2]}"`, "m")
      : new RegExp(`^\\s*${escaped[0]}\\s+"${escaped[2]}"`, "m");
  const index = body.search(pattern);
  return index < 0 ? undefined : body.slice(0, index).split("\n").length;
}

function displayName(type: string, name: string, body: JsonObject) {
  for (const key of ["name", "cluster_name", "function_name", "bucket", "identifier"]) {
    const value = literalString(body[key]);
    if (value) return infraTitle(value);
  }
  const friendly = infraTitle(name);
  const prefix = type === "helm_release" ? "Helm Release" : infraTitle(type);
  return friendly.toLowerCase().includes(prefix.toLowerCase())
    ? friendly
    : `${prefix} · ${friendly}`;
}

function configuredMetrics(type: string, body: JsonObject, file: string): ResourceMetric[] {
  const definitions: Array<[string, string, string?]> = [
    ["replicas", "replicas", "count"],
    ["desired_count", "desired-count", "count"],
    ["desired_size", "desired-size", "count"],
    ["min_size", "minimum-size", "count"],
    ["max_size", "maximum-size", "count"],
    ["allocated_storage", "allocated-storage", "GiB"],
    ["memory_size", "memory-size", "MiB"],
    ["instance_class", "instance-class"],
    ["instance_type", "instance-type"],
  ];
  return definitions.flatMap(([attribute, name, unit]) => {
    const value = safeScalar(body[attribute]);
    if (
      value === undefined ||
      typeof value === "boolean" ||
      (typeof value === "string" && value.includes("${"))
    )
      return [];
    return [
      {
        name,
        status: "configured" as const,
        source: `${file} · ${type}.${attribute}`,
        ...(unit ? { unit } : {}),
        value,
        confidence: 1,
      },
    ];
  });
}

function safeDetails(body: JsonObject) {
  return Object.fromEntries(
    [...safeAttributes].flatMap((key) => {
      const value = safeScalar(body[key]);
      if (value === undefined) return [];
      if (typeof value === "string" && /(?:password|secret|token|credential)/i.test(value))
        return [];
      return [[key, value]];
    }),
  );
}

function providerFor(type: string) {
  if (type.startsWith("aws_")) return "AWS";
  if (type === "helm_release") return "Helm";
  return infraTitle(type.split("_")[0] ?? "Terraform");
}

function resourceTypeFor(type: string) {
  return (
    awsTypes[type] ?? {
      kind: "infrastructure" as const,
      infrastructureKind: type.startsWith("aws_") ? "aws-resource" : "managed-resource",
      visibility: "detail" as const,
    }
  );
}

function normalizeJsonConfiguration(value: unknown) {
  return isObject(value) ? value : {};
}

export async function analyzeTerraform(inventory: FileInventory): Promise<InfrastructureAnalysis> {
  const analysis = emptyInfrastructureAnalysis();
  const terraformFiles = inventory.files.filter(
    (file) => file.language === "terraform" && file.role !== "test",
  );
  analysis.terraformFiles = terraformFiles.length;
  const addressToId = new Map<string, string>();
  const moduleIds = new Map<string, string>();

  for (const file of terraformFiles) {
    let source = "";
    try {
      source = await readFile(file.absolutePath, "utf8");
      const parsed = file.path.endsWith(".tf.json")
        ? normalizeJsonConfiguration(JSON.parse(source))
        : normalizeJsonConfiguration(await parse(file.path, source));
      const directory = file.directory;
      let moduleId = moduleIds.get(directory);
      if (!moduleId) {
        const address = `module:${directory}`;
        const moduleResource = resource({
          platform: "terraform",
          provider: "Terraform",
          infrastructureKind: "terraform-module",
          resourceType: "terraform_module",
          address,
          name:
            directory === "." ? "Terraform Root Module" : `Terraform · ${infraTitle(directory)}`,
          kind: "config",
          file: file.path,
          group: "terraform",
          visibility: "system",
          evidence: [
            {
              kind: "terraform-block",
              file: file.path,
              description: `Terraform module discovered in ${directory}`,
              weight: 0.92,
            },
          ],
          confidence: 0.96,
        });
        analysis.resources.push(moduleResource);
        moduleId = moduleResource.id;
        moduleIds.set(directory, moduleId);
      }

      for (const blockType of ["resource", "data"] as const) {
        const typeGroups = isObject(parsed[blockType]) ? parsed[blockType] : {};
        for (const [type, named] of Object.entries(typeGroups)) {
          if (!isObject(named)) continue;
          for (const [name, rawBodies] of Object.entries(named)) {
            for (const body of blocks(rawBodies)) {
              const address = `${blockType === "data" ? "data." : ""}${type}.${name}`;
              const mapping = resourceTypeFor(type);
              const line = terraformLine(source, blockType, type, name);
              const refs = referenceAddresses(body);
              const evidence = {
                kind: "terraform-block" as const,
                file: file.path,
                ...(line ? { line } : {}),
                description: `${blockType} ${address} declared in Terraform configuration`,
                weight: blockType === "resource" ? 0.96 : 0.82,
              };
              const item = resource({
                platform: type.startsWith("aws_") ? "aws" : "terraform",
                provider: providerFor(type),
                infrastructureKind: mapping.infrastructureKind,
                resourceType: type,
                address,
                name: displayName(type, name, body),
                kind: mapping.kind,
                file: file.path,
                ...(line ? { line } : {}),
                group: type.startsWith("aws_") ? "AWS" : "Terraform",
                hierarchyParentId: moduleId,
                visibility: blockType === "data" ? "detail" : mapping.visibility,
                references: refs,
                details: {
                  ...safeDetails(body),
                  configuration: blockType,
                  module: directory,
                },
                metrics: configuredMetrics(type, body, file.path),
                evidence: [evidence],
                confidence: blockType === "resource" ? 0.97 : 0.86,
              });
              analysis.resources.push(item);
              addressToId.set(address, item.id);
              analysis.relationships.push(
                relationship(moduleId, item.id, "contains", evidence, 0.98),
              );
            }
          }
        }
      }

      const modules = isObject(parsed.module) ? parsed.module : {};
      for (const [name, rawBodies] of Object.entries(modules)) {
        for (const body of blocks(rawBodies)) {
          const address = `module.${name}`;
          const moduleSource = literalString(body.source);
          const line = terraformLine(source, "module", "", name);
          const evidence = {
            kind: "terraform-block" as const,
            file: file.path,
            ...(line ? { line } : {}),
            description: `Terraform module call ${address}${moduleSource ? ` uses ${moduleSource}` : ""}`,
            weight: 0.9,
          };
          const item = resource({
            platform: "terraform",
            provider: "Terraform",
            infrastructureKind: "terraform-module-call",
            resourceType: "module",
            address,
            name: `Module · ${infraTitle(name)}`,
            kind: "config",
            file: file.path,
            ...(line ? { line } : {}),
            group: "terraform",
            hierarchyParentId: moduleId,
            visibility: "detail",
            references: referenceAddresses(body),
            details: { ...(moduleSource ? { source: moduleSource } : {}) },
            evidence: [evidence],
          });
          analysis.resources.push(item);
          addressToId.set(address, item.id);
          analysis.relationships.push(relationship(moduleId, item.id, "contains", evidence));
        }
      }
    } catch (error) {
      const diagnostic: AnalysisDiagnostic = {
        severity: "warning",
        code: "terraform.parse-failed",
        message:
          error instanceof Error
            ? error.message.replace(file.absolutePath, file.path)
            : "Terraform configuration could not be parsed.",
        file: file.path,
        stage: "detecting-architecture",
      };
      analysis.diagnostics.push(diagnostic);
    }
  }

  for (const item of analysis.resources) {
    for (const reference of item.references) {
      const targetId = addressToId.get(reference);
      if (!targetId || targetId === item.id) continue;
      analysis.relationships.push(
        relationship(
          item.id,
          targetId,
          "references",
          {
            kind: "terraform-reference",
            file: item.file,
            ...(item.line ? { line: item.line } : {}),
            description: `${item.address} references ${reference}`,
            weight: 0.9,
          },
          0.95,
        ),
      );
      if (item.infrastructureKind === "subnet" && reference.startsWith("aws_vpc."))
        item.hierarchyParentId = targetId;
      if (item.infrastructureKind === "node-group" && reference.startsWith("aws_eks_cluster."))
        item.hierarchyParentId = targetId;
    }
  }

  // Stable IDs are based on source addresses. This assertion also catches accidental parser collisions.
  const ids = new Set<string>();
  analysis.resources = analysis.resources.filter((item) => {
    if (ids.has(item.id)) {
      analysis.diagnostics.push({
        severity: "warning",
        code: "terraform.duplicate-address",
        message: `Duplicate Terraform address ${item.address} was grouped into one infrastructure entity.`,
        file: item.file,
        stage: "generating-graph",
      });
      return false;
    }
    ids.add(item.id);
    return true;
  });

  return analysis;
}

export const terraformResourceId = (address: string) =>
  infrastructureId(address.startsWith("aws_") ? "aws" : "terraform", address);
