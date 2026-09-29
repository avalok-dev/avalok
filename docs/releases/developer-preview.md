# Developer preview release checklist — Sarvadrik 0.1.0-alpha.1

Status: **release candidate, not published.** Checked boxes were verified during M7.4B (2026-09-28/29). Unchecked boxes need a maintainer decision or action. Publication boxes stay unchecked until you explicitly approve and perform them.

## Identity and legal

- [x] Name: **Sarvadrik** ("See your whole system."), set in `packages/cli/product.json`
- [x] Domain: https://sarvadrik.com used as `homepage`. No other URLs are referenced.
- [ ] npm package identity: provisional unscoped **`sarvadrik`** (unpublished as of 2026-09-28). Re-check with `npm view sarvadrik` right before publishing, and create or confirm the npm account/2FA that will own it.
- [ ] GitHub repository identity: choose the public repository (for example rename `JaishnavG/agentmap`, or use an organization; the `sarvadrik` user handle belongs to an unverified existing account), then set `product.json#repository` so the package gets `repository`/`bugs` fields.
- [x] License: Apache-2.0 (`LICENSE`), shipped in the package
- [ ] Copyright holder: `LICENSE` is the unmodified Apache-2.0 text. Optionally add a `NOTICE` file with a copyright line once you choose the holder name (not required by Apache-2.0).
- [x] Third-party notices: `THIRD_PARTY_NOTICES.md` generated (49 components) and verified from the installed tarball
- [x] elkjs (EPL-2.0) reviewed: unmodified, notice plus source link plus full EPL text shipped; no project-license change needed ([analysis](../development/third-party-notices.md#elkjs-and-the-eclipse-public-license-20))
- [ ] Security contact: enable **private vulnerability reporting** on the public repository (SECURITY.md relies on it); no email address is published
- [ ] Optional: code of conduct (needs a real enforcement contact before adoption)
- [ ] Review `AGENTS.md` before the repository goes public (it contains a machine-specific runtime note)

## Content

- [x] README rewritten for first-time users (Quick Start, capability matrix, static vs live infrastructure, privacy, limitations, "Why Sarvadrik?")
- [x] Screenshot: `docs/assets/sarvadrik-overview.png`, a real capture of the packaged release candidate (Infra Platform example, no private data)
- [ ] Optional: animated GIF or short demo of Live runtime replay
- [x] CONTRIBUTING, SECURITY, privacy, issue templates, PR template
- [x] Public privacy/security docs: `docs/privacy.md`, `SECURITY.md`, `docs/security/*`

## Package

- [x] Version `0.1.0-alpha.1` consistent across CLI `--version`, help/banner, doctor, dashboard capability report, and manifest
- [x] Package contents: `bin/`, `lib/`, `dashboard/`, `samples/`, `LICENSE`, `README.md`, `THIRD_PARTY_NOTICES.md`, `package.json` (165 files, 1.87 MB packed, ≈7.1 MB unpacked, ≈353 MB installed with dependencies)
- [x] No development junk, secrets, or developer paths (neutral-path leak scan; manual tarball search found no username, home, or checkout path)
- [x] Everyday builds are `private: true`; the publishable build path (`--publishable`) was validated locally with smoke and provenance check

## Verification

- [x] macOS: CI 66/66 installed smoke + 293 unit tests; local neutral-path build 66/66
- [x] Linux: CI 66/66 installed smoke + 293 unit tests
- [x] Windows: CI 63/63 installed smoke + 293 unit tests (cross-drive neutral build)
- [x] OTLP protobuf
- [x] Standard Python exporter (direct, no Collector, protobuf)
- [x] Codex: packaged discovery of local sessions (counts only reported)
- [x] Claude Code: hook accepted in the documented format; capability state detected; M7.4A protections intact
- [x] Terraform, Kubernetes, Helm, AWS inference (Infra Platform example: 26 entities; packaged samples)
- [x] Privacy: packaged product made zero non-loopback connection attempts (measured); Next.js telemetry disabled in all Sarvadrik workflows
- [x] Security: foreign Host/Origin/content-type rejected in the packaged RC (probe plus 17 smoke checks)
- [x] Clean install from a neutral directory with spaces
- [x] Neutral-path build (random temporary root; checkout hidden on POSIX)
- [x] AgentMap → Sarvadrik data migration (copy of real data under a fake home: 2 runs plus settings, originals intact)
- [ ] `git status` clean on the release commit and the M7.4A/M7.4B branches merged to `main`

## Publication (do not check until performed with explicit approval)

- [ ] Merge to `main`; confirm CI and Distribution are green on `main`
- [ ] Create the protected `npm-publish` environment (required reviewers) and npm credentials (`NPM_TOKEN` secret or npm trusted publishing for `.github/workflows/release.yml`)
- [ ] Make the repository public / move to its final location; enable private vulnerability reporting
- [ ] Tag `v0.1.0-alpha.1`
- [ ] Run the **Release** workflow with `publish: false`; inspect the `sarvadrik-release` artifact and provenance
- [ ] Run the **Release** workflow with `publish: true` and approve the environment (npm publish)
- [ ] Verify `npx sarvadrik@0.1.0-alpha.1 --version` from a clean machine
- [ ] GitHub release with notes, the tarball, and its `.sha256`
