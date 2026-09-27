import { readFile } from "node:fs/promises";
import { basename, posix } from "node:path";
import { parseDocument } from "yaml";
import type {
  AnalysisDiagnostic,
  ComposeAnalysis,
  ComposeServiceAnalysis,
  DockerfileAnalysis,
  FileInventory,
} from "./types";

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function logicalDockerLines(body: string) {
  const lines: Array<{ body: string; line: number }> = [];
  let pending = "";
  let start = 1;
  for (const [index, rawLine] of body.split(/\r?\n/).entries()) {
    const trimmed = rawLine.trim();
    if (!pending && (!trimmed || trimmed.startsWith("#"))) continue;
    if (!pending) start = index + 1;
    pending += `${pending ? " " : ""}${trimmed.replace(/\\\s*$/, "")}`;
    if (/\\\s*$/.test(trimmed)) continue;
    lines.push({ body: pending, line: start });
    pending = "";
  }
  if (pending) lines.push({ body: pending, line: start });
  return lines;
}

function commandArguments(value: string) {
  const sanitize = (token: string) => {
    const assignment = token.match(
      /^([^=]*(?:password|passwd|token|secret|api[_-]?key|authorization)[^=]*)=(.*)$/i,
    );
    if (assignment?.[1]) return `${assignment[1]}=[REDACTED]`;
    return token.replace(/^(\w+:\/\/)[^/@\s]+@/, "$1[REDACTED]@");
  };
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed))
        return parsed.filter((item): item is string => typeof item === "string").map(sanitize);
    } catch {
      return ["<malformed JSON command>"];
    }
  }
  return trimmed.split(/\s+/).filter(Boolean).map(sanitize);
}

export async function analyzeDockerfiles(
  inventory: FileInventory,
  diagnostics: AnalysisDiagnostic[],
) {
  const results: DockerfileAnalysis[] = [];
  for (const file of inventory.files.filter((item) => item.language === "dockerfile")) {
    try {
      const stages: DockerfileAnalysis["stages"] = [];
      const copiedPaths: string[] = [];
      const exposedPorts: number[] = [];
      const environmentVariables = new Set<string>();
      let workdir: string | undefined;
      let entrypoint: string[] | undefined;
      let command: string[] | undefined;
      for (const logical of logicalDockerLines(await readFile(file.absolutePath, "utf8"))) {
        const instruction = logical.body.match(/^([A-Za-z]+)\s+(.*)$/);
        if (!instruction?.[1]) continue;
        const operation = instruction[1].toUpperCase();
        const value = instruction[2] ?? "";
        if (operation === "FROM") {
          const match = value.match(/^(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i);
          if (match?.[1])
            stages.push({
              image: match[1],
              ...(match[2] ? { alias: match[2] } : {}),
              line: logical.line,
            });
        } else if (operation === "WORKDIR") workdir = value.trim();
        else if (operation === "COPY" || operation === "ADD") {
          const values = commandArguments(value.replace(/^--\S+\s+/, ""));
          copiedPaths.push(...values.slice(0, -1));
        } else if (operation === "EXPOSE") {
          for (const token of value.split(/\s+/)) {
            const port = Number.parseInt(token, 10);
            if (Number.isInteger(port) && port > 0 && port <= 65_535) exposedPorts.push(port);
          }
        } else if (operation === "ENTRYPOINT") entrypoint = commandArguments(value);
        else if (operation === "CMD") command = commandArguments(value);
        else if (operation === "ARG") {
          const name = value.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
          if (name) environmentVariables.add(name);
        } else if (operation === "ENV") {
          for (const match of value.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g))
            environmentVariables.add(match[1]!);
        }
      }
      results.push({
        path: file.path,
        directory: posix.dirname(file.path) === "." ? "." : posix.dirname(file.path),
        stages,
        ...(workdir ? { workdir } : {}),
        copiedPaths: [...new Set(copiedPaths)],
        exposedPorts: [...new Set(exposedPorts)],
        ...(entrypoint ? { entrypoint } : {}),
        ...(command ? { command } : {}),
        environmentVariables: [...environmentVariables].sort(),
      });
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "dockerfile.unreadable",
        message: error instanceof Error ? error.message : "Dockerfile could not be parsed.",
        file: file.path,
        stage: "parsing-manifests",
      });
    }
  }
  return results;
}

