# Milestone 3: repository intelligence and reconciliation

Milestone 3 adds deterministic, local repository understanding without replacing either of the product's existing graph concepts. AgentMap now maintains three explicit views:

- the **architecture graph** answers what was detected in source and configuration;
- the **execution graph** answers what the selected Codex session observed;
- the **unified graph** keeps the architecture visible and overlays matched and unmatched runtime activity.

The demo graph and the Codex execution graph remain valid independent inputs. Repository analysis is an additional source, not a rewrite of either earlier milestone.

## Package boundaries

`packages/analyzer` is React-independent and owns all repository reads and static inference. `packages/reconcile` is also React-independent and owns deterministic architecture/runtime association. The web application exposes a Node-only local route, manages selection, and renders the resulting graph with the existing visual language.

```text
target repository
      |
      v
packages/analyzer ---> architecture graph
                            |
Codex JSONL                 v
      |              packages/reconcile ---> unified graph
      v                     ^
packages/codex-adapter -----|
```

Dependency direction remains one-way:

```text
schema <- analyzer
schema <- codex-adapter
schema <- reconcile
schema <- graph <- ui <- web
schema <- replay <- ui <- web
```

## Analyzer pipeline

The analyzer is a sequence of bounded stages rather than one repository-scanner function.

1. **Repository discovery** validates the requested root and establishes the analysis limits.
2. **File inventory** walks regular files without following symlinks, applies the safe ignore set and practical `.gitignore` rules, classifies roles/languages, and stops cleanly at configured limits.
3. **Manifest analysis** parses package/workspace metadata and selected JSON/YAML configuration as data. Scripts are recorded but never invoked.
4. **Source parsing** uses the TypeScript compiler parser to build syntax trees for TypeScript, TSX, JavaScript, and JSX. JSON is parsed as data.
5. **Import graph construction** resolves relative imports, workspace package names, and statically configured TypeScript path aliases where possible. Unresolved imports become diagnostics.
6. **Framework and integration detection** applies small modular detectors to manifests and parsed syntax signals.
7. **Architecture inference** promotes workspace packages, meaningful routes, and evidence-backed integrations into hierarchical architecture entities and edges.
8. **Evidence and confidence scoring** attaches the exact static observations supporting each inferred entity and important relationship.
9. **Graph generation** returns a package/system-level default graph plus file and hierarchy metadata for inspector drill-down.

Every stage consumes and returns plain data. The analyzer does not import target modules and has no dependency on React, Next.js, the UI, or the Codex adapter.

## Parser choice

The TypeScript Compiler API is used in syntax-only mode with `createSourceFile`. It is already part of this TypeScript-first monorepo, supports TS/TSX/JS/JSX without a native binary, and provides reliable traversal for imports, exports, declarations, calls, environment references, and statically knowable literals.

The analyzer deliberately does not create or emit a TypeScript program, load plugins, resolve executable configuration, or import application modules. It needs architectural syntax signals, not full compiler correctness. Malformed source produces a diagnostic while other files continue.

## Inventory and limits

Safe default ignores include `.git`, `node_modules`, `.next`, `dist`, `build`, `coverage`, `.turbo`, common cache directories, and known generated outputs. The walker does not follow symlinks. Binary extensions and files containing binary-like content are skipped. `.env` values are never parsed; only example/template environment files are eligible for variable-name extraction.

Default limits are configurable:

- 10,000 discovered files;
- 1 MiB per parsed file;
- 25 MiB total parsed source/configuration bytes.

Reaching a limit returns a partial analysis with a warning and reduced graph confidence. It never turns a useful partial result into a hard failure.

## Workspace and hierarchy strategy

Workspace roots come from static package metadata and `pnpm-workspace.yaml` patterns. Each workspace package is eligible to become the package-level entity shown by default. Entity IDs are stable path-derived identifiers. Friendly names and roles use manifest names, directory conventions, framework evidence, and package names; they do not contain repository-specific hard-coded cases.

Hierarchy is retained in architecture metadata:

```text
repository
  apps
    apps/web
  packages
    packages/schema
    packages/graph
    packages/replay
    packages/ui
    packages/codex-adapter
    packages/analyzer
    packages/reconcile
```

The initial canvas shows package/system entities and a bounded set of meaningful route/integration nodes. Files remain available through inspector drill-down instead of becoming thousands of graph nodes.

## Entity and edge inference

Package entities are supported by package manifests and owned source files. Package relationships are created from workspace dependencies and confirmed source imports. Next.js App Router route files produce API route metadata and, for a bounded route count, route entities linked to their owning web application. External integrations become nodes only when they are architecturally meaningful and have sufficient evidence.

Framework/library detections such as React, React Flow, Zustand, ELK, and Zod are normally attached as technologies to the owning package rather than promoted into one node per dependency. Service integrations such as OpenAI, Anthropic, MCP, PostgreSQL, Redis, Prisma, Drizzle, Supabase, and statically identifiable external HTTP services can become architecture entities when import, initialization, route, hostname, or environment-name evidence supports them.

