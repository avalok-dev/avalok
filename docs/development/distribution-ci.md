# Distribution CI

Two workflows run on every push and pull request. Nothing is published by either.

| Workflow           | Runner                                            | Steps                                                                                                          |
| ------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ci.yml`           | `ubuntu-latest`                                   | frozen install → `format:check` → `lint` → `typecheck` → `test` → `build`                                      |
| `distribution.yml` | `ubuntu-latest`, `macos-latest`, `windows-latest` | frozen install → standard Python OTel exporter → `pnpm test --continue` → `pnpm release:build --python python` |

`release:build` ([release build](release-build.md)) copies the source to a neutral temporary path with spaces, builds and packs there, scans the package for build-machine paths, installs the tarball into a separate temporary directory with plain `npm install` (no links, workspace protocol, or `NODE_PATH`), and runs the installed-product smoke test:

- `sarvadrik --version`, `--help`, `data path`, and `doctor` on five external fixtures (JS/TS, Python, polyglot, infrastructure, Unicode name)
- startup with a hostile `HOSTNAME=0.0.0.0`; dashboard HTML and static assets; repository and sample analysis
- dashboard and OTLP health; capabilities; the UI test trace; OTLP JSON and protobuf; the standard Python protobuf exporter
- 17 local-security checks against the production servers
- shutdown with port release; restart persistence; force-kill orphan cleanup; safe `data clear`

The Linux job uploads the neutral tarball as the `sarvadrik-packed-tarball` artifact (7 days).

## Platform notes

| OS      | Specifics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux   | Neutral root under `/tmp`; the neutral checkout is renamed during the smoke (`--hide-workspace`). Headless: no browser is opened (`--no-open`), and the XDG data rules are unit-tested.                                                                                                                                                                                                                                                                                                                                                                                |
| macOS   | Same as Linux; neutral root under `/var/folders/…`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Windows | `--root "$env:RUNNER_TEMP"` puts the neutral root on `D:` while the user profile is on `C:`, the cross-drive case that broke the M7.3 build ([release build](release-build.md#build-time-tracing-and-the-home-directory)). Open files cannot be renamed, so the checkout is not hidden. Node cannot deliver a console Ctrl+C to one child, so the smoke terminates the CLI and asserts port release and the orphan watchdog instead of exit code 0. Result: 57 checks instead of 60. `npm.cmd` runs through a shell, so no argument containing spaces is passed to it. |

No step uses `continue-on-error`. `pnpm test --continue` only makes turbo run every package before failing, so one run reports all failures on an OS.

## Results (branch `m7.4a-local-security`, 2026-09-28)

**Actually run** on GitHub-hosted runners (Node 24.19.0 from `.node-version`, pnpm 11.19.0, Python 3.12):

| Job                        | Commit    | Unit tests                                  | Neutral build + leak scan                                    | Installed smoke              | Duration |
| -------------------------- | --------- | ------------------------------------------- | ------------------------------------------------------------ | ---------------------------- | -------- |
| `ubuntu-latest`            | `fab80b8` | 289/289                                     | pass; 0 leaks; neutral root in 29 label files                | **60/60** (workspace hidden) | 2m36s    |
| `macos-latest` (arm64)     | `fab80b8` | 289/289                                     | pass; 0 leaks; neutral root in 29 label files                | **60/60** (workspace hidden) | 1m37s    |
| `windows-latest`           | `fab80b8` | 289/289                                     | pass; 0 leaks; neutral root `D:\a\_temp\…` in 29 label files | **57/57**                    | 6m58s    |
| `ci.yml` (`ubuntu-latest`) | `fab80b8` | format, lint, typecheck, tests, build: pass | —                                                            | —                            | 2m53s    |

Windows and Linux bugs found and fixed while getting there:

1. **Windows `next build` crashed** (M7.3's red run): Next's file tracer globbed `C:\Users\runneradmin` across drives and hit `EPERM … Application Data`. Home paths are now opaque to the tracer; see the release-build doc and `build-tracing.test.ts`.
2. **Windows CRLF checkout** broke the shebang OTLP-descriptor generator under Vite. Fixed with `.gitattributes` (`* text=auto eol=lf`).
3. **Windows ESM:** `dist:build` passed a `D:\…` path to `import()`. It now uses `pathToFileURL`, and so does the generator's main-module check.
4. **Windows shell quoting:** `dist:pack` passed an absolute destination with spaces to `npm.cmd` through a shell. It is now a relative path.
5. **Test assumptions:** a legacy-path test hard-coded POSIX separators, and a layout test used a drive-less absolute path.
6. **Linux load:** the whole-repository analyzer test took about 12 s under parallel turbo on 2 cores against a 15 s limit; its budget is now 60 s.

Earlier runs on the same branch (`bc6ec04`, `990dbd4`, `bd2ebbe`, `03afa85`) failed on items 2–6 in turn; `b3e06d9` reached the Windows release build and failed on items 3–4.
