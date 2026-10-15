import { readFile } from "node:fs/promises";
import { basename, posix } from "node:path";
import ts from "typescript";
import { parsePythonSource } from "./python-parser";
import type {
  AnalysisDiagnostic,
  FileInventory,
  ImportReference,
  PackageManifest,
  RouteSignal,
  SourceAnalyzerAdapter,
  SourceModule,
} from "./types";

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

interface AliasConfig {
  directory: string;
  baseUrl: string;
  paths: Record<string, string[]>;
}

const lineOf = (source: ts.SourceFile, node: ts.Node) =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

function scriptKind(extension: string) {
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".js", ".mjs", ".cjs"].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function hasExportModifier(node: ts.Node) {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function declaredName(node: ts.Node) {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  )
    return node.name.text;
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .flatMap((declaration) => (ts.isIdentifier(declaration.name) ? [declaration.name.text] : []))
      .join(", ");
  }
  return undefined;
}

function literalText(node: ts.Node | undefined) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function nextRoutePath(path: string) {
  const marker = "/app/api/";
  const index = path.indexOf(marker);
  if (index < 0 || !/\/route\.[cm]?[jt]sx?$/.test(path)) return undefined;
  const segment = path.slice(index + marker.length).replace(/\/route\.[cm]?[jt]sx?$/, "");
  return `/api/${segment}`.replace(/\/+/g, "/");
}

function fileCandidates(path: string) {
  const extension = posix.extname(path);
  if (extension) return [path];
  return [
    ...sourceExtensions.map((item) => `${path}${item}`),
    `${path}.json`,
    ...sourceExtensions.map((item) => posix.join(path, `index${item}`)),
    posix.join(path, "index.json"),
  ];
}

function normalizeRelative(path: string) {
  const value = posix.normalize(path);
  return value.startsWith("./") ? value.slice(2) : value;
}

function aliasMatch(pattern: string, specifier: string) {
  if (!pattern.includes("*")) return pattern === specifier ? "" : undefined;
  const [prefix = "", suffix = ""] = pattern.split("*");
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return undefined;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

async function readAliasConfigs(inventory: FileInventory, diagnostics: AnalysisDiagnostic[]) {
  const configs: AliasConfig[] = [];
  for (const file of inventory.files.filter((item) =>
    ["tsconfig.json", "jsconfig.json"].includes(basename(item.path)),
  )) {
    try {
      const body = await readFile(file.absolutePath, "utf8");
      const parsed = ts.parseConfigFileTextToJson(file.path, body);
      if (parsed.error)
        throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, " "));
      const config = parsed.config as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } };
      const pathsValue = config.compilerOptions?.paths;
      const paths =
        typeof pathsValue === "object" && pathsValue !== null
          ? Object.fromEntries(
              Object.entries(pathsValue).flatMap(([key, value]) =>
                Array.isArray(value) && value.every((item) => typeof item === "string")
                  ? [[key, value as string[]]]
                  : [],
              ),
            )
          : {};
      configs.push({
        directory: posix.dirname(file.path) === "." ? "." : posix.dirname(file.path),
        baseUrl:
          typeof config.compilerOptions?.baseUrl === "string"
            ? config.compilerOptions.baseUrl
            : ".",
        paths,
      });
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "source.tsconfig-invalid",
        message:
          error instanceof Error ? error.message : "TypeScript configuration could not be parsed.",
        file: file.path,
        stage: "building-imports",
      });
    }
  }
  return configs.sort((left, right) => right.directory.length - left.directory.length);
}

