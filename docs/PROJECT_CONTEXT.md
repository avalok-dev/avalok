# AgentMap project context

This is concise durable context for new coding tasks. `AGENTS.md` contains mandatory rules; this file records current product state and decisions.

## Current state

- **Milestone 1:** polished architecture canvas, Map/Live/Runs, generic schemas, graph/replay engines, inspector, timeline, and deterministic demo.
- **Milestone 2:** read-only local Codex JSONL discovery, normalization, historical replay, live tailing, files/terminal/MCP/model activity, metrics, source/session selection, diagnostics, and raw/normalized event inspection.
- **Milestone 3:** local static JS/TS repository analysis, evidence/confidence, architecture inference, repository map, deterministic architecture/runtime reconciliation, and execution overlay.
- **Milestone 4:** loopback OTLP/HTTP JSON ingestion, OpenInference and conservative generic OpenTelemetry normalization, opt-in Claude Code hooks/telemetry, a shared runtime adapter contract, persisted runtime runs, live updates, trace hierarchy, privacy/size policy, and expanded reconciliation.
- **Milestone 5:** safe Python analysis, Dockerfile and Compose parsing, polyglot service discovery, service-level architecture inference, cross-language reconciliation, and a runnable TypeScript/Python/worker fixture.
- **Milestone 6:** static Terraform, Kubernetes, Helm, and AWS infrastructure intelligence; application/deployment/runtime reconciliation; hierarchy/layer views; and resource metric/cost foundations.
- **Milestone 7.1:** package-shaped `agentmap` CLI, current/explicit repository targeting, one-command dashboard and OTLP startup, loopback-only defaults, readiness checks, source status, browser opening, and coordinated shutdown.
- **Milestone 7.2:** centralized capability/status reporting, a dismissible first-run/setup surface, actionable empty states, accurate OTLP/HTTP JSON guidance, a synthetic test trace, `agentmap doctor`, and platform-appropriate AgentMap-owned data controls.
- **Milestone 7.3:** one installable package (bundled CLI/collector/analyzers, Next.js standalone dashboard, allowlisted samples), centralized identity/version, clean-install smoke outside the monorepo, OTLP/HTTP protobuf ingestion, safe migration from `~/.agentmap/runtime`, and cross-platform hardening.
- Milestones 1-6 and M7.1-M7.3 are complete. Preserve their behavior rather than recreating it.

## Package map

| Area                                  | Responsibility                                                       |
| ------------------------------------- | -------------------------------------------------------------------- |
| `apps/web`                            | Next.js UI, local server routes, source selection, state composition |
| `packages/schema`                     | Vendor-neutral architecture/runtime schemas                          |
| `packages/graph`                      | Indexing, ELK layout, replay-derived graph state                     |
| `packages/replay`                     | Deterministic timeline, seek, speed, snapshots                       |
| `packages/ui`                         | Reusable React canvas, inspector, timeline, controls                 |
| `packages/codex-adapter`              | Read-only Codex session discovery and event normalization            |
| `packages/runtime-adapter`            | Runtime source capabilities, snapshot/delta contract, privacy policy |
| `packages/telemetry-adapter`          | OTLP JSON/protobuf decoding, normalization, local persistence        |
| `packages/claude-adapter`             | Claude Code lifecycle-hook normalization                             |
| `apps/collector`                      | Loopback OTLP/HTTP protobuf + JSON and Claude hook receiver          |
| `packages/cli`                        | Product CLI, lifecycle, identity, distribution build/pack/smoke      |
| `packages/capabilities`               | Shared capability semantics, source status, local data/settings      |
| `packages/analyzer`                   | Bounded static repository inventory, parsing, detection, inference   |
| `packages/reconcile`                  | Deterministic runtime-to-architecture matching and unified graph     |
| `examples/demo-agent`                 | Stable simulated demonstration fixture                               |
| `examples/instrumented-ai-app`        | Deterministic credential-free OTLP/OpenInference fixture             |
| `examples/polyglot-ai-platform`       | Next.js, FastAPI, worker, Compose, and OTLP polyglot fixture         |
| `examples/infrastructure-ai-platform` | Golden code + Terraform AWS + Helm/Kubernetes fixture                |

Dependency direction stays toward reusable data packages; analysis and reconciliation do not belong in React components.

## Core decisions

