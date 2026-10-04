# Avalok project context

Avalok ("See your whole system.", https://avalok.dev) was developed under the working name AgentMap and was briefly named Sarvadrik (M7.4B release candidate, never published); documents named `milestone-*` are historical and use those names. This is concise durable context for new coding tasks. `AGENTS.md` contains mandatory rules; this file records current product state and decisions.

## Current state

- **Milestone 1:** polished architecture canvas, Map/Live/Runs, generic schemas, graph/replay engines, inspector, timeline, and deterministic demo.
- **Milestone 2:** read-only local Codex JSONL discovery, normalization, historical replay, live tailing, files/terminal/MCP/model activity, metrics, source/session selection, diagnostics, and raw/normalized event inspection.
- **Milestone 3:** local static JS/TS repository analysis, evidence/confidence, architecture inference, repository map, deterministic architecture/runtime reconciliation, and execution overlay.
- **Milestone 4:** loopback OTLP/HTTP JSON ingestion, OpenInference and conservative generic OpenTelemetry normalization, opt-in Claude Code hooks/telemetry, a shared runtime adapter contract, persisted runtime runs, live updates, trace hierarchy, privacy/size policy, and expanded reconciliation.
- **Milestone 5:** safe Python analysis, Dockerfile and Compose parsing, polyglot service discovery, service-level architecture inference, cross-language reconciliation, and a runnable TypeScript/Python/worker fixture.
- **Milestone 6:** static Terraform, Kubernetes, Helm, and AWS infrastructure intelligence; application/deployment/runtime reconciliation; hierarchy/layer views; and resource metric/cost foundations.
- **Milestone 7.1:** package-shaped `avalok` CLI, current/explicit repository targeting, one-command dashboard and OTLP startup, loopback-only defaults, readiness checks, source status, browser opening, and coordinated shutdown.
- **Milestone 7.2:** centralized capability/status reporting, a dismissible first-run/setup surface, actionable empty states, accurate OTLP/HTTP JSON guidance, a synthetic test trace, `avalok doctor`, and platform-appropriate Avalok-owned data controls.
- **Milestone 7.3:** one installable package (bundled CLI/collector/analyzers, Next.js standalone dashboard, allowlisted samples), centralized identity/version, clean-install smoke outside the monorepo, OTLP/HTTP protobuf ingestion, safe migration from `~/.agentmap/runtime`, and cross-platform hardening.
- **Milestone 7.4A:** local HTTP hardening (loopback Host on the actual port, same-loopback Origin, JSON-only mutations/hooks/test trace, no CORS), tracer-safe home paths that fix the Windows build, neutral-path release builds with a path-leak scan, and a green macOS/Linux/Windows distribution CI.
- **Milestone 7.4B:** Avalok identity (CLI `avalok`, package `avalok`, `0.1.0-alpha.1`, `AVALOK_*`), AgentMap → Avalok data migration, generated third-party notices (elkjs EPL-2.0 reviewed), Next.js telemetry disabled everywhere, release provenance and a gated release workflow, Node 24 GitHub Actions, public README/CONTRIBUTING/SECURITY/privacy docs, and a release checklist. Release candidate; not published.
- **Milestone 7.4C:** renamed Sarvadrik → **Avalok** before publication: CLI and package `avalok`, `AVALOK_*`, `.avalokignore`, Kubernetes labels `avalok.dev/cluster` and `avalok.dev/load-balancer`, homepage https://avalok.dev. No Sarvadrik aliases or data migration (never published). See `docs/architecture/milestone-7-4c.md`.
- Milestones 1-6 and M7.1-M7.4C are complete. Preserve their behavior rather than recreating it.
- **Agent observability Stage 1:** offline import of saved, paginated OpenAI Agents API trace exports through `avalok import openai`; vendor-neutral telemetry runs retain session/turn/span identity and expose pure per-node and per-edge statistics. See `docs/development/openai-trace-import.md`. No live OpenAI connection or billing integration.
- **Agent observability Stage 2 (single-user UI, M7.4C baseline):** selected telemetry runs show observed run, node, and connection statistics in Runs; selecting a map node or directed connection shows its statistics in the inspector. Ambiguous or unobserved connections have an honest empty state. Missing latency or usage is labeled unavailable, and telemetry does not show a cost estimate. Hover cards remain future work.
- **Cloud export foundation:** Runs can explicitly prepare a content-free, versioned v1 JSON snapshot, preview its exact bytes, and download it locally. The shared schema and public/private repository boundary are documented in [run export v1](architecture/run-export-v1.md). No upload or service exists in this repository.
- **Working tree after M7.4C:** a [product and release plan](PRODUCT_PLAN.md) records the free/paid boundary, first paid Solo offer, hosting/operations, and a phased ChatGPT Dots path. Local run findings now summarize observed failures, slow steps, retries and memory/retrieval activity; selected telemetry maps show node call/failure badges and connection traffic/failure cues. These changes are not part of the verified M7.4C release candidate until checks and installed-product smoke pass.

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
| `packages/local-security`             | Pure loopback Host/Origin/media-type validation for both servers     |
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
- The collector binds to `127.0.0.1:4318`, requires explicit opt-in for public binding, bounds payloads, and persists only sanitized normalized snapshots below Avalok's platform user-data `runtime/` directory.
- OTLP/OpenInference, Claude, and Codex all reach the existing vendor-neutral `Run.events`, graph, replay, and reconciliation paths.
- Generic service/HTTP/database spans remain conservative; arbitrary telemetry is not labeled as agent activity.
- Runtime deployment context follows one direct `deployed-as` edge; it is not recursively claimed on cloud/cluster/network entities.
- Distribution is one package built by `pnpm dist:build` into `packages/cli/dist` and packed by `pnpm dist:pack` into `artifacts/`. Identity lives in `packages/cli/product.json`; the only version is `packages/cli/package.json#version` (`0.1.0-alpha.N`). Everyday manifests are `private: true`; only `pnpm release:build --publishable` (release workflow) omits it, and that exact smoke-tested, checksummed tarball is what a gated publish job uploads.
- Public configuration uses the Avalok names only: `AVALOK_*` environment variables, `.avalokignore`, and the Kubernetes mapping labels `avalok.dev/cluster` and `avalok.dev/load-balancer`; there are no AgentMap aliases. AgentMap-era data (the AgentMap platform root and `~/.agentmap/runtime`) is copied once into the Avalok root and never modified.
- `THIRD_PARTY_NOTICES.md` is generated from exactly the bundled modules (esbuild metafile plus a webpack module recorder enabled by `AVALOK_MODULE_MANIFEST`) and shipped in the package.
- `apps/web/next.config.ts` forces `NEXT_TELEMETRY_DISABLED`; the packaged product makes no non-loopback connections. `next dev` still checks registry.npmjs.org for Next's version (contributors only).
- Installed assets resolve from the bundled module's location; the target is the cwd/argument; data is the platform root. The dashboard child is pinned to `127.0.0.1` and has Next telemetry disabled.
- OTLP protobuf is decoded with `protobufjs` against vendored official opentelemetry-proto definitions into the OTLP/JSON shape, then shares the JSON pipeline. OTLP/gRPC is unsupported.
- Loopback binding is not trusted on its own. Every dashboard request passes `apps/web/src/middleware.ts` and every collector request passes `guardCollectorRequest`: Host must be loopback on the actual port, a present Origin must be the same loopback server (`null` never), and mutations, Claude hooks, and the test trace require `application/json`. Missing Origin is allowed for non-browser clients. No `Access-Control-*` headers. See `docs/security/local-http.md` and `docs/security/threat-model.md`.
- Dashboard-bundled code takes `homedir()` as a parameter default so Next's file tracer never globs the build machine's home directory (Windows cross-drive failure in M7.3). Release artifacts come only from `pnpm release:build` (neutral temp path, leak scan, packaged smoke).
- The CLI defaults to `process.cwd()`, passes a canonical server-owned target to the dashboard, binds local services to `127.0.0.1`, and uses the platform Avalok user-data root unless `AVALOK_DATA_DIR` is set.

## Verified Milestone 7.4C state (2026-10-02)

- `format:check`, lint, typecheck, 303 tests, build, and `release:build` (neutral path, 0 leaks, 66/66 installed smoke) pass; tarball `avalok-0.1.0-alpha.1.tgz` 1.87 MB (165 files).
- GitHub Actions (`m7.4c-avalok` @ `64e7cda`): ubuntu 68/68, macOS 68/68, Windows 65/65 installed smoke; 303/303 unit tests on each; `ci.yml` green.
- Packaged acceptance under a fake home: version/help/doctor, Infra Platform (26 entities), test trace, OTLP JSON, standard Python protobuf exporter, Claude hook, Codex discovery (counts only, no file paths), AgentMap migration, security probe (403/415, no CORS, old `/v1/sarvadrik/test-trace` 404), zero outbound connections, Ctrl+C with ports released.

## Verified Milestone 7.4B state (2026-09-29)

- `format:check`, lint, typecheck, 293 tests, build, `dist:build`, and `dist:pack` pass; tarball `sarvadrik-0.1.0-alpha.1.tgz` ≈1.87 MB (165 files).
- GitHub Actions (`m7.4b-sarvadrik-rc` @ `40f1780`): ubuntu 66/66, macOS 66/66, Windows 63/63 installed smoke; 293/293 unit tests on each; `ci.yml` green; no Node 20 deprecation warnings.
- Packaged acceptance (neutral directory with spaces): version/help/doctor, Infra Platform (26 entities, Terraform/Kubernetes/Helm/AWS), polyglot sample, test trace, OTLP JSON and protobuf, standard Python exporter, Claude hook, Codex discovery (128 sessions, counts only), migration of a copy of real AgentMap data, security probe, zero outbound connections, clean Ctrl+C.
- Details: `docs/architecture/milestone-7-4b.md`, `docs/releases/developer-preview.md`.

## Verified Milestone 7.4A state (2026-09-28)

- `format:check`, lint, typecheck, 289 tests, the production build, `dist:build`, and `dist:pack` pass (1.85 MB tarball; 353 MB installed).
- Installed smoke: 60/60 locally on macOS (hidden workspace, Python exporter) and via `pnpm release:build`, with zero home/username/checkout path leaks.
- GitHub Actions actually ran (`m7.4a-local-security` @ `fab80b8`): ubuntu 60/60, macOS 60/60, Windows 57/57, 289/289 unit tests on each, `ci.yml` green.
- Packaged manual checks: foreign Host → 403, foreign/`null` Origin mutations → 403, `text/plain` Claude hook → 415, legitimate UI/Claude/OTLP JSON+protobuf/Python exporter → 200; Ctrl+C in ≈80 ms with ports released.
- Details: `docs/architecture/milestone-7-4a.md`, `docs/development/{distribution-ci,release-build}.md`.

## Verified Milestone 7.3 state (2026-09-27)

- `format:check`, lint, typecheck, 148 tests, and the production build pass (baseline before M7.3: 105 tests).
- `pnpm dist:build && pnpm dist:pack` produces a ≈1.8 MB tarball (≈6.8 MB unpacked, ≈360 MB installed with Next/TypeScript dependencies).
- `pnpm dist:smoke --hide-workspace --python <venv python>` passed 43/43 on macOS arm64 with the checkout renamed away: JS/TS, Python, polyglot, infrastructure, and Unicode/spaced paths; dashboard assets; samples; test trace; OTLP JSON and protobuf; the standard Python exporter; restart persistence; Ctrl+C (≈50 ms) and force-kill orphan cleanup; safe data clearing.
- Linux/Windows logic had unit coverage only (the matrix's first Windows run failed; fixed and green in M7.4A).
- Details: `docs/architecture/milestone-7-3.md` and `docs/development/{distribution,clean-install-test,otlp-protobuf,data-migration,platform-support,upgrading}.md`.

## Verified Milestone 7.1 state (2026-09-26)

- The local product command is `pnpm avalok [path]`; help, version, `--no-open`, `--port`, and `--otlp-port` are supported.
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
- The real Avalok repository analyzed 240 files (176 parsed), 25 services, 28 entities, and 65 edges in `528ms` in the isolated verification run. Focused fixture test-body measurements were: polyglot `8ms`, Terraform AWS `34ms`, Kubernetes `9ms`, and golden unified infrastructure `20ms`. These are local development measurements, not hard performance guarantees.

## Verified Milestone 5 state (2026-09-25)

- Runtime: Node `24.19.0`, pnpm `11.19.0` using the path documented in root `AGENTS.md`.
- `lint`, `typecheck`, 63 tests, formatting, and production build pass.
- Tests cover the original Demo/Codex/analyzer/replay behavior plus OTLP, OpenInference, Claude fixtures, Python/FastAPI/Flask/Django analysis, relative imports, Docker/Compose, malformed input recovery, inventory-only languages, service inference, polyglot runtime reconciliation, redaction, truncation, concurrent persistence, public-bind refusal, and a 2,000-span normalization case.
- Browser verification covers the FastAPI and polyglot fixture selectors, service-level graph, language/port/route inspector detail, and compact-width access to the source picker.
- The real Avalok repository analyzed in about `0.8s` in isolation (`3.0s` under the fully parallel test workload); the polyglot fixture analyzed in about `61ms`. These are local development measurements, not hard performance guarantees.
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
- Installed size (≈353 MB) is dominated by Next.js, its optional SWC binary, and TypeScript. Next server output keeps the build path as labels, so only neutral-path `release:build` artifacts are releasable.
- Release builds are not byte-for-byte reproducible across machines (Next.js embeds the random neutral build path as labels); publication relies on the single CI-built tarball's checksum and provenance record.
- OTLP exporters generally send completed spans; Avalok does not fabricate span-start events.
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
- `docs/architecture/milestone-7-4a.md`
- `docs/architecture/milestone-7-4b.md`
- `docs/releases/developer-preview.md`
- `docs/privacy.md`
- `docs/development/third-party-notices.md`
- `docs/security/local-http.md`
- `docs/security/threat-model.md`

The next stage is publication of the developer preview, which requires explicit maintainer approval: follow `docs/releases/developer-preview.md` (repository identity, npm account and environment, private vulnerability reporting, merge, tag, release workflow). Never publish without that approval.
