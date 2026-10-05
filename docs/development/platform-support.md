# Platform support

| Platform       | Status (M7.4A, 2026-09-28)                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| macOS (arm64)  | **CI and local:** 289 unit tests, neutral-path release build, 60/60 installed smoke (hidden workspace, Python exporter) |
| Linux (Ubuntu) | **CI:** 289 unit tests, neutral-path release build, 60/60 installed smoke (hidden workspace, Python exporter)           |
| Windows        | **CI:** 289 unit tests, neutral-path release build on `D:` (cross-drive), 57/57 installed smoke (Python exporter)       |

These are real GitHub-hosted runs of `.github/workflows/distribution.yml`; details and the bugs fixed on the way are in [distribution CI](distribution-ci.md). M7.3 had only macOS results, and its first Windows CI run failed in `next build`.

## Node

Supported: Node `>=24.19.0 <25` (Node 24 LTS line). The installed launcher refuses older versions with a clear message and exit 1 (verified with Node 20.14.0 and 23.9.0). Newer majors print a one-line "newer than tested" warning and run (Node 26.8.1 ran `doctor` successfully). `doctor` reports the same policy. npm itself only warns on `engines`.

## Platform-specific behavior

| Concern           | Implementation                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data root         | Platform rules evaluated with `path.win32`/`path.posix` explicitly, so Windows rules are exact in tests. Relative `XDG_DATA_HOME` is ignored per the XDG spec.                                                                         |
| Browser opening   | Pure `browserCommand()`: macOS `open`, Linux `xdg-open`, Windows `rundll32 url.dll,FileProtocolHandler`. Argument arrays, no shell, loopback `http` URLs only. Failure is a warning.                                                   |
| Executable lookup | `executableCandidates()` implements `PATH`/`Path` and `PATHEXT` on Windows and `:`-separated `PATH` with `X_OK` on POSIX. No `which`/`where`/shell.                                                                                    |
| Child processes   | Only two spawns (dashboard, browser), both `process.execPath`/fixed executables with argument arrays and `shell: false`. Repository paths are never interpolated into commands.                                                        |
| Signals           | SIGINT (Ctrl+C, including Windows console), SIGTERM, and SIGHUP (terminal/console closed) trigger coordinated shutdown.                                                                                                                |
| Dashboard stop    | The packaged dashboard exits immediately on SIGTERM (`NEXT_MANUAL_SIG_HANDLE`), as Windows termination already does; the collector in the CLI process owns persistence. Measured ≈50 ms on macOS with and without an open live stream. |
| Orphans           | `avalok-launch.cjs` checks the CLI PID every second (`process.kill(pid, 0)`, cross-platform) and exits if the CLI is gone — e.g. force-killed or a closed Windows console.                                                             |
| Paths             | `path` APIs throughout; the analyzer normalizes repository-relative IDs to `/`. Tested with spaces in install and repository paths and a Unicode repository name.                                                                      |
| Temp files        | `os.tmpdir()` only in tests/smoke; runtime writes only under the Avalok data root.                                                                                                                                                     |
| Permissions       | No `chmod` requirement at runtime; npm creates bin shims (`.cmd`/`.ps1` on Windows).                                                                                                                                                   |
| Bind              | Dashboard and OTLP bind `127.0.0.1`; the child's `HOSTNAME` is pinned so a shell `HOSTNAME` cannot widen it (verified with `HOSTNAME=0.0.0.0` and `lsof`).                                                                             |

## Known platform gaps

- Windows: Ctrl+C cannot be simulated for a single child in CI, so the Windows smoke asserts port release after termination rather than a clean exit code. Symlink-based unit tests pass on GitHub runners (administrator); a non-admin machine without Developer Mode may skip or fail them.
- Windows checkouts rely on `.gitattributes` (LF) and on the dashboard build keeping home-directory paths away from Next's file tracer (see [release build](release-build.md)).
- Linux headless: `xdg-open` may be absent; Avalok prints the URL and continues.
- WSL is not specifically handled.