- TypeScript Compiler API parses TS/JS/TSX/JSX in syntax-only mode. JSON/configuration is read as data; target code is never evaluated.
- `@lezer/python` parses Python syntax without importing or executing target modules. Manifest support covers PEP 621, basic Poetry metadata, requirements files, and Pipfiles.
- Dockerfiles and Compose files are treated as untrusted data. Analysis extracts structure, ports, build ownership, and dependency semantics while discarding environment values.
- HashiCorp's `@cdktf/hcl2json` WebAssembly parser handles HCL syntax without Terraform/provider execution. `.tfvars`, state, locks, and `.terraform` are excluded.
- Kubernetes uses multi-document YAML parsing; Helm uses bounded static `.Values` substitution. Helm, kubectl, cloud CLIs, and provider plugins are never executed.
- Infrastructure uses provider-neutral resource/relationship records. AWS is the first provider ontology, not a separate graph model.
- Graph visibility is presentation policy: All hides detail fan-out, Infrastructure exposes it, and analysis retains safely discovered resources.
- Resource metrics always identify configured/observed/estimated provenance. Milestone 6 populates configured values only and never fabricates utilization or cost.
- Default map abstraction is system/package level. Files are inspector detail, not thousands of canvas nodes.
- The default polyglot abstraction is the service unit: workspace packages, Python project roots, Compose build contexts, and source-owning container roots. Stable IDs derive from normalized repository-relative paths.
- Architecture entities and important edges retain bounded evidence and deterministic confidence.
- Reconciliation order: exact relative path, normalized absolute path, longest workspace ownership, then known route/integration identity.
- The Unified Graph is derived. It never mutates the static graph; Terminal, model, MCP, Files, Tests, and other useful unmatched runtime entities remain visible.
- The browser may analyze only the server-selected current repository. It must not accept an unchecked arbitrary filesystem path.
- Repository analysis stays local: no LLM, cloud, telemetry, or source upload.
- Runtime sources declare capabilities; unsupported features are not represented as fake empty implementations.
- The collector binds to `127.0.0.1:4318`, requires explicit opt-in for public binding, bounds payloads, and persists only sanitized normalized snapshots below AgentMap's platform user-data `runtime/` directory.
- OTLP/OpenInference, Claude, and Codex all reach the existing vendor-neutral `Run.events`, graph, replay, and reconciliation paths.
- Generic service/HTTP/database spans remain conservative; arbitrary telemetry is not labeled as agent activity.
- Runtime deployment context follows one direct `deployed-as` edge; it is not recursively claimed on cloud/cluster/network entities.
- Distribution is one package built by `pnpm dist:build` into `packages/cli/dist` and packed by `pnpm dist:pack` into `artifacts/`. Identity lives in `packages/cli/product.json`; the only version is `packages/cli/package.json#version` (`0.1.0-alpha.N`). The generated manifest is `private: true`; nothing is published before M7.4.
- Installed assets resolve from the bundled module's location; the target is the cwd/argument; data is the platform root. The dashboard child is pinned to `127.0.0.1` and has Next telemetry disabled.
- OTLP protobuf is decoded with `protobufjs` against vendored official opentelemetry-proto definitions into the OTLP/JSON shape, then shares the JSON pipeline. OTLP/gRPC is unsupported.
- The CLI defaults to `process.cwd()`, passes a canonical server-owned target to the dashboard, binds local services to `127.0.0.1`, and uses the platform AgentMap user-data root unless `AGENTMAP_DATA_DIR` is set.

## Verified Milestone 7.3 state (2026-09-27)

- `format:check`, lint, typecheck, 148 tests, and the production build pass (baseline before M7.3: 105 tests).
- `pnpm dist:build && pnpm dist:pack` produces a ≈1.8 MB tarball (≈6.8 MB unpacked, ≈360 MB installed with Next/TypeScript dependencies).
- `pnpm dist:smoke --hide-workspace --python <venv python>` passed 43/43 on macOS arm64 with the checkout renamed away: JS/TS, Python, polyglot, infrastructure, and Unicode/spaced paths; dashboard assets; samples; test trace; OTLP JSON and protobuf; the standard Python exporter; restart persistence; Ctrl+C (≈50 ms) and force-kill orphan cleanup; safe data clearing.
- Linux/Windows logic has unit coverage; `.github/workflows/distribution.yml` defines the OS matrix but has not been run yet.
- Details: `docs/architecture/milestone-7-3.md` and `docs/development/{distribution,clean-install-test,otlp-protobuf,data-migration,platform-support,upgrading}.md`.

## Verified Milestone 7.1 state (2026-09-26)

- The local product command is `pnpm agentmap [path]`; help, version, `--no-open`, `--port`, and `--otlp-port` are supported.
- Dashboard port `4737` falls forward through a bounded local range; the standardized OTLP port `4318` fails clearly on conflict. Both services bind only to loopback.
- The real production dashboard and collector were started through the CLI against `examples/polyglot-ai-platform`; both health endpoints passed, the repository API returned the intended canonical target and six architecture entities, Ctrl+C exited zero, and both ports were released.
- Focused CLI coverage includes argument parsing, default/explicit/invalid targets, ports, loopback startup, analyzer target propagation, non-fatal discovery, browser failure, signals, and a temporary external-repository integration path.
- Distribution is intentionally deferred: the CLI still uses source workspace packages and the source dashboard directory. M7.3 owns compilation/bundling, dashboard asset inclusion, packed-install tests, and publication metadata.

## Verified Milestone 6 state (2026-09-26)

