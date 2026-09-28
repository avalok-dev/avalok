# Clean-install test

The packed artifact must run with no AgentMap checkout, no workspace links, no pnpm, and no development server.

## Automated

```sh
pnpm dist:build && pnpm dist:pack
pnpm dist:smoke --hide-workspace
# optional real Python exporter step:
pnpm dist:smoke --hide-workspace --python /path/to/venv/bin/python
```

The smoke test (`packages/cli/scripts/smoke-installed.mjs`):

1. Creates a fresh OS temp directory whose install path and repository paths contain spaces, plus a Unicode repository name.
2. Copies external fixtures there **before** anything else: a simple JS/TS app, the FastAPI Python fixture, the polyglot fixture, and the M6 infrastructure fixture.
3. With `--hide-workspace`, renames the AgentMap checkout to `<checkout>.hidden-by-agentmap-smoke` for the rest of the run and restores it in `finally`.
4. Runs `npm install ./<tarball>.tgz` with `NODE_PATH` cleared — no `link`, no `workspace:` protocol.
5. Asserts the install is a real directory (not a symlink), the bin shim exists, and no `node_modules` shipped inside the package.
6. Runs `--version`, `--help`, `data path`, and `doctor` on every fixture.
7. Starts the installed CLI (with a hostile `HOSTNAME=0.0.0.0`) and checks: dashboard HTML and a hashed static asset, target analysis, all packaged samples, rejection of unknown sample names, the capability report version and protocol, Send Test Trace, OTLP JSON, OTLP protobuf, optional Python exporter, 415 for unsupported types, and runs visible to the dashboard.
8. Ctrl+C (SIGINT) → exit 0 and both ports released; restart → runs persisted; second shutdown clean.
8a. **Local HTTP security** (17 checks against the installed production servers): foreign/rebound `Host` on dashboard APIs, Codex reads, runtime runs, and the HTML page → `403`; `localhost` Host → `200`; settings with a foreign or `null` Origin → `403`, `text/plain` → `415`, the dashboard's own Origin → `200`; the test-trace proxy with a foreign Origin → `403`; collector/OTLP foreign Host → `403`; Claude hook `text/plain` → `415`, foreign Origin → `403`, real Claude Code shape → `200`; bodiless test trace → `415`, foreign Origin → `403`.
9. Force-kills the CLI → the dashboard watchdog exits and both ports are released (no orphan).
10. `data clear --yes` → AgentMap runs removed; a sentinel outside the data root and the target repository are untouched.

## Verified results

- M7.3 (2026-09-27), macOS arm64: 43/43 with `--hide-workspace --python`.
- M7.4A (2026-09-28), macOS 26.x arm64, Node 24.19.0: **60/60** with `--hide-workspace --python` (Python 3.14.6, opentelemetry-exporter-otlp-proto-http 1.45.0), both in place and from the neutral-path release build (`pnpm release:build`). CI results per OS: [distribution CI](distribution-ci.md).

## How monorepo independence is proven

- The install directory is outside the checkout and dependencies come only from the npm registry plus the tarball.
- During the run, the checkout path does not exist (renamed), so any runtime reference to it would fail; all checks still pass.
- `NODE_PATH` is cleared; `AGENTMAP_DASHBOARD_DIR`/`AGENTMAP_SAMPLES_DIR` are removed from the environment.
- `dist:build` statically rejects workspace protocol use, runtime loads from the checkout, internal package requires, and symlinks.

## Manual equivalent

```sh
pnpm dist:build && pnpm dist:pack
mkdir -p "/tmp/AgentMap Clean Install" && cd "/tmp/AgentMap Clean Install"
npm init -y
npm install /path/to/checkout/artifacts/visual-system-agentmap-0.1.0-alpha.0.tgz
npx agentmap --version
npx agentmap doctor /path/to/some/repository
cd /path/to/some/repository && npx --prefix "/tmp/AgentMap Clean Install" agentmap .
```

Windows and Linux runs are defined in `.github/workflows/distribution.yml` (Windows skips `--hide-workspace` because open files lock the checkout). They have not been run as part of M7.3; see `platform-support.md`.
