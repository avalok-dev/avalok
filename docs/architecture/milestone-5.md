# Milestone 5: universal repository intelligence V1

> **Historical record.** Written while the product's working name was AgentMap (later Sarvadrik); the product is now **Avalok** (CLI `avalok`, environment variables `AVALOK_*`). Commands and names below are as they were at the time.

## Baseline

Milestone 5 extends the working Milestones 1-4 system. It does not replace the existing
`ArchitectureGraph`, runtime `Run`/execution graph, derived unified graph, replay engine, runtime
adapters, or UI. Before implementation, Node `24.19.0` and pnpm `11.19.0` were active and lint,
typecheck, 50 tests, and the production build passed. The existing Next.js ESLint-plugin warning
remains non-blocking and is unrelated to repository analysis.

The starting analyzer is a bounded, read-only JS/TS pipeline with process-local caching. Its main
language-specific assumptions are that `package.json` workspaces define every ownership boundary,
the TypeScript parser owns every source module, and dependency detectors read only npm manifests.
Milestone 5 generalizes those seams while keeping the existing graph and evidence model.

## Scope

This milestone adds:

- first-class static Python analysis;
- static Dockerfile and Docker Compose analysis;
- service discovery and ownership across JS/TS and Python;
- high-level multi-service architecture inference with bounded default graph size;
- generic language inventory and honest unsupported-language diagnostics;
- Python-aware telemetry reconciliation;
- a deterministic polyglot example and focused fixture repositories.

It does not add Terraform, Kubernetes, Helm, cloud discovery, repository cloning, architecture
diff UI, authentication, billing, hosted telemetry, or static analyzers for other languages.

## Architecture

The existing pipeline remains the coordinator. Language and configuration adapters contribute
plain data to the same inference stage:

```text
repository root
      |
      v
bounded inventory + language summary
      |
      +---- JS/TS adapter ---- package manifests + TypeScript syntax modules
      |
      +---- Python adapter --- Python manifests + Lezer syntax modules
      |
      +---- config adapters -- Dockerfiles + Compose documents
      |
      v
service boundaries + ownership
      |
      v
detectors + evidence + confidence
      |
      v
one deterministic ArchitectureGraph
      |
      +---- inspector detail (routes, files, evidence)
      |
      +---- runtime reconciliation
```

The adapter abstraction is internal and deliberately small. An adapter declares whether it
supports an inventory file and returns manifest, source, or configuration observations plus
diagnostics. Adapters do not create separate graph schemas and do not execute target code.

## Generic service model

`ServiceUnit` is the analyzer's ownership boundary. A unit has a stable repository-relative
directory, display name, optional declared name, runtime/language metadata, source files,
dependencies, routes, and evidence. Units are discovered from independent signals:

- JS/TS package/workspace manifests;
- Python `pyproject.toml`, `requirements.txt`, `requirements/*.txt`, and straightforward Pipfile
  metadata;
- Docker Compose build contexts;
- Dockerfile entrypoints;
- framework entrypoints and source concentration.

The strongest and most specific boundary owns a file. A root manifest remains a fallback when no
more specific service exists. Folder names may improve a label but never establish a service by
themselves. Repository-relative directories are the primary stable identity input.

The default graph represents services and architecturally meaningful integrations. Routes,
modules, and files remain service metadata and inspector detail unless a small route set is needed
for an existing behavior. The system view targets 5-30 nodes. When an analysis would exceed that
budget, lower-level nodes are grouped rather than scaled down.

## Python parser choice

Python source is parsed with `@lezer/python`. Lezer provides a real Python grammar and immutable
syntax tree, runs as pure JavaScript in the existing Node analyzer, and requires neither native
bindings nor a target Python interpreter. This keeps installation portable and preserves the
non-execution boundary. The parser is used only for syntax structure; small bounded source slices
are decoded for statically knowable names and literals.

The analyzer does not invoke Python, import repository modules, create environments, install
requirements, or attempt full semantic/type analysis. Error nodes produce diagnostics while valid
parts of the file continue to contribute evidence.

Python extraction covers:

- `import` and `from ... import ...`, including relative imports;
- functions, classes, decorators, and straightforward assignments/calls;
- `os.getenv` and `os.environ[...]` variable names only;
- literal FastAPI, Flask, and router route decorators;
- obvious framework/client construction and literal external HTTP targets.

Repository-local imports resolve against service roots, conventional `src/` roots, package
directories, `__init__.py`, and relative import levels. Failures are non-fatal diagnostics.

## Python manifests and detectors

`pyproject.toml` is parsed as data with a non-evaluating TOML parser. Poetry and PEP 621 dependency
tables contribute declared dependencies and project names. Requirements files and Pipfiles use
bounded line/static-table parsing. Options, markers, hashes, and version constraints are discarded
after extracting normalized distribution names.

Framework detection prioritizes FastAPI and includes basic Flask and Django recognition. FastAPI
and Flask route metadata stays under the owning service. Django V1 combines declared dependencies,
Django imports, and conventional project source ownership; it does not evaluate settings, URL
configuration, or `INSTALLED_APPS`.

AI and data detectors require evidence combinations. A dependency alone may add technology
metadata, but promotion normally requires an import, client construction, route/use signal,
environment variable name, connection scheme, or configuration/runtime corroboration. Initial
Python coverage includes OpenAI, Anthropic, OpenAI Agents SDK, LangChain, LlamaIndex, MCP,
OpenInference, OpenTelemetry, SQLAlchemy, PostgreSQL, SQLite, MySQL, MongoDB, Redis, Celery, and RQ.
ORM/client evidence and the underlying database remain distinct metadata when only the client is
known.

## Dockerfile and Compose