- Terraform native/JSON, Kubernetes, Helm, AWS inference, hierarchy, secret redaction, configured metrics, golden unified mapping, and deployment-context reconciliation have focused fixtures.
- The fixture matrix covers Terraform AWS, Kubernetes, Helm, EKS unification, serverless, malformed Terraform/Kubernetes/Helm, secret safety, duplicate reconciliation, and the golden infrastructure AI platform.
- The web source selector exposes Terraform, Kubernetes, Helm, and the unified golden fixture. All/Application/Infrastructure/Runtime filters preserve the established canvas and inspector.
- `format:check`, lint, typecheck, all 78 tests, and the production build pass across the workspace.
- A clean browser session loaded the golden fixture, exercised All/Infrastructure/Runtime filtering, inspected configured deployment metrics and evidence, and reported no console errors.
- The real AgentMap repository analyzed 240 files (176 parsed), 25 services, 28 entities, and 65 edges in `528ms` in the isolated verification run. Focused fixture test-body measurements were: polyglot `8ms`, Terraform AWS `34ms`, Kubernetes `9ms`, and golden unified infrastructure `20ms`. These are local development measurements, not hard performance guarantees.

## Verified Milestone 5 state (2026-09-25)

- Runtime: Node `24.19.0`, pnpm `11.19.0` using the path documented in root `AGENTS.md`.
- `lint`, `typecheck`, 63 tests, formatting, and production build pass.
- Tests cover the original Demo/Codex/analyzer/replay behavior plus OTLP, OpenInference, Claude fixtures, Python/FastAPI/Flask/Django analysis, relative imports, Docker/Compose, malformed input recovery, inventory-only languages, service inference, polyglot runtime reconciliation, redaction, truncation, concurrent persistence, public-bind refusal, and a 2,000-span normalization case.
- Browser verification covers the FastAPI and polyglot fixture selectors, service-level graph, language/port/route inspector detail, and compact-width access to the source picker.
- The real AgentMap repository analyzed in about `0.8s` in isolation (`3.0s` under the fully parallel test workload); the polyglot fixture analyzed in about `61ms`. These are local development measurements, not hard performance guarantees.
- The credential-free polyglot fixture emitted a completed seven-event `research-api · POST /chat` OTLP run through the loopback collector and appeared in the source selector.
- The nvm default is Node `24.19.0`; Corepack resolves pnpm `11.19.0`. Existing Node versions were retained.

Exact counts may change as the repository changes; tests should assert meaningful facts rather than incidental totals.

## Known limits

- Deep static language scope is JS/TS/JSX/TSX, Python, JSON, YAML, and Dockerfiles. Go, Java, Kotlin, Rust, Ruby, PHP, C#, Swift, C, and C++ are inventory-only.
- Import/route/URL inference is intentionally static and cannot resolve every computed value.
- Python V1 does not perform whole-program type inference, import installed packages, create environments, or install dependencies. Dynamic framework registration and computed decorators may be missed.
- Docker/Compose does not expand build-time shell logic or interpolate secret values.
- Terraform analysis does not evaluate expressions, providers, modules, count/for_each cardinality, state, `.tfvars`, or provisioners.
- Helm analysis resolves only direct safe values/common names; control flow, lookup, tpl, and arbitrary functions remain diagnostic/unresolved.
- Kubernetes analysis describes repository configuration, not live cluster state, admission, or controller-generated resources.
- AWS inference is configuration-based and does not inspect accounts, regions, ARNs, prices, or live utilization.
- Cache is process-local; rescan is explicit; no continuous repository watcher.
- Current-repository selection only; no GitHub cloning or arbitrary local-path browser input.
- Web/UI behavior has unit coverage through underlying packages plus browser verification, but no dedicated component suite yet.
- Next.js build emits a non-blocking warning that its optional ESLint plugin is not detected in the shared configuration; lint still passes.
- The receiver supports OTLP/HTTP protobuf and JSON traces, not OTLP/gRPC, metrics, or logs.
- Installed size is dominated by Next.js's optional SWC binary and TypeScript; Next server chunks keep build-machine source paths as labels (build releases from a neutral CI path).
- OTLP exporters generally send completed spans; AgentMap does not fabricate span-start events.
- Claude historical data includes observations persisted after hooks/telemetry are enabled; private transcript files are not parsed by default.

## Source-of-truth documents

- `docs/architecture/overview.md`
- `docs/architecture/milestone-3.md`
- `docs/architecture/milestone-4.md`
- `docs/architecture/milestone-5.md`
- `docs/architecture/milestone-6.md`
- `docs/architecture/runtime-adapters.md`
- `docs/architecture/opentelemetry.md`
- `docs/architecture/claude-code.md`
- `docs/architecture/privacy-redaction.md`
- `docs/architecture/repository-analyzer.md`
- `docs/architecture/python-analysis.md`
- `docs/architecture/docker-analysis.md`
- `docs/architecture/service-inference.md`
- `docs/architecture/reconciliation.md`
- `docs/architecture/infrastructure-model.md`
- `docs/architecture/terraform-analysis.md`
- `docs/architecture/kubernetes-analysis.md`
- `docs/architecture/helm-analysis.md`
- `docs/architecture/aws-inference.md`
- `docs/architecture/infrastructure-reconciliation.md`
- `docs/architecture/resource-metrics.md`
- `docs/architecture/roadmap.md`
- `docs/architecture/codex-adapter.md`

The next stage is M7.4 public-preview readiness (naming, publication, release checklist, security/privacy review, real Linux/Windows CI results). Do not publish or finalize the name before then.
