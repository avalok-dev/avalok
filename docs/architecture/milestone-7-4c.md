# Milestone 7.4C — Avalok

M7.4C renames the unpublished Sarvadrik release candidate to **Avalok** and re-verifies the release candidate under the new name. Nothing was published: no `npm publish`, GitHub release, visibility change, new remote, or external account.

## Identity

| Item           | Value                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Display name   | Avalok (AH-va-lok, from Sanskrit _avaloka_, "looking upon, observing")                                                |
| Tagline        | See your whole system.                                                                                                |
| Description    | A local-first visual system for understanding how your code, infrastructure, agents, and runtime connect and execute. |
| CLI            | `avalok` (no `sarvadrik` or `agentmap` alias)                                                                         |
| npm package    | `avalok` (unscoped; npm returned 404 on 2026-10-02)                                                                   |
| Version        | `0.1.0-alpha.1` (unchanged: nothing was published under Sarvadrik)                                                    |
| Homepage       | https://avalok.dev (the maintainer also holds avalok.live)                                                            |
| Repository URL | not set (`product.json#repository: null`) until the public repository is chosen                                       |

The `avalok` GitHub name is an existing organization (created August 2026, no public repositories) that the maintainer does not own, so the public repository needs another organization name, for example `avalok-dev`.

## Rename

All current code, configuration, tests, examples, and reference docs moved from Sarvadrik to Avalok in one scripted pass (122 files), with the same categories as [M7.4B](milestone-7-4b.md):

- **Brand and CLI:** product name, banner, help, doctor, dashboard title, Getting Started, README, generated package README; `avalok` bin and `packages/cli/avalok.mjs`; `pnpm avalok`; root package `avalok-monorepo`.
- **Public configuration, no aliases** (never published): `AVALOK_*` environment variables, `.avalokignore`, Kubernetes mapping labels `avalok.dev/cluster` and `avalok.dev/load-balancer` (prefix on the owned domain).
- **Data roots:** `~/Library/Application Support/Avalok`, `$XDG_DATA_HOME/avalok` (or `~/.local/share/avalok`), `%LOCALAPPDATA%\Avalok`.
- **Internal protocol:** `/v1/avalok/test-trace`; Avalok's own synthetic attributes `avalok.*`.
- **Kept:** the `@visual-system/*` workspace scope; AgentMap migration code and legacy fixtures; historical milestone records (banners updated to name Avalok; this milestone's predecessor record gained a banner); `.sarvadrik` and `.agentmap` stay in the packaging exclusions.

**No Sarvadrik data migration.** Sarvadrik existed only as a release candidate for a few days. The AgentMap migration is unchanged, so AgentMap-era data still reaches Avalok directly. A Sarvadrik root created by local release-candidate testing contains only copies of AgentMap data; it is left alone and can be deleted manually.

The installed-product smoke test now rejects both former names (`/agentmap|sarvadrik/i`) in the help text, startup banner, package README, and dashboard HTML.

## Also included

- Review of the "local trace observability and connection inspection" commit (offline `import openai`, per-node and per-connection statistics). Its tests and smoke checks pass under the new name. One fix: the import now checks the 20 MiB file limit before reading a file into memory instead of after.

## Verification

See the [release checklist](../releases/developer-preview.md) for results.
