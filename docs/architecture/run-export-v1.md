# Local run export contract (v1)

Avalok's Runs view has an explicit **Prepare export** action. It freezes the selected run into a JSON preview; **Download reviewed JSON** saves those exact bytes locally. The action makes no HTTP request, requires no account, and works offline. There is no automatic cloud upload or background export.

The public `@visual-system/schema` package owns `RunExportV1Schema` and `prepareRunExportV1`. The payload has `format: "avalok.run-export"` and `version: 1`. Consumers must validate both, reject unknown fields, and handle future versions explicitly. The v1 schema is strict at every object level.

| Field      | Meaning                                                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`   | One of `demo`, `codex`, `claude`, or `telemetry`; a repository overlay uses its underlying runtime source.                                                                                                                                                                                      |
| `run`      | Status, total duration, nullable input/output token counts, tool call count, and model call count. Null means unavailable.                                                                                                                                                                      |
| `entities` | Only entities referenced by exported events, assigned fresh positive integer IDs in first-seen order; each carries only a schema-defined kind.                                                                                                                                                  |
| `events`   | Ordered, one-based sequence and trace numbers; relative timestamp and optional duration in milliseconds; schema-defined category; optional numbered source/target entity references; `failed` and `retryObserved` booleans. Trace numbers preserve grouping without exporting source trace IDs. |

The serializer constructs each field from an allowlist. It does not copy run ID, title, prompt, absolute start time, estimated cost, raw events, actions, span IDs, original trace/entity IDs, entity names, edges, paths, source locations, or arbitrary metadata. The only metadata-derived values are the exact booleans for failure (`status === "error"`) and observed retry (`retryObserved === true`). Unknown event entity references are omitted. The local run remains intact for normal offline use.

Timing, counts, source type, event categories, failure patterns, topology, and entity kinds can still be sensitive. Users should inspect the full preview before sharing the downloaded file. This is a conservative default export, not a guarantee that the remaining behavioral data is anonymous.

## Repository boundary

This Apache-2.0 repository owns the local UI, offline run preparation, redaction by allowlist, the versioned schema, and tests. It contains no Avalok Cloud credentials, endpoint, service, account, entitlement, billing, or upload client. Local usage never depends on a cloud service.

A future private `avalok-cloud` repository may import this public contract to implement authenticated ingestion and storage. Its first ingestion route should accept only `avalok.run-export` v1, validate the strict schema and referential/sequence integrity, enforce request and tenant quotas, repeat server-side content policy checks, and test tenant isolation and deletion before accepting any real run. A user-authorized upload flow would be separate work; downloading this file does not authorize sending it anywhere.

## Package distribution boundary

The existing package name `@visual-system/schema` is retained because public Avalok workspace consumers and the private service already import it. The first packed distribution candidate is `0.2.0-alpha.1`; it is **not published**. Package versions follow SemVer independently of the payload's `version: 1`. A package update must not silently reinterpret v1; a future wire format needs an explicit new payload version and validator while v1 remains available for existing exports.

The package builds ESM JavaScript and TypeScript declarations into `dist/`. Its exports point only to those compiled files. A packed artifact contains the compiled files, package manifest, README, and Apache-2.0 license, without TypeScript source or tests. `pnpm schema:smoke` packs it and verifies runtime and type imports in a fresh temporary consumer outside this monorepo. Local Avalok still prepares and downloads exports offline.

Release order: (1) review the strict contract and run the public repository checks plus packed-install smoke; (2) confirm ownership of the `@visual-system` npm scope and obtain maintainer approval for a schema publication path in the protected `.github/workflows/release.yml` workflow; (3) have that workflow create a publishable copy with only `private: true` removed, smoke-test and checksum **that exact artifact**, then publish it under an approved prerelease tag; (4) replace the private service's local link with an **exact** published version, update its lockfile, and rerun its typecheck and PostgreSQL integration suite against the registry artifact; (5) only then consider managed staging. The checked-in schema manifest and current local tarball remain `private: true`. No package publication is part of this milestone.
