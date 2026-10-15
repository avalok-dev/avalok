import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Entity } from "@visual-system/schema";
import { analyzeRepository } from "../src/index";

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const architecture = (entity: Entity) =>
  entity.metadata?.architecture as
    | {
        infrastructureKind?: string;
        resourceType?: string;
        address?: string;
        visibility?: string;
        hierarchyParentId?: string;
        metrics?: Array<{ name: string; status: string; value: string | number }>;
        details?: Record<string, unknown>;
        layers?: string[];
      }
    | undefined;

describe("infrastructure intelligence", () => {
  it("parses Terraform AWS resources, references, hierarchy, and literal capacity", async () => {
    const analysis = await analyzeRepository(fixture("terraform-aws"), { force: true });
    const kinds = analysis.graph.entities.map((entity) => architecture(entity)?.infrastructureKind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "cloud-provider",
        "vpc",
        "subnet",
        "load-balancer",
        "kubernetes-cluster",
        "relational-database",
        "object-storage",
      ]),
    );
    const subnet = analysis.graph.entities.find(
      (entity) => architecture(entity)?.infrastructureKind === "subnet",
    )!;
    const vpc = analysis.graph.entities.find(
      (entity) => architecture(entity)?.infrastructureKind === "vpc",
    )!;
    expect(architecture(subnet)?.hierarchyParentId).toBe(vpc.id);
    expect(analysis.graph.edges).toContainEqual(
      expect.objectContaining({ source: subnet.id, target: vpc.id, label: "references" }),
    );
    const database = analysis.graph.entities.find(
      (entity) => architecture(entity)?.infrastructureKind === "relational-database",
    )!;
    expect(database.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "allocated-storage", status: "configured", value: 20 }),
      ]),
    );
    expect(analysis.metrics.terraformFiles).toBe(1);
  });

  it("parses Terraform JSON without treating it as ordinary JSON only", async () => {
    const analysis = await analyzeRepository(fixture("terraform-serverless"), { force: true });
    expect(analysis.graph.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "function" }),
        expect.objectContaining({ kind: "queue" }),
        expect.objectContaining({ kind: "database" }),
      ]),
    );
    expect(
      analysis.graph.entities.find((entity) => entity.kind === "function")?.metrics,
    ).toContainEqual(expect.objectContaining({ name: "memory-size", value: 512 }));
  });

  it("models Kubernetes workloads, containers, services, ingress, identity, config, and scaling", async () => {
    const analysis = await analyzeRepository(fixture("kubernetes-app"), { force: true });
    const deployment = analysis.graph.entities.find(
      (entity) => architecture(entity)?.resourceType === "Deployment",
    )!;
    const service = analysis.graph.entities.find(
      (entity) => architecture(entity)?.resourceType === "Service",
    )!;
    const ingress = analysis.graph.entities.find(
      (entity) => architecture(entity)?.resourceType === "Ingress",
    )!;
    expect(deployment.kind).toBe("workload");
    expect(analysis.graph.entities.some((entity) => entity.kind === "container")).toBe(true);
    expect(analysis.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: service.id, target: deployment.id, label: "selects" }),
        expect.objectContaining({ source: ingress.id, target: service.id, label: "routes to" }),
        expect.objectContaining({ source: deployment.id, label: "uses secret" }),
        expect.objectContaining({ source: deployment.id, label: "uses config" }),
        expect.objectContaining({ target: deployment.id, label: "scales" }),
      ]),
    );
    expect(deployment.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "replicas", status: "configured", value: 3 }),
        expect.objectContaining({ name: "cpu-request", value: "250m" }),
      ]),
    );
    expect(analysis.metrics.kubernetesDocuments).toBe(8);
  });

  it("never exposes Kubernetes Secret values", async () => {
    const analysis = await analyzeRepository(fixture("infrastructure-secrets"), { force: true });
    const serialized = JSON.stringify(analysis);
    expect(serialized).not.toContain("never-show-this-token");
    expect(serialized).not.toContain("c3VwZXItc2VjcmV0");
    const secret = analysis.graph.entities.find(
      (entity) => architecture(entity)?.infrastructureKind === "secret",
    )!;
    expect(architecture(secret)?.details).toMatchObject({
      valueCount: 2,
      keys: ["password", "token"],
    });
  });

  it("renders statically resolvable Helm values without running Helm", async () => {
    const analysis = await analyzeRepository(fixture("helm-app"), { force: true });
    expect(analysis.metrics.helmCharts).toBe(1);
    const chart = analysis.graph.entities.find(
      (entity) => architecture(entity)?.infrastructureKind === "helm-chart",
    )!;
    const deployment = analysis.graph.entities.find(
      (entity) => architecture(entity)?.resourceType === "Deployment",
    )!;
    const service = analysis.graph.entities.find(
      (entity) => architecture(entity)?.resourceType === "Service",
    )!;
    const ingress = analysis.graph.entities.find(
      (entity) => architecture(entity)?.resourceType === "Ingress",
    )!;
    expect(chart.name).toContain("research-api");
    expect(deployment.metrics).toContainEqual(
      expect.objectContaining({ name: "replicas", value: 2, status: "configured" }),
    );
    expect(deployment.metrics).toContainEqual(
      expect.objectContaining({ name: "cpu-request", value: "200m", status: "configured" }),
    );
    expect(architecture(deployment)?.hierarchyParentId).toBe(chart.id);
    expect(analysis.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: service.id, target: deployment.id, label: "selects" }),
        expect.objectContaining({ source: ingress.id, target: service.id, label: "routes to" }),
      ]),
    );
  });

  it("reconciles an explicit EKS cluster annotation to a Kubernetes namespace", async () => {
    const analysis = await analyzeRepository(fixture("eks-unified"), { force: true });
    const cluster = analysis.graph.entities.find(
      (entity) => architecture(entity)?.infrastructureKind === "kubernetes-cluster",
    )!;
    const namespace = analysis.graph.entities.find((entity) => entity.kind === "namespace")!;
    expect(architecture(namespace)?.hierarchyParentId).toBe(cluster.id);
    expect(analysis.graph.edges).toContainEqual(
      expect.objectContaining({ source: cluster.id, target: namespace.id, label: "contains" }),
    );
  });

  it("reconciles one application service to one deployment without duplicate app nodes", async () => {
    const analysis = await analyzeRepository(fixture("infrastructure-duplicates"), { force: true });
    const app = analysis.graph.entities.find((entity) =>
      architecture(entity)?.layers?.includes("application"),
    )!;
    const deployment = analysis.graph.entities.find((entity) => entity.kind === "workload")!;
    expect(app).toBeDefined();
    expect(deployment).toBeDefined();
    expect(analysis.graph.edges).toContainEqual(
      expect.objectContaining({ source: app.id, target: deployment.id, label: "deployed as" }),
    );
    expect(
      analysis.graph.entities.filter((entity) =>
        architecture(entity)?.layers?.includes("application"),
      ),
    ).toHaveLength(1);
  });

  it("isolates malformed Terraform with a source-aware diagnostic", async () => {
    const analysis = await analyzeRepository(fixture("malformed-terraform"), { force: true });
    expect(analysis.diagnostics).toContainEqual(
      expect.objectContaining({ code: "terraform.parse-failed", file: "main.tf" }),
    );
  });

  it("isolates malformed Kubernetes YAML", async () => {
    const analysis = await analyzeRepository(fixture("malformed-kubernetes"), { force: true });
    expect(analysis.diagnostics.map((item) => item.code)).toContain("kubernetes.document-invalid");
  });

  it("isolates malformed Helm values and unresolved templates", async () => {
    const analysis = await analyzeRepository(fixture("malformed-helm"), { force: true });
    expect(analysis.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["helm.values-invalid", "helm.expression-unresolved"]),
    );
  });

  it("keeps detail infrastructure out of the default visibility policy", async () => {
    const analysis = await analyzeRepository(fixture("terraform-aws"), { force: true });
    const subnet = analysis.graph.entities.find(
      (entity) => architecture(entity)?.infrastructureKind === "subnet",
    )!;
    const iam = analysis.graph.entities.find(
      (entity) => architecture(entity)?.infrastructureKind === "iam-role",
    )!;
    expect(architecture(subnet)?.visibility).toBe("detail");
    expect(architecture(iam)?.visibility).toBe("detail");
  });

  it("is deterministic across repeated mixed-infrastructure analysis", async () => {
    const root = fixture("eks-unified");
    const first = await analyzeRepository(root, { force: true });
    const second = await analyzeRepository(root, { force: true });
    expect(first.graph.entities.map((entity) => entity.id)).toEqual(
      second.graph.entities.map((entity) => entity.id),
    );
    expect(first.graph.edges.map((edge) => edge.id)).toEqual(
      second.graph.edges.map((edge) => edge.id),
    );
  });

  it("builds the unified golden application, deployment, and AWS system story", async () => {
    const root = fileURLToPath(
      new URL("../../../examples/infrastructure-ai-platform", import.meta.url),
    );
    const analysis = await analyzeRepository(root, { force: true });
    const names = analysis.graph.entities.map((entity) => entity.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Frontend",
        "Backend API",
        "Worker",
        "OpenAI",
        "PostgreSQL",
        "Redis",
        "AWS Infrastructure",
      ]),
    );
    expect(
      analysis.graph.entities.map((entity) => architecture(entity)?.infrastructureKind),
    ).toEqual(
      expect.arrayContaining([
        "vpc",
        "load-balancer",
        "kubernetes-cluster",
        "object-storage",
        "helm-chart",
        "workload",
      ]),
    );
    expect(analysis.graph.edges.filter((edge) => edge.label === "deployed as")).toHaveLength(3);
    expect(analysis.metrics).toMatchObject({ terraformFiles: 1, helmCharts: 1 });
    expect(analysis.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });
});
