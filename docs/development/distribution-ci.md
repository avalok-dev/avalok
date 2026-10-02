# Distribution CI

Two workflows run on every push and pull request. Nothing is published by either.

| Workflow           | Runner                                            | Steps                                                                                                          |
| ------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ci.yml`           | `ubuntu-latest`                                   | frozen install → `format:check` → `lint` → `typecheck` → `test` → `build`                                      |
| `distribution.yml` | `ubuntu-latest`, `macos-latest`, `windows-latest` | frozen install → standard Python OTel exporter → `pnpm test --continue` → `pnpm release:build --python python` |
| `release.yml`      | `ubuntu-latest` (manual `workflow_dispatch`)      | full checks → `pnpm release:build --publishable` → provenance gate → artifact; optional gated `publish` job    |

All actions run on Node 24 majors: `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7`, `actions/setup-python@v7`, `actions/upload-artifact@v7`, `actions/download-artifact@v8` (M7.4B; the Node 20 deprecation warning is gone). `release.yml` can be dispatched only after it exists on the default branch; it has not been run.

`release:build` ([release build](release-build.md)) copies the source to a neutral temporary path with spaces, builds and packs there, scans the package for build-machine paths, installs the tarball into a separate temporary directory with plain `npm install` (no links, workspace protocol, or `NODE_PATH`), and runs the installed-product smoke test:

- `avalok --version`, `--help`, `data path`, and `doctor` on five external fixtures (JS/TS, Python, polyglot, infrastructure, Unicode name)
- startup with a hostile `HOSTNAME=0.0.0.0`; dashboard HTML and static assets; repository and sample analysis
- dashboard and OTLP health; capabilities; the UI test trace; OTLP JSON and protobuf; the standard Python protobuf exporter
- 17 local-security checks against the production servers
- shutdown with port release; restart persistence; force-kill orphan cleanup; safe `data clear`

The Linux job uploads the neutral tarball as the `avalok-packed-tarball` artifact (7 days).

## Platform notes

| OS      | Specifics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux   | Neutral root under `/tmp`; the neutral checkout is renamed during the smoke (`--hide-workspace`). Headless: no browser is opened (`--no-open`), and the XDG data rules are unit-tested.                                                                                                                                                                                                                                                                                                                                                                                |
| macOS   | Same as Linux; neutral root under `/var/folders/…`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Windows | `--root "$env:RUNNER_TEMP"` puts the neutral root on `D:` while the user profile is on `C:`, the cross-drive case that broke the M7.3 build ([release build](release-build.md#build-time-tracing-and-the-home-directory)). Open files cannot be renamed, so the checkout is not hidden. Node cannot deliver a console Ctrl+C to one child, so the smoke terminates the CLI and asserts port release and the orphan watchdog instead of exit code 0. Result: 57 checks instead of 60. `npm.cmd` runs through a shell, so no argument containing spaces is passed to it. |

No step uses `continue-on-error`. `pnpm test --continue` only makes turbo run every package before failing, so one run reports all failures on an OS.

## Results

### M7.4C (branch `m7.4c-avalok` @ `64e7cda`, 2026-10-02), actually run

| Job                        | Unit tests                                  | Installed smoke              | Duration |
| -------------------------- | ------------------------------------------- | ---------------------------- | -------- |
| `ubuntu-latest`            | 303/303                                     | **68/68** (workspace hidden) | 3m13s    |
| `macos-latest` (arm64)     | 303/303                                     | **68/68** (workspace hidden) | 2m11s    |
| `windows-latest`           | 303/303                                     | **65/65**                    | 6m20s    |
| `ci.yml` (`ubuntu-latest`) | format, lint, typecheck, tests, build: pass | —                            | ≈3m      |

New since M7.4B: the offline OpenAI trace import and idempotent reimport checks, and rejection of both former names (AgentMap, Sarvadrik) in user-visible output. No Node 20 deprecation warnings.

### M7.4B (branch `m7.4b-sarvadrik-rc` @ `40f1780`, 2026-09-29), actually run

| Job                        | Unit tests                                  | Neutral build + leak scan           | Installed smoke              | Duration |
| -------------------------- | ------------------------------------------- | ----------------------------------- | ---------------------------- | -------- |
| `ubuntu-latest`            | 293/293                                     | pass; 0 leaks; notices 49 packages  | **66/66** (workspace hidden) | 3m36s    |
| `macos-latest` (arm64)     | 293/293                                     | pass; 0 leaks; notices 49 packages  | **66/66** (workspace hidden) | 1m45s    |
| `windows-latest`           | 293/293                                     | pass; 0 leaks; neutral root on `D:` | **63/63**                    | 5m23s    |
| `ci.yml` (`ubuntu-latest`) | format, lint, typecheck, tests, build: pass | —                                   | —                            | ≈3m      |

The smoke test now also checks package identity (`sarvadrik@0.1.0-alpha.1` at the time), `LICENSE`, the package README, `THIRD_PARTY_NOTICES.md` (elkjs, EPL-2.0 text, source link), and the absence of AgentMap branding in `--help`, the startup banner, and the dashboard HTML. Remaining annotations are GitHub notices only (Ubuntu 26 label migration, macOS capacity).

Builds are not byte-for-byte reproducible across machines: Next.js embeds the random neutral build path as module labels, so each OS's SHA-256 differs. Publication therefore uses the single CI-built tarball whose checksum and provenance the release workflow records.

### M7.4A (branch `m7.4a-local-security` @ `fab80b8`, 2026-09-28)

ubuntu 60/60, macOS 60/60, Windows 57/57 installed smoke; 289/289 unit tests on each. Bugs fixed on the way: Next's file tracer globbing the Windows home directory across drives, CRLF checkouts, Windows ESM `import()` of drive paths, shell quoting of paths with spaces, and POSIX-only test assumptions.