function environmentNames(value: unknown) {
  if (Array.isArray(value))
    return value.flatMap((item) => {
      if (typeof item !== "string") return [];
      const name = item.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
      return name ? [name] : [];
    });
  return Object.keys(objectRecord(value) ?? {}).filter((name) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
  );
}

function composePorts(value: unknown): ComposeServiceAnalysis["ports"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "number") return [{ target: item }];
    if (typeof item === "string") {
      const clean = item.split("/")[0] ?? "";
      const parts = clean.split(":").map((part) => Number.parseInt(part, 10));
      const target = parts.at(-1);
      const published = parts.length > 1 ? parts.at(-2) : undefined;
      return target && target > 0
        ? [{ ...(published && published > 0 ? { published } : {}), target }]
        : [];
    }
    const record = objectRecord(item);
    const target = typeof record?.target === "number" ? record.target : undefined;
    const published = typeof record?.published === "number" ? record.published : undefined;
    return target ? [{ ...(published ? { published } : {}), target }] : [];
  });
}

function normalizedContext(composePath: string, context: string) {
  return (
    posix.normalize(posix.join(posix.dirname(composePath), context)).replace(/^\.\//, "") || "."
  );
}

export async function analyzeCompose(
  inventory: FileInventory,
  diagnostics: AnalysisDiagnostic[],
): Promise<ComposeAnalysis[]> {
  const composeNames = new Set([
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ]);
  const results: ComposeAnalysis[] = [];
  for (const file of inventory.files.filter((item) => composeNames.has(basename(item.path)))) {
    try {
      const document = parseDocument(await readFile(file.absolutePath, "utf8"), {
        prettyErrors: false,
      });
      if (document.errors.length > 0) throw new Error(document.errors[0]!.message);
      const root = objectRecord(document.toJS({ maxAliasCount: 20 }));
      const serviceRecords = objectRecord(root?.services);
      if (!serviceRecords) throw new Error("Compose document must contain a services mapping.");
      const services: ComposeServiceAnalysis[] = [];
      for (const [name, value] of Object.entries(serviceRecords)) {
        const service = objectRecord(value);
        if (!service) continue;
        const build = objectRecord(service.build);
        const rawContext =
          typeof service.build === "string"
            ? service.build
            : typeof build?.context === "string"
              ? build.context
              : undefined;
        const dependsOn = Array.isArray(service.depends_on)
          ? strings(service.depends_on)
          : Object.keys(objectRecord(service.depends_on) ?? {});
        services.push({
          name,
          file: file.path,
          ...(rawContext ? { buildContext: normalizedContext(file.path, rawContext) } : {}),
          ...(typeof build?.dockerfile === "string" ? { dockerfile: build.dockerfile } : {}),
          ...(typeof service.image === "string" ? { image: service.image } : {}),
          ports: composePorts(service.ports),
          dependsOn,
          networks: Array.isArray(service.networks)
            ? strings(service.networks)
            : Object.keys(objectRecord(service.networks) ?? {}),
          volumes: strings(service.volumes).map((volume) => volume.split(":").at(-1) ?? volume),
          environmentVariables: environmentNames(service.environment).sort(),
          hasHealthcheck: objectRecord(service.healthcheck) !== undefined,
        });
      }
      results.push({ path: file.path, services });
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "compose.invalid",
        message:
          error instanceof Error ? error.message : "Compose configuration could not be parsed.",
        file: file.path,
        stage: "parsing-manifests",
      });
    }
  }
  return results;
}