function resolveImport(
  modulePath: string,
  specifier: string,
  files: ReadonlySet<string>,
  manifestsByName: ReadonlyMap<string, PackageManifest>,
  aliasConfigs: readonly AliasConfig[],
) {
  if (specifier.startsWith(".")) {
    const base = normalizeRelative(posix.join(posix.dirname(modulePath), specifier));
    const resolvedPath = fileCandidates(base).find((candidate) => files.has(candidate));
    return { ...(resolvedPath ? { resolvedPath } : {}), expectedLocal: true };
  }

  const workspace = [...manifestsByName.entries()]
    .filter(([name]) => specifier === name || specifier.startsWith(`${name}/`))
    .sort(([left], [right]) => right.length - left.length)[0]?.[1];
  if (workspace) return { workspaceDirectory: workspace.directory, expectedLocal: true };

  const config = aliasConfigs.find(
    (item) => item.directory === "." || modulePath.startsWith(`${item.directory}/`),
  );
  if (config) {
    for (const [pattern, targets] of Object.entries(config.paths)) {
      const wildcard = aliasMatch(pattern, specifier);
      if (wildcard === undefined) continue;
      for (const target of targets) {
        const substituted = target.replace("*", wildcard);
        const base = normalizeRelative(posix.join(config.directory, config.baseUrl, substituted));
        const resolvedPath = fileCandidates(base).find((candidate) => files.has(candidate));
        if (resolvedPath) return { resolvedPath, expectedLocal: true };
      }
      return { expectedLocal: true };
    }
  }
  return {};
}

function envName(node: ts.Node) {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "process" &&
    node.expression.name.text === "env"
  )
    return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "process" &&
    node.expression.name.text === "env"
  )
    return literalText(node.argumentExpression);
  return undefined;
}

function callRoute(node: ts.CallExpression, source: ts.SourceFile): RouteSignal | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  const method = node.expression.name.text.toUpperCase();
  if (!httpMethods.has(method)) return undefined;
  const path = literalText(node.arguments[0]);
  if (!path?.startsWith("/")) return undefined;
  const receiver = node.expression.expression.getText(source).toLowerCase();
  const style = receiver.includes("fastify") ? "fastify" : "express";
  return { path, methods: [method], style, line: lineOf(source, node) };
}

function parseEnvironmentTemplate(path: string, body: string): SourceModule {
  const environmentVariables = body.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    return match?.[1] ? [{ name: match[1], line: index + 1 }] : [];
  });
  return {
    path,
    language: "environment",
    imports: [],
    exports: [],
    declarations: [],
    environmentVariables,
    externalHosts: [],
    routes: [],
    calls: [],
    decorators: [],
    connectionSchemes: [],
  };
}

