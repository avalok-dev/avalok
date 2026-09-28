# Milestone 7.4A — local security hardening and cross-platform release verification

M7.4A closes the local HTTP security findings from M7.3, proves the packaged product on real Linux, Windows, and macOS runners, and makes release builds independent of the build machine. Nothing was published; the name and package identity remain provisional (`@visual-system/agentmap`, private).

## Baseline (before changes, 2026-09-27)

| Item                | Value                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node / pnpm         | 24.19.0 / 11.19.0; package `0.1.0-alpha.0`                                                                                                                                 |
| Format/lint/types   | pass                                                                                                                                                                       |
| Tests               | 148 passing                                                                                                                                                                |
| Build / dist / pack | pass; tarball 1.82 MB, 6.88 MB unpacked, 162 files                                                                                                                         |
| Known warnings      | Next "ESLint plugin not detected" (pre-existing); GitHub Actions Node 20 deprecation notice                                                                                |
| CI                  | `ci.yml` green. `distribution.yml` had already run on the M7.3 push: macOS and Linux green, **Windows red** (`next build` EPERM), contrary to the M7.3 docs' "not yet run" |

## Reproduced (packaged build, `probe` against 127.0.0.1:14737/14318)

Every M7.3 finding reproduced, plus two more:

| Request                                                                                                 | Before | After     |
| ------------------------------------------------------------------------------------------------------- | ------ | --------- |
| `Host: attacker.example` / `localhost.attacker.example` → `/api/repository`, `/api/codex/sessions`, `/` | 200    | 403       |
| Foreign or `null` Origin `POST /api/settings` (JSON or `text/plain`)                                    | 200    | 403       |
| Foreign Origin `POST /api/telemetry/test` (dashboard proxies a synthetic trace)                         | 200    | 403       |
| `text/plain` Claude hook, with or without foreign Origin                                                | 200    | 415 / 403 |
| Bodiless or form `POST /v1/agentmap/test-trace` from a foreign Origin                                   | 200    | 403 / 415 |
| Foreign Host → collector `/health`, `/v1/traces`                                                        | 200    | 403       |
| OTLP `text/plain`                                                                                       | 415    | 415       |
| Any `Access-Control-*` response header                                                                  | none   | none      |

The two extra findings: the settings route accepted `text/plain` (a CSRF-able write), and the dashboard's test-trace route acted as a cross-origin proxy into the collector.

## What changed

- **`@visual-system/local-security`** (new, pure): `parseHostHeader`, `parseOrigin`, `isAllowedLoopbackHost`, `isAllowedLoopbackOrigin`, `isJsonMediaType`, plus shared rejection results. 64 tests.
- **Dashboard:** `src/middleware.ts` (matcher `/:path*`) → `guardDashboardRequest`. It checks that Host is loopback on the actual port (`AGENTMAP_DASHBOARD_PORT`, which the CLI now sets, or `PORT`), that any Origin is the same loopback server and never `null`, and that `/api` mutations are JSON. `POST /api/settings` streams at most 16 KiB. The UI test-trace call and the server-side proxy now send JSON. `pnpm dev` binds `127.0.0.1`.
- **Collector:** `guardCollectorRequest` runs before routing and checks Host against `socket.localPort`. Claude hooks and the test trace reject any Origin and require `application/json` (the test trace body is ≤ 16 KiB). OTLP rejects only non-loopback or `null` Origins and never requires one; JSON and protobuf behavior is unchanged. `maxHookBodyBytes` option added (default 5 MiB).
- **Windows/neutral builds:** home-directory paths are kept opaque to Next's file tracer, fixing the Windows build and preventing private files from being traced. Added `.gitattributes`, Windows-safe `import()` and `npm pack` invocations, and `pnpm release:build` (neutral path, leak scan, smoke).
- **Redaction:** added secret/AWS secret access keys, private keys, credentials, `passwd`, and `passphrase` to the key list.
- **CI:** the distribution matrix runs unit tests and the neutral release build on all three OSes; `ci.yml` adds `format:check`.

