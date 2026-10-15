# Neutral-path release build

`pnpm release:build` is the **only** supported source of release artifacts. Release artifacts must not depend on, or reveal, the machine that built them, and the artifact that is published must be the exact artifact that was tested. `release:build` proves all three.

```sh
pnpm install --frozen-lockfile
pnpm release:build                           # macOS/Linux
pnpm release:build --python /path/to/python  # plus the standard OTLP Python exporter step
pnpm release:build --root D:\a\_temp         # choose the parent directory (Windows CI)
```

Options: `--publishable` (omit `private: true`; used only by the release workflow), `--skip-smoke` (build, pack, and scan only), `--keep` (keep the temporary checkout).

## What it does

1. **Neutral copy.** Copies `git ls-files --cached --others --exclude-standard`, meaning tracked files plus untracked, non-ignored local work (never `node_modules`, `dist`, `.next`, or `artifacts`), to `<tmp>/avalok-release-XXXX/Avalok Release Test/source`. The path contains spaces and has no relation to the developer's checkout, username, or home directory. The script refuses a parent directory inside the home directory.
2. **Build there.** `pnpm install --frozen-lockfile --prefer-offline`, `pnpm dist:build`, `pnpm dist:pack`, with `CI=true` and `NEXT_TELEMETRY_DISABLED=1`.
3. **Path-leak scan** of the unpacked package (`packages/cli/dist`, every text file). The build fails on:
   - the builder's home directory,
   - the original checkout path,
   - the username as a path segment (`/name/` or `\name\`),

   in raw and JSON-escaped (`C:\\Users\\…`) spellings. It also reports how many files mention the neutral build root; see below.

4. **Installed-product smoke** from that tarball (`smoke-installed.mjs --tarball …`), hiding the neutral checkout on POSIX. This includes the 17 local-security checks.
5. Copies the tarball to `artifacts/release/` (clearing anything older), hashes it before the smoke test, verifies the hash afterwards, and writes `<tarball>.sha256` and `release-provenance.json` (package, version, publishable flag, SHA-256, size, git commit and dirty flag, builder platform and Node version, leak-scan and smoke results).

## Provenance and publication

- Everyday builds (`pnpm dist:build`, `pnpm release:build`) produce a `private: true` manifest, so `npm publish` refuses them.
- `.github/workflows/release.yml` (manual `workflow_dispatch` only) runs the full checks and `pnpm release:build --publishable --python python` on Ubuntu, and requires a clean tree and passing smoke/leak results in `release-provenance.json`. It uploads the tarball, checksum, and provenance as the `avalok-release` artifact.
- Its `publish` job runs only when the `publish` input is true, waits for approval of the protected `npm-publish` environment, downloads that artifact, verifies the SHA-256, and runs `npm publish <tarball> --provenance`. It never rebuilds. It has **not** been run; configuring the environment, reviewers, and npm credentials is part of the [releasing guide](releasing.md).

## Findings

| Build location                             | Files naming the build path   | What they are                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Developer checkout (`dist:build` in place) | 29 of 134                     | Absolute developer path, including the username and the Codex project directory                                                                                                                |
| Neutral release build                      | 29 of 134 (neutral root only) | `dashboard/server.js` and `.next/required-server-files.json` (`outputFileTracingRoot`/`appDir` in the embedded config), `resolvedPagePath` in route chunks, and client-reference manifest keys |

Next.js standalone output keeps absolute build paths as configuration and module labels. They are never loaded at runtime (the dist independence check and the hidden-workspace smoke prove that), but an in-place build therefore reveals the developer's home directory, username, and project layout. **Publish only artifacts from `pnpm release:build` (CI).** The neutral root they contain (`/tmp/avalok-release-…/Avalok Release Test/source` or `D:\a\_temp\…`) reveals nothing about a person. No source maps are shipped. Rewriting Next's labels was considered and rejected: the client-reference manifest keys must match compiled server references, so rewriting them risks runtime breakage for no privacy gain over a neutral path.

## Build-time tracing and the home directory

Next.js runs `@vercel/nft` over every server module during `next build`. nft evaluates `os.homedir()` with the real `os` module and globs any resulting directory. It skips globs outside the tracing root only when `path.relative` starts with `..`. On Windows, when the checkout and the user profile are on different drives (GitHub Actions: `D:\a\…` vs `C:\Users\runneradmin`), `path.relative` returns an absolute path, so nft globbed the whole profile. The M7.3 Windows distribution build failed with `EPERM … C:\Users\runneradmin\Application Data`. Had the glob succeeded, it could have traced private files such as `~/.codex/sessions/*.jsonl` into the build output.

Fix: dashboard-bundled code never computes a home path in a form nft can evaluate. It takes `home = homedir()` as a parameter default (`clearAvalokData`, `defaultCodexSessionsDirectory`) and builds Claude settings candidates from path segments instead of an array literal of joined paths. `packages/cli/tests/build-tracing.test.ts` runs Next's own nft over the transpiled dashboard sources with base `/` (which reproduces the cross-drive condition on every OS) and a fake home containing sentinel files. It fails if anything under the home directory or any `.claude/settings*` file is traced. Before the fix it traced `~/.codex/sessions/rollout.jsonl` and `~/Documents/private.txt`.

Rule for contributors (also in `AGENTS.md`): in code bundled into the dashboard, pass `homedir()` in as a parameter default; do not call it inline inside path expressions.
