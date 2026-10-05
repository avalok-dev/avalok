# Milestone 7.1: CLI and one-command local startup

> **Historical record.** Written while the product's working name was AgentMap (later Sarvadrik); the product is now **Avalok** (CLI `avalok`, environment variables `AVALOK_*`). Commands and names below are as they were at the time.

## Outcome

The `@visual-system/cli` workspace package owns the `agentmap` executable and presents AgentMap as one local command. During source development, run it from the workspace root:

```bash
pnpm agentmap [path]
```

The package also declares a real `agentmap` bin. M7.3 will turn that package into a packed, installable artifact; M7.1 does not publish it.

## Architecture and startup order

The CLI keeps the existing process boundaries:

1. Parse the minimal command surface and resolve the requested repository. With no path, the target is `process.cwd()`; explicit relative and absolute directories are supported.
2. Canonicalize and validate the target, reject files, unreadable/missing paths, and the filesystem root, then run the existing bounded static analyzer as a startup preflight.
3. Select an available dashboard port. The preferred port is `4737`; occupied dashboard ports fall forward through a small bounded local range.
4. Start the existing collector in the CLI process on the exact requested OTLP port. The default is `4318`; a conflict is an actionable error because silently moving a configured exporter would be surprising.
5. Start the existing Next.js dashboard as a managed child process, pass the validated target and runtime-data directory through the child environment, and poll `/api/health` until it is ready. No fixed startup sleep is used.
6. Reuse Codex session discovery and the runtime snapshot store to report Codex and observed Claude Code availability. Discovery failure is a warning, not a startup failure.
7. Print the repository, actual detected technologies, source status, dashboard URL, OTLP endpoint, and local-only status. Open the dashboard only after readiness unless `--no-open` was supplied.
8. On `SIGINT` or `SIGTERM`, stop the dashboard and collector. A bounded termination fallback prevents an unresponsive managed child from becoming an orphan.

The dashboard automatically selects and analyzes the CLI target on first load. The browser still cannot submit an arbitrary filesystem path: `/api/repository` chooses only the server-provided target or the existing allowlisted fixtures.

## Identity and version

`packages/cli/src/identity.ts` is the small product-identity boundary for the display name, CLI name, data-directory name, and package-sourced version. The development version is owned by `packages/cli/package.json`; command help and startup output do not duplicate it.

## Ports and binding

| Service                  | Default | Conflict behavior                              | Bind        |
| ------------------------ | ------: | ---------------------------------------------- | ----------- |
| Dashboard                |  `4737` | Try the next available port in a bounded range | `127.0.0.1` |
| OTLP/HTTP + Claude hooks |  `4318` | Stop with a concise `--otlp-port` remedy       | `127.0.0.1` |

The CLI does not expose a public-bind flag. Existing collector protection against accidental non-loopback binding remains intact. The dashboard is passed Next.js's explicit loopback host option. Browser-open failure does not stop either service.

## Repository safety

The CLI resolves the target to a canonical directory before analysis. The analyzer continues to enforce its Milestone 3-6 rules: no target-code execution, dependency installation, network access, symlink traversal, secret-value reads, Terraform/provider execution, or writes to the target.

The server receives the canonical target only from the CLI environment. Query parameters cannot replace it. Existing fixture selection stays allowlisted against the AgentMap source tree.

## Source discovery

- **Repository architecture:** the startup preflight reports real analyzer technologies; the dashboard performs its own process-local scan and displays the result automatically.
- **Codex:** existing read-only JSONL discovery reports whether local sessions exist. Absence is normal.
- **Claude Code:** existing persisted Claude observations are counted. AgentMap does not parse private Claude transcripts or invent installation status.
- **OTLP:** readiness is independent and reported after the collector has successfully bound its listener.

No new runtime adapter is introduced.

## Local data

M7.1 originally used the provisional `~/.agentmap/runtime` CLI location. M7.2 supersedes that provisional choice with a platform-appropriate AgentMap user-data root for CLI and contributor collector runs; see `docs/development/local-data.md`. `AGENTMAP_DATA_DIR` now overrides that owned root.

## Development and errors

`pnpm dev` still starts the contributor dashboard on port `3000` and collector on `4318`. `pnpm agentmap` is the product execution path. Expected failures use a short Reason/Try format; dashboard child logs are bounded and quiet by default. `AGENTMAP_DEBUG=1` exposes child output for development diagnostics.

## Remaining M7.3 packaging blockers

- The package is private and intentionally unpublished.
- The source-development launcher uses the small `tsx` runtime because reusable workspace packages currently export TypeScript source.
- Dashboard location defaults to the source-workspace-relative `apps/web` directory, with `AGENTMAP_DASHBOARD_DIR` as an override.
- A distributable package still needs compiled/bundled CLI code, included standalone dashboard/static assets, production package metadata, a packed-artifact test, and clean-machine verification.
- Final public name, npm scope/name, release versioning, and upgrade policy remain undecided.

These are distribution tasks, not reasons to broaden M7.1 into M7.3.