Design and rules: [local HTTP security](../security/local-http.md), [threat model](../security/threat-model.md), [release build](../development/release-build.md), [distribution CI](../development/distribution-ci.md).

## Decisions

- **Centralized, not per-route.** One middleware and one collector guard. New routes are covered by default.
- **Missing Origin allowed; `null` rejected.** Browsers always send Origin on POST; non-browser local clients (CLI, OTLP exporters, Claude Code) do not. Local processes are outside the threat model, so requiring Origin would only break them.
- **Claude hooks: `application/json` only.** Claude Code's hooks reference states that HTTP hooks POST the JSON input with `Content-Type: application/json`, and every existing fixture and doc agrees.
- **Claude hooks and test trace reject even loopback Origins.** Their only legitimate callers never send Origin.
- **Port-exact Host.** DNS rebinding is stopped by the hostname allowlist alone; matching the port also rejects wrong-port and implicit-`:80` Hosts. The collector uses the socket's port, and the dashboard uses the port the CLI or Next reports. If that port is unknown, only the hostname is checked, and Origin is compared to the Host's port.
- **403 for Host/Origin, 415 for media type.** Generic messages with no paths or data, and no CORS headers.
- **Neutral-path release builds instead of rewriting Next's path labels.** Rewriting client-reference manifest keys risks runtime breakage; a neutral path removes the privacy problem.
- **Install size unchanged** (353 MB installed). Correctness and security came first; trimming is recorded for later.
- **No authentication/token** for local clients (explicitly out of scope; it would not stop same-user processes).

## Verification (final)

| Gate                                      | Result                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| format / lint / typecheck                 | pass                                                                                                                                                 |
| Tests                                     | **289** passing across 14 packages (baseline 148)                                                                                                    |
| `pnpm build`                              | pass (middleware 33.8 kB)                                                                                                                            |
| `dist:build` / `dist:pack`                | pass; 1.85 MB tarball, 6.98 MB unpacked, 164 files                                                                                                   |
| Installed smoke (macOS, local)            | 60/60 with hidden workspace and Python exporter, in place and via `release:build`                                                                    |
| Neutral-path release build (macOS, local) | pass: 0 home/username/checkout leaks in 134 text files                                                                                               |
| Development server                        | foreign Host/Origin/content-type rejected; UI repository, capabilities, settings, test trace, and Codex session stream work; no console errors       |
| Packaged manual checks                    | all 17 commands below return the expected status; only two loopback listeners, no outbound sockets; Ctrl+C exits in 81 ms, ports released, no orphan |
| CI (actually run, `fab80b8`)              | ubuntu 60/60, macOS 60/60, Windows 57/57; 289/289 unit tests on each; `ci.yml` green                                                                 |

## Manual verification

Build and install the release artifact in a neutral location, then start it against any repository:

```sh
pnpm install --frozen-lockfile
pnpm release:build
mkdir -p "/tmp/AgentMap Manual/install" && cd "/tmp/AgentMap Manual/install"
npm init -y >/dev/null && npm install <checkout>/artifacts/release/visual-system-agentmap-0.1.0-alpha.0.tgz
cd <external repository> && "/tmp/AgentMap Manual/install/node_modules/.bin/agentmap" --no-open
```

From another terminal (in the checkout, for the protobuf fixture and Python example):

