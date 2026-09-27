import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { parse } from "yaml";
import { analyzeKubernetesSource } from "./kubernetes";
import {
  emptyInfrastructureAnalysis,
  infrastructureId,
  mergeInfrastructureAnalyses,
  relationship,
  resource,
} from "./infrastructure-model";
import type { FileInventory, InfrastructureAnalysis } from "./types";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function lookup(values: unknown, path: string) {
  let current = values;
  for (const segment of path.split(".").filter(Boolean)) {
    if (!isObject(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function yamlScalar(value: unknown, quoted: boolean) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return quoted ? JSON.stringify(value) : value;
  return undefined;
}

function renderExpression(
  expression: string,
  values: unknown,
  context: { releaseName: string; namespace: string; chartName: string },
) {
  const clean = expression
    .trim()
    .replace(/^-|-$|\s+-$/g, "")
    .trim();
  if (clean === ".Release.Name") return context.releaseName;
  if (clean === ".Release.Namespace") return context.namespace;
  if (clean === ".Chart.Name") return context.chartName;
  if (/^include\s+"[^"]*(?:fullname|name)"\s+\.$/.test(clean)) return context.releaseName;
  const parts = clean.split("|").map((part) => part.trim());
  const valuePath = parts[0]?.match(/^\.Values\.([A-Za-z0-9_.-]+)$/)?.[1];
  let value = valuePath ? lookup(values, valuePath) : undefined;
  let quoted = false;
  for (const pipe of parts.slice(1)) {
    const defaultMatch = pipe.match(/^default\s+(?:"([^"]*)"|'([^']*)'|([^\s]+))$/);
    if (defaultMatch && (value === undefined || value === null || value === ""))
      value = defaultMatch[1] ?? defaultMatch[2] ?? defaultMatch[3];
    if (pipe === "quote") quoted = true;
    if (pipe !== "quote" && pipe !== "toString" && !defaultMatch) return undefined;
  }
  return yamlScalar(value, quoted);
}

function renderTemplate(
  source: string,
  values: unknown,
  context: { releaseName: string; namespace: string; chartName: string },
) {
  const unresolved = new Set<string>();
  const withoutControl = source
    .split("\n")
    .filter((line) => {
      const control = line.match(/^\s*\{\{-?\s*(if|else|end|range|with|define|block)\b/);
      if (control) unresolved.add(control[1] ?? "control");
      return !control;
    })
    .join("\n");
  const rendered = withoutControl.replace(
    /\{\{-?\s*([^{}]+?)\s*-?\}\}/g,
    (_, expression: string) => {
      const value = renderExpression(expression, values, context);
      if (value !== undefined) return value;
      unresolved.add(expression.trim());
      return JSON.stringify(`[unresolved:${expression.trim().slice(0, 80)}]`);
    },
  );
  return { rendered, unresolved: [...unresolved] };
}

export async function analyzeHelm(inventory: FileInventory): Promise<InfrastructureAnalysis> {
  const charts = inventory.files.filter(
    (file) => file.role !== "test" && /^Chart\.ya?ml$/i.test(basename(file.path)),
  );
  const results: InfrastructureAnalysis[] = [];
  for (const chartFile of charts) {
    const result = emptyInfrastructureAnalysis();
    result.helmCharts = 1;
    try {
      const chartDirectory = dirname(chartFile.path) === "." ? "." : dirname(chartFile.path);
      const chartDocument = parse(await readFile(chartFile.absolutePath, "utf8")) as unknown;
      if (!isObject(chartDocument) || typeof chartDocument.name !== "string")
        throw new Error("Chart.yaml must contain a chart name.");
      const chartName = chartDocument.name;
      const chartAddress = `chart:${chartDirectory}`;
      const chartId = infrastructureId("helm", chartAddress);
      const chartEvidence = {
        kind: "helm-chart" as const,
        file: chartFile.path,
        description: `Helm chart ${chartName} declared by Chart.yaml`,
        weight: 0.96,
      };
      result.resources.push(
        resource({
          platform: "helm",
          provider: "Helm",
          infrastructureKind: "helm-chart",
          resourceType: "Chart",
          address: chartAddress,
          name: `Helm Chart · ${chartName}`,
          kind: "config",
          file: chartFile.path,
          group: "helm",
          visibility: "system",
          details: {
            chartName,
            ...(typeof chartDocument.version === "string"
              ? { version: chartDocument.version }
              : {}),
            ...(typeof chartDocument.appVersion === "string"
              ? { appVersion: chartDocument.appVersion }
              : {}),
          },
          evidence: [chartEvidence],
          confidence: 0.98,
        }),
      );
      const valuesFile = inventory.files.find(
        (file) => file.path === `${chartDirectory === "." ? "" : `${chartDirectory}/`}values.yaml`,
      );
      let values: unknown = {};
      if (valuesFile) {
        try {
          values = parse(await readFile(valuesFile.absolutePath, "utf8")) as unknown;
        } catch (error) {
          result.diagnostics.push({
            severity: "warning",
            code: "helm.values-invalid",
            message: error instanceof Error ? error.message : "Helm values could not be parsed.",
            file: valuesFile.path,
            stage: "detecting-architecture",
          });
        }
      }
      const releaseName =
        typeof lookup(values, "nameOverride") === "string"
          ? (lookup(values, "nameOverride") as string)
          : chartName;
      const namespace =
        typeof lookup(values, "namespace") === "string"
          ? (lookup(values, "namespace") as string)
          : "default";
      const templatePrefix = `${chartDirectory === "." ? "" : `${chartDirectory}/`}templates/`;
      const templates = inventory.files.filter(
        (file) => file.path.startsWith(templatePrefix) && /\.(?:yaml|yml)$/.test(file.path),
      );
      for (const template of templates) {
        try {
          const source = await readFile(template.absolutePath, "utf8");
          const rendered = renderTemplate(source, values, { releaseName, namespace, chartName });
          if (rendered.unresolved.length)
            result.diagnostics.push({
              severity: "info",
              code: "helm.expression-unresolved",
              message: `${rendered.unresolved.length} Helm expression(s) were left unresolved: ${rendered.unresolved.slice(0, 3).join(", ")}.`,
              file: template.path,
              stage: "detecting-architecture",
            });
          const kubernetes = analyzeKubernetesSource(template.path, rendered.rendered, {
            chartId,
            chartName,
          });
          result.resources.push(...kubernetes.resources);
          result.relationships.push(...kubernetes.relationships);
          result.diagnostics.push(...kubernetes.diagnostics);
          result.kubernetesDocuments += kubernetes.kubernetesDocuments;
          for (const item of kubernetes.resources.filter(
            (item) => item.hierarchyParentId === chartId,
          ))
            result.relationships.push(
              relationship(chartId, item.id, "configured-by", chartEvidence, 0.96),
            );
        } catch (error) {
          result.diagnostics.push({
            severity: "warning",
            code: "helm.template-failed",
            message:
              error instanceof Error ? error.message : "Helm template could not be analyzed.",
            file: template.path,
            stage: "detecting-architecture",
          });
        }
      }
    } catch (error) {
      result.diagnostics.push({
        severity: "warning",
        code: "helm.chart-invalid",
        message: error instanceof Error ? error.message : "Helm chart could not be analyzed.",
        file: chartFile.path,
        stage: "detecting-architecture",
      });
    }
    results.push(result);
  }
  return results.length ? mergeInfrastructureAnalyses(...results) : emptyInfrastructureAnalysis();
}