async function parseEcmaScriptSource(
  file: FileInventory["files"][number],
  fileSet: ReadonlySet<string>,
  manifestsByName: ReadonlyMap<string, PackageManifest>,
  aliasConfigs: readonly AliasConfig[],
  diagnostics: AnalysisDiagnostic[],
): Promise<SourceModule | undefined> {
  if (!file.language || !sourceExtensions.includes(file.extension) || file.role === "generated")
    return undefined;
  const body = await readFile(file.absolutePath, "utf8");
  const source = ts.createSourceFile(
    file.path,
    body,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file.extension),
  );
  const imports: ImportReference[] = [];
  const exports = new Set<string>();
  const declarations = new Set<string>();
  const environmentVariables = new Map<string, number>();
  const externalHosts = new Map<string, number>();
  const routes: RouteSignal[] = [];
  const calls: SourceModule["calls"] = [];
  const exportedMethods = new Set<string>();
  const addImport = (specifier: string, node: ts.Node, kind: ImportReference["kind"]) => {
    imports.push({
      specifier,
      line: lineOf(source, node),
      kind,
      ...resolveImport(file.path, specifier, fileSet, manifestsByName, aliasConfigs),
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = literalText(node.moduleSpecifier);
      if (specifier) addImport(specifier, node, "import");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = literalText(node.moduleSpecifier);
      if (specifier) addImport(specifier, node, "export");
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = literalText(node.arguments[0]);
        if (specifier) addImport(specifier, node, "dynamic");
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const specifier = literalText(node.arguments[0]);
        if (specifier) addImport(specifier, node, "require");
      }
      const route = callRoute(node, source);
      if (route) routes.push(route);
      calls.push({
        callee: node.expression.getText(source),
        line: lineOf(source, node),
        literalArguments: node.arguments.flatMap((argument) => {
          const value = literalText(argument);
          return value === undefined ? [] : [value];
        }),
      });
    }
    const name = declaredName(node);
    if (name) {
      declarations.add(name);
      if (hasExportModifier(node)) {
        for (const part of name.split(", ")) {
          exports.add(part);
          if (httpMethods.has(part)) exportedMethods.add(part);
        }
      }
    }
    if (ts.isExportAssignment(node)) exports.add("default");
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause))
      for (const element of node.exportClause.elements) exports.add(element.name.text);
    const variable = envName(node);
    if (variable && !environmentVariables.has(variable))
      environmentVariables.set(variable, lineOf(source, node));
    if (ts.isStringLiteralLike(node) && /^https?:\/\//i.test(node.text)) {
      try {
        const host = new URL(node.text).host;
        if (host && !externalHosts.has(host)) externalHosts.set(host, lineOf(source, node));
      } catch {
        // Invalid literal URLs do not contribute architecture evidence.
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const nextRoute = nextRoutePath(file.path);
  if (nextRoute)
    routes.unshift({ path: nextRoute, methods: [...exportedMethods].sort(), style: "next-app" });
  const parseDiagnostics =
    (source as ts.SourceFile & { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] })
      .parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    const first = parseDiagnostics[0];
    diagnostics.push({
      severity: "warning",
      code: "source.syntax",
      message: first
        ? ts.flattenDiagnosticMessageText(first.messageText, " ")
        : "Source contains syntax errors.",
      file: file.path,
      ...(first?.start === undefined
        ? {}
        : { line: source.getLineAndCharacterOfPosition(first.start).line + 1 }),
      stage: "building-imports",
    });
  }
  return {
    path: file.path,
    language: file.language === "javascript" ? "javascript" : "typescript",
    imports,
    exports: [...exports].sort(),
    declarations: [...declarations].sort(),
    environmentVariables: [...environmentVariables].map(([name, line]) => ({ name, line })),
    externalHosts: [...externalHosts].map(([host, line]) => ({ host, line })),
    routes,
    calls,
    decorators: [],
    connectionSchemes: body.split(/\r?\n/).flatMap((line, index) => {
      const match = line.match(/["'](postgres(?:ql)?|mysql|sqlite|mongodb(?:\+srv)?|redis):\/\//i);
      return match?.[1] ? [{ scheme: match[1].toLowerCase(), line: index + 1 }] : [];
    }),
    ...(parseDiagnostics.length > 0 ? { parseError: "syntax diagnostics present" } : {}),
  };
}

export async function parseSources(
  inventory: FileInventory,
  manifests: PackageManifest[],
  diagnostics: AnalysisDiagnostic[],
): Promise<SourceModule[]> {
  const fileSet = new Set(inventory.files.map((file) => file.path));
  const manifestsByName = new Map(
    manifests
      .filter((manifest) => manifest.isWorkspace)
      .map((manifest) => [manifest.name, manifest]),
  );
  const aliasConfigs = await readAliasConfigs(inventory, diagnostics);
  const modules: SourceModule[] = [];
  const adapters: SourceAnalyzerAdapter[] = [
    {
      id: "python",
      supports: (file) => file.language === "python",
      analyze: (file) => parsePythonSource(file, inventory, manifests, diagnostics),
    },
    {
      id: "javascript-typescript",
      supports: (file) => file.language === "javascript" || file.language === "typescript",
      analyze: (file) =>
        parseEcmaScriptSource(file, fileSet, manifestsByName, aliasConfigs, diagnostics),
    },
  ];

  for (const file of inventory.files) {
    if (/^\.env(?:\.[^.]+)*\.(?:example|sample|template)$/.test(basename(file.path))) {
      modules.push(parseEnvironmentTemplate(file.path, await readFile(file.absolutePath, "utf8")));
      continue;
    }
    if (file.language === "json") {
      try {
        JSON.parse(await readFile(file.absolutePath, "utf8"));
      } catch (error) {
        diagnostics.push({
          severity: "warning",
          code: "source.json-invalid",
          message: error instanceof Error ? error.message : "JSON could not be parsed.",
          file: file.path,
          stage: "building-imports",
        });
      }
      continue;
    }
    const adapter = adapters.find((candidate) => candidate.supports(file));
    if (!adapter) continue;
    const module = await adapter.analyze(file, { inventory, manifests, diagnostics });
    if (module) modules.push(module);
  }

  return modules.sort((left, right) => left.path.localeCompare(right.path));
}
