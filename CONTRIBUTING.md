# Contributing to Avalok

Thanks for your interest. Avalok is an early developer preview, so small, focused changes with tests are the easiest to review.

## Setup

- Node.js **24.19 or newer in the Node 24 line** (`.node-version` pins `24.19.0`)
- pnpm **11.19.0** (`corepack enable` picks it up from `package.json#packageManager`)

```sh
pnpm install --frozen-lockfile
pnpm dev          # dashboard http://localhost:3000, OTLP receiver http://127.0.0.1:4318
```

Run the CLI from source against any repository:

```sh
pnpm avalok /path/to/repository
```

## Checks

Run these before opening a pull request (CI runs the same):

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If you change the CLI, dashboard routes, collector, or anything the installed package loads, also run the packaged-product test:

```sh
pnpm release:build            # neutral-path build, pack, path-leak scan, clean-install smoke test
```

Pass `--python /path/to/python` to include the standard OpenTelemetry Python exporter step (install `examples/python-otel-direct/requirements.txt` into that environment first).

## Where things live

| Area                         | Responsibility                                                           |
| ---------------------------- | ------------------------------------------------------------------------ |
| `apps/web`                   | Next.js dashboard and local API routes                                   |
| `apps/collector`             | Loopback OTLP/HTTP (protobuf + JSON) and Claude Code hook receiver       |
| `packages/cli`               | `avalok` CLI, lifecycle, product identity, distribution scripts          |
| `packages/analyzer`          | Static repository analysis (JS/TS, Python, Docker, Terraform, K8s, Helm) |
| `packages/reconcile`         | Runtime-to-architecture matching and the unified graph                   |
| `packages/schema`            | Vendor-neutral architecture/runtime schemas                              |
| `packages/graph`, `replay`   | Graph indexing/layout and the replay engine                              |
| `packages/ui`                | Reusable React canvas, inspector, and timeline                           |
| `packages/codex-adapter`     | Read-only Codex session discovery and normalization                      |
| `packages/claude-adapter`    | Claude Code hook normalization                                           |
| `packages/telemetry-adapter` | OTLP decoding, normalization, local persistence                          |
| `packages/runtime-adapter`   | Runtime source contract and privacy/redaction policy                     |
| `packages/capabilities`      | Capability reporting, local data paths, migration                        |
| `packages/local-security`    | Loopback Host/Origin/content-type validation                             |
| `examples/`                  | Runnable fixtures used by tests and the dashboard's sample sources       |

Internal workspace packages use the `@visual-system/*` scope; they are bundled into the single published `avalok` package and are never published individually.

Architecture documents live in [`docs/architecture`](docs/architecture) (start with [`overview.md`](docs/architecture/overview.md)); development guides in [`docs/development`](docs/development); security in [`docs/security`](docs/security).

## Ground rules

- **Static analysis never executes target code.** Parse files as data; never import, run, build, or install anything from an analyzed repository, never read secret values, and make no network requests while analyzing.
- **No repository-specific rules.** Add reusable detectors with fixture coverage in `packages/analyzer/tests/fixtures`.
- **Say what is known.** Product language is "detected", "observed", "inferred", "evidence", and "confidence"; unmatched runtime activity stays visible rather than being forced into a match.
- **Local-first.** No analytics, remote services, accounts, or telemetry about Avalok itself. Local HTTP routes go through the shared Host/Origin guards; new mutation routes accept JSON only ([local HTTP security](docs/security/local-http.md)).
- **Keep React out of data packages.** `schema`, `graph`, `replay`, `analyzer`, `reconcile`, and adapters must not depend on React.
- Add or update focused tests for behavior changes.

## Finding something to work on

Look for the `good first issue` and `help wanted` labels. The label set is listed in [`.github/labels.yml`](.github/labels.yml): `adapter` (a new agent or telemetry source), `analyzer` (a language or infrastructure format), `export` (recap card, replay, diagram, Markdown), `docs`, and `privacy` (anything that changes what is read, stored or shown; it needs a leak test). The [roadmap](ROADMAP.md) lists what is planned and what is not.

New agent sources (Kiro, Cursor, others) are added in two places: a normalizer under `packages/*-adapter` and a `SessionSource` in `packages/cli/src/session-source.ts`. Capture real payloads before writing a normalizer; do not guess formats.

## Pull requests

Describe what changed and why, how you tested it, and any user-visible effect. Keep unrelated refactors out of the same pull request.

## Sign-off

Please sign off your commits (`git commit -s`), which adds a `Signed-off-by:` line certifying the [Developer Certificate of Origin](https://developercertificate.org/): you wrote the change or have the right to submit it under this project's Apache-2.0 license. This is requested, not yet enforced by CI. _Maintainer: confirm or remove this policy before the repository goes public._

## Security

Please do not open public issues for vulnerabilities; see [SECURITY.md](SECURITY.md).
