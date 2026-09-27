# Upgrading and uninstalling

## Upgrades

AgentMap has no auto-update, no background update check, and makes no network call to learn about versions. Upgrading is an ordinary package-manager operation chosen by the user (once a distribution channel exists in M7.4 or later), for example installing a newer tarball over the old one:

```sh
npm install -g ./visual-system-agentmap-<newer-version>.tgz
```

Expectations for future versions:

- The data root and layout (`runtime/`, `settings.json`, `migration.json`) are stable. A future layout change must ship its own copy → verify → activate migration, as M7.3 did for `~/.agentmap/runtime`, and record it.
- Persisted runs are normalized snapshots; newer versions should read older snapshots or skip them with a diagnostic rather than fail.
- Stop AgentMap (Ctrl+C) before upgrading so no dashboard or receiver process is using the old files.
- Pre-release versions follow `0.1.0-alpha.N`; the single version source is `packages/cli/package.json`.

## Uninstalling

Uninstalling removes only the package files (CLI, dashboard, samples). It does **not** delete AgentMap's local data, and AgentMap has no uninstall hook that could.

To remove the data too, run this **before** uninstalling:

```sh
agentmap data path          # shows the AgentMap-owned root
agentmap data clear         # removes runs and settings (asks for confirmation)
```

Then optionally delete the now-small root directory shown by `data path` (it retains `migration.json`), and — only if you used the M7.1 preview — `~/.agentmap`.

AgentMap never writes into target repositories, Codex's session directory, Claude Code's directory or settings, kubeconfig, or Terraform state, so there is nothing to clean up there.
