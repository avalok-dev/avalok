# Milestone 2: local Codex session ingestion

> **Historical record.** Written while the product's working name was AgentMap; the product is now **Sarvadrik** (CLI `sarvadrik`, environment variables `SARVADRIK_*`). Commands and names below are as they were at the time.

Milestone 2 adds a real, read-only runtime source without changing the Milestone 1 schema-first architecture. The demo fixture remains available. A user can switch to a discovered local Codex JSONL session, replay its history, inspect normalized and underlying records, and continue following appended records live.

## Boundaries

- `packages/codex-adapter` owns discovery, JSONL parsing, Codex-specific interpretation, normalization, stable IDs, and diagnostics.
- `packages/schema` remains vendor-neutral. Token and cost fields can be `null`, explicitly meaning that a source did not provide a reliable value.
- `packages/graph`, `packages/replay`, and `packages/ui` do not parse Codex records.
- `apps/web` exposes server-only local API routes and connects normalized datasets to the existing graph and replay surfaces.
- No repository scanner, static source analysis, or architecture/runtime reconciliation logic was added. Those remain Milestone 3 work.

## Data flow

1. The server recursively discovers regular `.jsonl` files below `$CODEX_HOME/sessions`, falling back to `~/.codex/sessions`.
2. Session metadata comes from the initial `session_meta` record. The browser selects sessions by adapter-issued ID, not an arbitrary path.
3. The loader parses newline-delimited records tolerantly. Malformed and unsupported records become diagnostics rather than terminating the session.
4. The Codex adapter maps observable records to `Run`, `RuntimeEvent`, `Entity`, `GraphEdge`, and `ArchitectureGraph`.
5. The browser receives normalized data and bounded raw-record excerpts. Filesystem paths used to open sessions stay server-side.
6. The live route performs one initial read, keeps a byte cursor and partial-line buffer, then uses filesystem notifications to read only appended bytes.
7. Incoming events are upserted by stable ID. If the user scrubbed backward, updates continue accumulating without moving the playhead; **Jump to live** resumes following.

## Dynamic execution graph

The graph starts with `User → Codex` and adds nodes only when corresponding observable activity exists:

- model responses create a Model node;
- shell commands create a Terminal node;
- recognized test commands create a Tests node;
- file-change records create one grouped Files node;
- MCP calls create one node per observed MCP server.

Entity and edge IDs are deterministic (`codex`, `files`, `mcp:<server>`, and `edge:<source>:<target>`), so repeated records update state instead of duplicating nodes. Large file sets remain grouped and individual paths stay in event metadata.

## Reliability and privacy

- The adapter imports read-only filesystem APIs only. It never writes session data and makes no network requests.
- Raw values are depth-, collection-, and string-bounded before crossing the local API boundary.
- Chain-of-thought content is not normalized. Reasoning records are deliberately ignored.
- Unknown cost is rendered as **Unavailable**, not `$0.000`.
- Commands, exit codes, durations, tool status, file paths, MCP arguments, response IDs, and token totals are shown only when present in the log.

## Verification scope

Automated coverage includes discovery, malformed and unsupported input, normalization, deterministic IDs and deduplication, commands, file changes, errors, MCP calls, token usage, partial lines, incremental cursors, and read-only/no-network behavior. The web application is also exercised against the demo source, a real historical session, a live stream, malformed fixture behavior, and a large real session.
