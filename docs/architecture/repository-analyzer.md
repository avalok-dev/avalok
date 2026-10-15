# Repository analyzer

`@visual-system/analyzer` converts local application, deployment, and infrastructure configuration into an evidence-backed `ArchitectureGraph`. It is a Node-only, React-independent package. The browser receives bounded metadata, never raw source contents or secret values.

## Pipeline

```text
repository
  -> bounded file inventory
  -> static Node/Python manifest parsing
  -> JS/TS and Python source adapters
  -> Dockerfile/Compose configuration adapters
  -> Terraform/Kubernetes/Helm infrastructure adapters
  -> service ownership
  -> import graph
  -> modular detectors
  -> architecture inference
  -> evidence + confidence
  -> architecture graph
```

The pipeline implementation is split across `inventory.ts`, `manifests.ts`, `source-parser.ts`, `detectors.ts`, `inference.ts`, and the orchestration in `index.ts`. A failed or malformed input file creates a diagnostic and does not invalidate unrelated findings.

## Supported inputs

- TypeScript, TSX, JavaScript, JSX, Python, JSON, TOML, and YAML source/configuration
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, and `jsconfig.json`
- `pyproject.toml`, requirements files, Pipfile, Dockerfiles, and Compose
- Terraform `.tf`/`.tf.json`, Kubernetes multi-document YAML, and statically resolvable Helm charts
- relative imports, workspace package imports, and common TypeScript path aliases
- Python local/relative imports and conventional `src/` packages
- Next.js, Express, Fastify, FastAPI, Flask, and basic Django recognition
- static environment variable names and public external hostnames

Go, Java, Kotlin, Rust, Ruby, PHP, C#, Swift, and C/C++ are inventory-only. Infrastructure input is static configuration only; cloud and cluster APIs are not queried.

## Evidence and confidence

Service entities originate from Node/Python manifests, Compose build contexts, Dockerfiles, and owned files. Relationships originate from workspace imports/dependencies, literal service targets, and Compose deployment dependencies. Routes remain service inspector metadata. Integrations require usage or deployment evidence before being promoted to the default graph.

Each entity and important edge stores bounded evidence records in `metadata.architecture`. The confidence score combines independent evidence weights and is rendered as Confirmed, High, Medium, or Low. Dependencies alone remain low-confidence technology metadata in most cases; dependency plus import or route plus method evidence is high/confirmed.

## Safety invariants

The analyzer uses only read-only filesystem metadata and bounded file reads. It does not:

- execute scripts, builds, binaries, containers, or target application code;
- import target modules or evaluate JavaScript/configuration;
- install target dependencies;
- inspect `.env` values or resolve environment variable values;
- make network requests, call an LLM, upload source, or emit telemetry;
- write to the analyzed repository.

Symlinks are not followed. Default ignores include dependency, VCS, build, coverage, cache, and `.terraform` directories plus state/variable files. Secret `.env` files are skipped; `.env.example`-style templates contribute names only. Repositories may add `.avalokignore` patterns for analysis-only exclusions without changing Git tracking.

## Limits and partial results

Defaults are 10,000 files, 1 MiB per file, and 25 MiB total eligible bytes. Limits are configurable. When reached, the result is marked partial, diagnostics explain why, and confidence receives a penalty. The analyzer never crashes merely because a repository exceeds a limit.

## Cache

The local process cache is keyed by canonical root, analyzer version, and architecture-relevant paths, sizes, and mtimes. Documentation and asset changes do not invalidate architecture work. The **Rescan** action bypasses this cache. No cache file is written into the target repository.

## Initial detectors

Framework/library metadata: Next.js, React, React Flow, Zustand, ELK, Zod, and Node.js.

Evidence-backed integrations: OpenAI, Anthropic, MCP, OpenTelemetry, PostgreSQL, Redis, Prisma, Drizzle, Supabase, AWS, Stripe, Firebase, LangChain, LlamaIndex, and statically identifiable external HTTP hosts.

The source-adapter and detector lists are intentionally small and internal. Adapters return the same generic source/configuration observations; detectors receive the immutable analysis context and return signals. No language owns a separate graph model.

See [python-analysis.md](./python-analysis.md), [docker-analysis.md](./docker-analysis.md), [service-inference.md](./service-inference.md), [infrastructure-model.md](./infrastructure-model.md), [terraform-analysis.md](./terraform-analysis.md), [kubernetes-analysis.md](./kubernetes-analysis.md), and [helm-analysis.md](./helm-analysis.md).