Dockerfiles are tokenized statically with line continuation and JSON/shell form handling. The
analyzer records stages, base images, working directory, copied paths, exposed ports, entrypoint,
and command. It never builds an image or executes an instruction. Docker evidence strengthens an
existing service; Docker itself is not a top-level architecture entity.

Compose YAML is parsed with a safe, schema-independent YAML parser. Only bounded mappings/lists
needed for architecture are retained: service name, build context/Dockerfile, image, ports,
`depends_on`, networks, volumes, healthcheck presence, and environment variable names. Literal
environment values are discarded before results leave the parser; sensitive-looking values are
reported only as redacted evidence.

Compose service names and build contexts strengthen service identities. Known infrastructure
images may establish PostgreSQL, Redis, MySQL, MongoDB, or queue/cache entities. `depends_on`
produces a `deployment-dependency` relationship labelled `depends on`; it never claims an
application call. Source, route, URL, proxy, or runtime evidence may separately produce a `calls`
or `uses` relationship.

## Evidence, relationships, and stable IDs

All analyzers emit the existing evidence concept, extended with Python manifest, Compose,
Dockerfile, decorator, connection-scheme, and deployment evidence kinds. Every default entity and
important edge answers why it exists. Static detection/inference and runtime observation remain
separate metadata.

Static entity IDs are derived from stable inputs:

- service: normalized repository-relative ownership directory;
- Compose-only service: Compose service name plus Compose file path;
- integration: normalized integration type/name;
- optional route identity: owner plus HTTP method/path.

IDs never depend on discovery order or random values. Edge IDs derive from source, target, and
relationship type. Relationship types remain explicit: imports, calls, depends on, contains, uses,
and deployed as.

## Cross-language relationships

Cross-language edges require deterministic evidence. Supported signals include:

- literal URLs/ports or public API environment variable names referenced by a caller;
- a uniquely matching Compose service/port or proxy target;
- resolved workspace/service imports where the language permits them;
- runtime service, route, path, port, or integration metadata.

Coexistence in one repository is not evidence of communication. Ambiguous matches stay
unconnected or receive lower confidence with the exact reason visible.

## Runtime reconciliation

Existing exact file-path and longest-owner matches remain highest priority. Python source files
become ordinary analyzed source ownership, so `code.filepath` maps without special UI logic.
Additional deterministic matching uses unique normalized `service.name`, Compose service name,
framework/HTTP route, service port, and integration/database identity. Match evidence records the
signal used. Unmatched runtime nodes remain visible.

## Inventory, cache, and safety

Language inventory recognizes Python plus common unsupported languages by extension and reports
file/byte approximations. Unsupported languages produce an informational diagnostic and no fake
architecture conclusions.

The safe ignore set adds `.venv`, `venv`, `__pycache__`, `.pytest_cache`, `.mypy_cache`,
`.ruff_cache`, and `site-packages`. Directory entries are inspected without following symlinks;
resolved analysis paths must remain inside the canonical repository root. Existing file/byte limits
and partial-result behavior apply to every adapter.

The cache fingerprint includes every eligible architecture input (`.py`, JS/TS, manifests,
Dockerfiles, Compose, and supported configuration). Documentation-only changes do not invalidate
the architecture result. Explicit rescan remains supported; continuous watching is not introduced.

Analysis never runs target code, package managers, Docker, Compose, scripts, imports, builds,
network requests, or LLM calls. It never reads `.env` values or writes to the target repository.

## UI

The existing visual language and Map/Live/Runs behavior remain. Minimal additions are:

- repository summary with languages, service/entity counts, confidence, and scan metrics;
- language/framework/service metadata in the inspector;
- grouped service routes and evidence;
- a System/Components abstraction selector only if the existing graph needs it after high-level
  inference. File level remains inspector-only.

The layout continues to operate on deterministic IDs so rescans do not create avoidable graph
jumps.

## Example and tests

`examples/polyglot-ai-platform` contains a lightweight TypeScript frontend, FastAPI backend,
Python worker, PostgreSQL, Redis, deterministic model behavior, Dockerfiles, and Compose. The
Python example can emit OTLP/HTTP JSON using only Python's standard library so the checked-in
fixture requires no install and no paid API. Its runtime `service.name` and `code.filepath`
correspond to static service evidence.

Focused analyzer fixtures cover FastAPI/OpenAI, Flask, a plain Python package, a Next.js/FastAPI
monorepo, Compose multi-service architecture, malformed inputs, unsupported language inventory,
ignored environments, symlink safety, stable IDs, limits, cache behavior, and redaction. A golden
test asserts only the meaningful high-level polyglot entities and relationships. Reconciliation
tests assert Python path/service/route matches and unmatched behavior.

## Delivery order

1. Generalize analyzer types, inventory, language summary, ownership, and cache inputs.
2. Add Python manifest/source parsing and import resolution with focused tests.
3. Add Python framework, AI, database, HTTP, environment, and worker detectors.
4. Add Dockerfile/Compose parsing and service/deployment inference.
5. Add graph budgeting, summaries, stable relationship IDs, and cross-language edges.
6. Extend reconciliation and the inspector/source summary.
7. Add the polyglot static/runtime example and end-to-end tests.
8. Update architecture docs, capability matrix, acceptance guide, and project context.
9. Run formatting, lint, typecheck, all tests, build, and browser verification.

## Acceptance boundary

Milestone 5 is complete when existing Demo, Codex, Claude Code, OTLP/OpenInference, replay, live,
and JS/TS repository behavior still pass; Python/FastAPI and Docker/Compose produce explainable
high-level architecture; the polyglot example's Python telemetry maps to its static backend; secret
values and external symlinks remain inaccessible; malformed/unsupported inputs yield diagnostics;
and documentation describes only behavior verified by tests or manual inspection.