| #   | Command                                                                                                                                                                                                          | Expected                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4737/`                                                                                                                                                | 200                              |
| 2   | `curl -i -H 'Host: attacker.example:4737' http://127.0.0.1:4737/api/repository`                                                                                                                                  | 403                              |
| 3   | `curl -i -H 'Host: attacker.example:4737' http://127.0.0.1:4737/api/codex/sessions/00000000-0000-0000-0000-000000000000`                                                                                         | 403                              |
| 4   | `curl -i -X POST -H 'Origin: http://127.0.0.1:4737' -H 'Content-Type: application/json' -d '{"gettingStartedDismissed":false}' http://127.0.0.1:4737/api/settings`                                               | 200                              |
| 5   | `curl -i -X POST -H 'Origin: https://attacker.example' -H 'Content-Type: application/json' -d '{"gettingStartedDismissed":true}' http://127.0.0.1:4737/api/settings`                                             | 403                              |
| 6   | `curl -i -X POST -H 'Content-Type: application/json' -d '{"hook_event_name":"UserPromptSubmit","session_id":"manual-check","cwd":"/tmp","prompt":"hello"}' http://127.0.0.1:4318/v1/claude/hooks`                | 200                              |
| 7   | `curl -i -X POST -H 'Content-Type: text/plain' -d '{"hook_event_name":"UserPromptSubmit","session_id":"forged","prompt":"x"}' http://127.0.0.1:4318/v1/claude/hooks`                                             | 415                              |
| 8   | `curl -i -X POST -H 'Origin: https://attacker.example' -H 'Content-Type: application/json' -d '{"hook_event_name":"UserPromptSubmit","session_id":"forged","prompt":"x"}' http://127.0.0.1:4318/v1/claude/hooks` | 403                              |
| 9   | `curl -i -H 'Host: attacker.example:4318' http://127.0.0.1:4318/health`                                                                                                                                          | 403                              |
| 10a | `curl -i -X POST -H 'Origin: http://127.0.0.1:4737' -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:4737/api/telemetry/test` (what the UI sends)                                                    | 200                              |
| 10b | `curl -i -X POST -H 'Origin: https://attacker.example' http://127.0.0.1:4318/v1/agentmap/test-trace`                                                                                                             | 403                              |
| 10c | `curl -i -X POST http://127.0.0.1:4318/v1/agentmap/test-trace` (bodiless simple POST)                                                                                                                            | 415                              |
| 11  | `curl -i -X POST -H 'Content-Type: application/json' -d '{"resourceSpans":[]}' http://127.0.0.1:4318/v1/traces`                                                                                                  | 200                              |
| 12  | `curl -i -X POST -H 'Content-Type: application/x-protobuf' --data-binary @packages/telemetry-adapter/tests/fixtures/openinference-trace.otlp.pb http://127.0.0.1:4318/v1/traces`                                 | 200                              |
| 13  | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces python examples/python-otel-direct/app.py` (venv with `examples/python-otel-direct/requirements.txt`)                                        | `SUCCESS`                        |
| 14  | `agentmap doctor <repository>`                                                                                                                                                                                   | `Ready`; Security: loopback-only |
| 18  | Ctrl+C in the AgentMap terminal, then `lsof -nP -iTCP:4737 -iTCP:4318 -sTCP:LISTEN`                                                                                                                              | "AgentMap stopped."; no output   |

Claude hook note for #7: Claude Code itself always sends `application/json`, so `text/plain` has no legitimate sender, and the browser attack it would enable is exactly what the 415 blocks.

## Remaining blockers (for M7.4B)

1. **Third-party notices:** the package ships no third-party license texts beyond esbuild's `LEGAL.txt` extract. Bundled MIT/ISC/BSD code (React client bundle, `@xyflow/react`, `zustand`, `lucide-react`, `protobufjs`, `zod`, `yaml`, `@lezer/*`, `smol-toml`, and others) requires notices. **`elkjs` (EPL-2.0) is compiled into the dashboard** and needs an explicit legal decision (EPL notice and source-availability statement, or replacement). No NOTICE file exists (not required by Apache-2.0 unless notices exist). The project LICENSE is Apache-2.0 and is packed.
2. **Final name / package identity / npm scope / GitHub org / domain**, which are still provisional.
3. Publication flow: artifacts must come from CI `release:build` (never an in-place build); the package is still `private: true`.
4. Contributor-mode Next telemetry: `pnpm dev`/`pnpm build` use Next defaults (anonymous Next.js telemetry) unless `NEXT_TELEMETRY_DISABLED=1`. The packaged product and packaging build disable it. Document or disable it for contributors.
5. Housekeeping: GitHub Actions Node 20 deprecation (bump action majors), the Ubuntu 26 runner migration, and install size (353 MB, Next SWC binary).
