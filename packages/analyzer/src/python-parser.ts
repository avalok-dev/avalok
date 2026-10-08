import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { parser } from "@lezer/python";
import type {
  AnalysisDiagnostic,
  FileInventory,
  ImportReference,
  InventoryFile,
  PackageManifest,
  RouteSignal,
  SourceModule,
} from "./types";

const pythonCandidatePaths = (path: string) => [`${path}.py`, posix.join(path, "__init__.py")];
const normalizePath = (value: string) => {
  const normalized = posix.normalize(value);
  return normalized === "." ? "." : normalized.replace(/^\.\//, "");
};

function pythonOwner(path: string, manifests: readonly PackageManifest[]) {
  return manifests
    .filter(
      (manifest) =>
        manifest.ecosystem === "python" &&
        (manifest.directory === "." ||
          path === manifest.directory ||
          path.startsWith(`${manifest.directory}/`)),
    )
    .sort((left, right) => right.directory.length - left.directory.length)[0];
}

function resolvePythonImport(
  sourcePath: string,
  specifier: string,
  inventory: FileInventory,
  manifests: readonly PackageManifest[],
) {
  const files = new Set(inventory.files.map((file) => file.path));
  const owner = pythonOwner(sourcePath, manifests);
  const ownerDirectory = owner?.directory ?? ".";
  const roots = [ownerDirectory, posix.join(ownerDirectory, "src"), "."].map(normalizePath);
  const relativeMatch = specifier.match(/^(\.+)(.*)$/);
  const bases: string[] = [];
  if (relativeMatch) {
    let base = posix.dirname(sourcePath);
    for (let level = 1; level < relativeMatch[1]!.length; level += 1) base = posix.dirname(base);
    bases.push(normalizePath(posix.join(base, relativeMatch[2]!.replaceAll(".", "/"))));
  } else {
    const modulePath = specifier.replaceAll(".", "/");
    for (const root of roots) bases.push(normalizePath(posix.join(root, modulePath)));
  }
  for (const base of bases) {
    const resolvedPath = pythonCandidatePaths(base).find((candidate) => files.has(candidate));
    if (resolvedPath) return { resolvedPath, expectedLocal: true };
  }
  const firstSegment = specifier.replace(/^\.+/, "").split(".")[0];
  const expectedLocal =
    Boolean(relativeMatch) ||
    (firstSegment
      ? roots.some((root) => {
          const prefix = normalizePath(posix.join(root, firstSegment));
          return [...files].some((candidate) => candidate.startsWith(`${prefix}/`));
        })
      : false);
  return expectedLocal ? { expectedLocal: true } : {};
}

/**
 * Same-length rewrites of valid Python that `@lezer/python` (1.1.19, the latest release) cannot
 * parse yet. The result is used only to decide whether a file has a real syntax problem; it is
 * never used to extract signals, so strings and comments are free to be touched. Offsets stay
 * identical. Gaps still covered here:
 *   - float literals ending in a dot (`2.`, `1. / x`), common in numeric code
 *   - decorators with an arbitrary expression (`@a.b[0](1)`, PEP 614)
 *   - t-strings (`t"..."`, Python 3.14), rewritten as f-strings
 * Gaps NOT covered (Python 3.10+ syntax Lezer rejects): parenthesized `with (a as b, c as d):`
 * and a star in a subscript (`a[*b]`). Files using them are reported as parser-limited.
 */
export function normalizeForSyntaxCheck(body: string) {
  return body
    .replace(/(?<![\w.])(\d[\d_]*)\.(?![\w.])/g, (_match, digits: string) => `${digits}0`)
    .replace(/^([ \t]*@)([^\n#]*)/gm, (_match, at: string, expression: string) => {
      const trimmed = expression.replace(/\s+$/, "");
      return `${at}${"a".repeat(trimmed.length)}${expression.slice(trimmed.length)}`;
    })
    .replace(/(?<![\w])([rRbBuU]?)([tT])(?=["'])/g, (_match, prefix: string) => `${prefix}f`);
}

/**
 * True only when the file still fails to parse after the known parser gaps are worked around.
 * This means Avalok's parser could not read the file; it does not prove the code is invalid.
 */
export function hasPythonParseProblem(body: string) {
  return pythonParseProblemLine(body) !== undefined;
}

/**
 * One-based line of the first place the parser gave up, or undefined when the file parses (after
 * the known gaps are worked around). Offsets are preserved by the rewrites, so the line is exact
 * for the original text. An error at the very end (an unclosed bracket) reports the last line.
 */
export function pythonParseProblemLine(body: string) {
  if (!treeContainsError(body)) return undefined;
  const normalized = normalizeForSyntaxCheck(body);
  let offset: number | undefined;
  parser.parse(normalized).iterate({
    enter: (node) => {
      if (offset !== undefined) return false;
      if (node.type.isError) {
        offset = node.from;
        return false;
      }
      return undefined;
    },
  });
  if (offset === undefined) return undefined;
  const lineCount = body.replace(/\n$/, "").split("\n").length;
  return Math.min(body.slice(0, offset).split("\n").length, lineCount);
}

function treeContainsError(body: string) {
  const cursor = parser.parse(body).cursor();
  let found = false;
  const visit = () => {
    if (cursor.type.isError) found = true;
    if (cursor.firstChild()) {
      do visit();
      while (cursor.nextSibling());
      cursor.parent();
    }
  };
  visit();
  return found;
}

function literalStrings(value: string) {
  return [...value.matchAll(/(?:[rubf]*)(["'])(.*?)\1/gi)].map((match) => match[2] ?? "");
}

function routeFromDecorator(
  line: string,
  lineNumber: number,
  framework: "fastapi" | "flask" | undefined,
): RouteSignal | undefined {
  const match = line.match(
    /^\s*@(?:[A-Za-z_]\w*)\.(get|post|put|patch|delete|head|options|route)\s*\(\s*[rubf]*["']([^"']+)["']([^)]*)/i,
  );
  if (!match?.[1] || !match[2]) return undefined;
  const method = match[1].toUpperCase();
  const methods =
    method === "ROUTE"
      ? [...(match[3] ?? "").matchAll(/["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/gi)].map(
          (item) => item[1]!.toUpperCase(),
        )
      : [method];
  return {
    path: match[2],
    methods: methods.length > 0 ? methods : ["GET"],
    style: framework ?? (method === "ROUTE" ? "flask" : "fastapi"),
    line: lineNumber,
  };
}

export async function parsePythonSource(
  file: InventoryFile,
  inventory: FileInventory,
  manifests: PackageManifest[],
  diagnostics: AnalysisDiagnostic[],
): Promise<SourceModule | undefined> {
  if (file.extension !== ".py" || file.role === "generated") return undefined;
  const body = await readFile(file.absolutePath, "utf8");
  const parseProblemLine = pythonParseProblemLine(body);
  if (parseProblemLine !== undefined) {
    diagnostics.push({
      severity: "info",
      code: "source.python-syntax",
      message:
        "Avalok's Python parser could not fully read this file. It may be incomplete, or it may use newer syntax the parser does not support yet, so some detected imports or routes could be missing. This does not necessarily mean your code is invalid.",
      file: file.path,
      line: parseProblemLine,
      stage: "building-imports",
    });
  }

  const imports: ImportReference[] = [];
  const exports = new Set<string>();
  const declarations = new Set<string>();
  const environmentVariables = new Map<string, number>();
  const externalHosts = new Map<string, number>();
  const routes: RouteSignal[] = [];
  const calls: SourceModule["calls"] = [];
  const decorators: SourceModule["decorators"] = [];
  const connectionSchemes: SourceModule["connectionSchemes"] = [];
  const lines = body.split(/\r?\n/);
  const importNames = new Set<string>();

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const importMatch = line.match(/^\s*import\s+(.+?)\s*(?:#.*)?$/);
    if (importMatch?.[1]) {
      for (const part of importMatch[1].split(",")) {
        const specifier = part.trim().split(/\s+as\s+/)[0];
        if (!specifier) continue;
        importNames.add(specifier.split(".")[0]!);
        imports.push({
          specifier,
          line: lineNumber,
          kind: "import",
          ...resolvePythonImport(file.path, specifier, inventory, manifests),
        });
      }
    }
    const fromMatch = line.match(/^\s*from\s+([.A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\s+(.+)/);
    if (fromMatch?.[1]) {
      const specifier = fromMatch[1];
      importNames.add(specifier.replace(/^\.+/, "").split(".")[0]!);
      imports.push({
        specifier,
        line: lineNumber,
        kind: "import",
        ...resolvePythonImport(file.path, specifier, inventory, manifests),
      });
    }

    const declaration = line.match(/^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/);
    if (declaration?.[1]) {
      declarations.add(declaration[1]);
      if (!declaration[1].startsWith("_")) exports.add(declaration[1]);
    }
    const decorator = line.match(/^\s*@([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/);
    if (decorator?.[1]) decorators.push({ name: decorator[1], line: lineNumber });

    for (const match of line.matchAll(/os\.getenv\s*\(\s*["']([A-Z][A-Z0-9_]*)["']/g))
      environmentVariables.set(match[1]!, lineNumber);
    for (const match of line.matchAll(/os\.environ\s*\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g))
      environmentVariables.set(match[1]!, lineNumber);

    for (const literal of literalStrings(line)) {
      if (/^https?:\/\//i.test(literal)) {
        try {
          const host = new URL(literal).host;
          if (host) externalHosts.set(host, lineNumber);
        } catch {
          // Invalid literal URLs are not architecture evidence.
        }
      }
      const scheme = literal.match(
        /^(postgres(?:ql)?|mysql|sqlite|mongodb(?:\+srv)?|redis):\/\//i,
      )?.[1];
      if (scheme) connectionSchemes.push({ scheme: scheme.toLowerCase(), line: lineNumber });
    }

    if (!/^\s*(?:async\s+)?def\s+/.test(line)) {
      for (const match of line.matchAll(/([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(([^()]*)\)/g)) {
        calls.push({
          callee: match[1]!,
          line: lineNumber,
          literalArguments: literalStrings(match[2] ?? ""),
        });
      }
    }
  }

  const framework = importNames.has("fastapi")
    ? "fastapi"
    : importNames.has("flask")
      ? "flask"
      : undefined;
  for (const [index, line] of lines.entries()) {
    const route = routeFromDecorator(line, index + 1, framework);
    if (route) routes.push(route);
  }

  return {
    path: file.path,
    language: "python",
    imports,
    exports: [...exports].sort(),
    declarations: [...declarations].sort(),
    environmentVariables: [...environmentVariables].map(([name, line]) => ({ name, line })),
    externalHosts: [...externalHosts].map(([host, line]) => ({ host, line })),
    routes,
    calls,
    decorators,
    connectionSchemes,
    ...(parseProblemLine !== undefined ? { parseError: "python syntax diagnostics present" } : {}),
  };
}
