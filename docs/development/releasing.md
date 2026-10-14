# Releasing

Maintainer guide for publishing Avalok. Publication is manual and goes through the protected `Release` workflow (`.github/workflows/release.yml`); nothing is published from a laptop.

## Before you publish

- [ ] `main` is green in CI on all three operating systems, including the Node 22 installed-smoke step.
- [ ] `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` pass locally.
- [ ] `pnpm release:build` passes (neutral-path build, path-leak scan, installed smoke, SHA-256 and provenance). Build from a clean commit so `gitDirty` is `false` in `release-provenance.json`.
- [ ] The version in `packages/cli/package.json` is the one you intend to publish; identity (name, homepage, repository) is in `packages/cli/product.json`.
- [ ] `npm view avalok dist-tags` checked right before publishing. An older placeholder version may hold `latest`; the release must be tagged so `latest` is the real version.
- [ ] The `npm-publish` environment has required reviewers and npm credentials with two-factor authentication.
- [ ] Private vulnerability reporting is enabled on the repository (SECURITY.md relies on it).

## Publish

1. Run the `Release` workflow with `publish` set to `false` and download the artifact. Check the tarball and `release-provenance.json`.
2. Install the tarball in a clean directory and run `avalok --version`, `avalok doctor` and `avalok demo`.
3. Run the workflow again with `publish` set to `true` and approve the `npm-publish` environment. It uploads exactly the tarball that was built and tested, after verifying its checksum.

## After you publish

- [ ] From a clean directory: `npx avalok@latest --version` prints the new version.
- [ ] Create the GitHub release and tag from the same commit.
- [ ] Create the labels listed in `.github/labels.yml` (the file is a list only; a maintainer creates them).

See [release-build.md](release-build.md) for how the artifact is built and verified and [distribution-ci.md](distribution-ci.md) for the CI matrix.
