# Repository analyzer

`@visual-system/analyzer` converts a local JavaScript/TypeScript repository into an evidence-backed `ArchitectureGraph`. It is a Node-only, React-independent package. The browser receives bounded metadata, never raw source contents.

## Pipeline

```text
repository
  -> bounded file inventory
  -> static manifest parsing
  -> TypeScript syntax parsing
  -> import graph
  -> modular detectors
  -> architecture inference
  -> evidence + confidence
  -> architecture graph
```

The pipeline implementation is split across `inventory.ts`, `manifests.ts`, `source-parser.ts`, `detectors.ts`, `inference.ts`, and the orchestration in `index.ts`. A failed or malformed input file creates a diagnostic and does not invalidate unrelated findings.

## Supported inputs

- TypeScript, TSX, JavaScript, JSX, and JSON source/configuration
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, and `jsconfig.json`
- relative imports, workspace package imports, and common TypeScript path aliases
- Next.js App Router routes and straightforward Express/Fastify literal routes
- static environment variable names and public external hostnames

Python and other language analyzers are intentionally out of scope.

## Evidence and confidence

Package entities originate from workspace manifests and owned files. Relationships originate from workspace dependency declarations and cross-package imports. Routes originate from framework conventions and exported HTTP methods. Integrations require usage evidence before being promoted to the default graph.

Each entity and important edge stores bounded evidence records in `metadata.architecture`. The confidence score combines independent evidence weights and is rendered as Confirmed, High, Medium, or Low. Dependencies alone remain low-confidence technology metadata in most cases; dependency plus import or route plus method evidence is high/confirmed.

## Safety invariants

The analyzer uses only read-only filesystem metadata and bounded file reads. It does not:

- execute scripts, builds, binaries, containers, or target application code;
- import target modules or evaluate JavaScript/configuration;
- install target dependencies;
- inspect `.env` values or resolve environment variable values;
- make network requests, call an LLM, upload source, or emit telemetry;
- write to the analyzed repository.

Symlinks are not followed. Default ignores include dependency, VCS, build, coverage, and cache directories. Secret `.env` files are skipped; `.env.example`-style templates contribute names only.

## Limits and partial results

Defaults are 10,000 files, 1 MiB per file, and 25 MiB total eligible bytes. Limits are configurable. When reached, the result is marked partial, diagnostics explain why, and confidence receives a penalty. The analyzer never crashes merely because a repository exceeds a limit.

## Cache

The local process cache is keyed by canonical root, analyzer version, repository-relative paths, sizes, and mtimes. An unchanged repository reuses the completed result. The **Rescan** action bypasses this cache. No cache file is written into the target repository.

## Initial detectors

Framework/library metadata: Next.js, React, React Flow, Zustand, ELK, Zod, and Node.js.

Evidence-backed integrations: OpenAI, Anthropic, MCP, OpenTelemetry, PostgreSQL, Redis, Prisma, Drizzle, Supabase, AWS, Stripe, Firebase, LangChain, LlamaIndex, and statically identifiable external HTTP hosts.

The detector list is intentionally modular. A detector receives the immutable analysis context and returns signals; it does not own scanning or parsing.
