# Upgrading and uninstalling

## Upgrades

Sarvadrik has no auto-update, no background update check, and makes no network call to learn about versions. Upgrading is an ordinary package-manager operation chosen by the user. Once the package is published, that is `npm install -g sarvadrik@<version>`. Before publication, install a newer release-candidate tarball over the old one:

```sh
npm install -g ./sarvadrik-<newer-version>.tgz
```

Expectations for future versions:

- The data root and layout (`runtime/`, `settings.json`, `migration.json`) are stable. A future layout change must ship its own copy → verify → activate migration and record it, as the AgentMap → Sarvadrik migration does.
- Persisted runs are normalized snapshots; newer versions should read older snapshots or skip them with a diagnostic rather than fail.
- Stop Sarvadrik (Ctrl+C) before upgrading so no dashboard or receiver process is using the old files.
- Pre-release versions follow `0.1.0-alpha.N`; the single version source is `packages/cli/package.json`.

## Coming from AgentMap development builds

The first Sarvadrik start copies runs and settings from the AgentMap data locations into the Sarvadrik data root, keeps the originals, and reports it (see [data migration](data-migration.md)). The `agentmap` command and `AGENTMAP_*` environment variables no longer exist; use `sarvadrik` and `SARVADRIK_*`.

## Uninstalling

Uninstalling removes only the package files (CLI, dashboard, samples). It does **not** delete Sarvadrik's local data, and Sarvadrik has no uninstall hook that could.

To remove the data too, run this **before** uninstalling:

```sh
sarvadrik data path          # shows the Sarvadrik-owned root
sarvadrik data clear         # removes runs and settings (asks for confirmation)
```

Then optionally delete the now-small root directory shown by `data path` (it retains `migration.json`), and any AgentMap locations listed in [data migration](data-migration.md).

Sarvadrik never writes into target repositories, Codex's session directory, Claude Code's directory or settings, kubeconfig, or Terraform state, so there is nothing to clean up there.