The detector interface is intentionally small: each detector receives an immutable analysis context and returns detections. Adding a technology does not require modifying the inventory or parser stages.

## Evidence model

Every inferred entity and relationship carries evidence records with:

- evidence kind, such as manifest dependency, import, framework convention, call expression, route convention, or workspace membership;
- repository-relative file path;
- optional one-based line number;
- a short redacted-safe explanation;
- numeric signal weight.

No source file contents or secret values are sent to the browser. Evidence contains only bounded descriptions, paths, identifiers, dependency names, public hostnames, route names, and environment variable names.

## Confidence model

Confidence is deterministic and explainable. Independent signals are combined with a saturating score so repeated weak evidence cannot imply impossible certainty. The displayed labels are:

- **Confirmed**: `>= 0.95`
- **High**: `>= 0.80`
- **Medium**: `>= 0.55`
- **Low**: `< 0.55`

Examples:

- workspace manifest plus owned source files plus observed imports is confirmed/high;
- a dependency plus an import is high;
- a dependency alone is low and normally remains inspector technology metadata rather than a default graph node;
- a static route convention plus exported HTTP method is confirmed.

Partial analysis applies a visible confidence penalty and records why the result is partial.

## Reconciliation strategy

Reconciliation is deterministic and does not use an LLM. It considers, in priority order:

1. exact repository-relative source path;
2. exact absolute path normalized against the analyzed repository root;
3. workspace/package ownership by longest matching directory;
4. known route or integration identity where a runtime record exposes it.

Each match records the runtime event, runtime path/entity, architecture entity, match type, confidence, and evidence. File-change events may map to more than one architecture entity because one Codex operation can change files in several packages. The original event remains intact; matched architecture IDs are attached as reconciliation metadata for replay and inspection.

The unified graph is derived, never persisted back into the static graph. It contains the static entities and edges plus selected execution entities and runtime-observation edges. Terminal, model, MCP, Codex, and other useful unmatched runtime entities remain visible. Static edges stay subtle; runtime-observation edges and currently active components receive the existing active treatment.

## Runtime overlay state

An architecture entity's runtime status is computed for the selected session and replay timestamp:

- **Not observed**: no matched event at or before the playhead;
- **Observed**: at least one completed matched event;
- **Active now**: a matched event is within its visual activity window;
- **Error**: a matched error event is current or observed.

This status never mutates the analyzer result. Switching sessions or disabling the execution overlay immediately restores the static view.

## Cache and rescan

The first version uses a process-local cache keyed by the canonical repository path, analyzer version, inventory paths, sizes, and modification times. Inventory is still bounded and read-only; unchanged repositories reuse parsed and inferred results. **Rescan** bypasses the cache. A changed fingerprint marks old analysis stale rather than silently presenting it as current.

## Security and privacy model

Repository analysis is local and static.

The analyzer may use read-only filesystem metadata and bounded file reads. It must never:

- execute package scripts, shell scripts, application binaries, build commands, containers, Terraform, or arbitrary tools;
- install dependencies;
- evaluate JavaScript or executable configuration;
- import target application modules;
- read `.env` secret values;
- resolve environment variable values;
- make network requests, upload source, invoke an LLM, or emit telemetry;
- write to the target repository.

The initial web API exposes only the server-selected current AgentMap repository. It does not accept arbitrary browser-supplied filesystem paths. Future local-path selection must add an explicit trusted local selection boundary rather than accepting an unchecked path string.

## Expected architecture for this repository

Without repository-specific rules, the current workspace should yield at least these package-level entities:

- Web Application (`apps/web`), with Next.js and React evidence;
- Schema (`packages/schema`), with Zod evidence;
- Graph Engine (`packages/graph`), with ELK evidence;
- Replay Engine (`packages/replay`);
- UI Components (`packages/ui`), with React Flow/React evidence;
- Codex Adapter (`packages/codex-adapter`), with local filesystem evidence;
- Repository Analyzer (`packages/analyzer`);
- Reconciliation (`packages/reconcile`).

Expected edges follow actual workspace dependencies, including Web Application to the reusable packages, Graph Engine and Replay Engine to Schema, UI Components to Schema and Replay Engine, Codex Adapter to Schema, Analyzer to Schema, and Reconciliation to Schema. Next.js API route conventions under `apps/web/src/app/api` should be detected with method and source evidence.

The exact counts may change with the repository. Product language must remain “detected,” “observed,” and “inferred,” and the inspector must always show why a conclusion exists.

## Known first-version limits

- Language scope is TypeScript, JavaScript, TSX, JSX, and JSON.
- Import resolution is intentionally syntax-level and supports common relative, workspace, and path-alias cases rather than every Node/TypeScript resolution edge case.
- Dynamic routes and dynamic import targets are reported only when statically knowable.
- Express and Fastify route extraction is limited to straightforward literal calls.
- The cache is local to the AgentMap server process.
- Repository watching is limited to explicit stale/rescan behavior in this milestone; expensive full scans are never triggered per keystroke.
