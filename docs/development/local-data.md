# Sarvadrik local data

Sarvadrik stores only its own observed-run persistence and small UI settings in a user-local application-data directory:

- macOS: `~/Library/Application Support/Sarvadrik`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/sarvadrik`
- Windows: `%LOCALAPPDATA%\Sarvadrik`

`SARVADRIK_DATA_DIR` overrides the root for development/tests. Runtime snapshots are under `runtime/`; first-run settings are in `settings.json`; `migration.json` records the one-time copy of data from the product's former AgentMap locations (see [data migration](data-migration.md)). Repository analysis caching remains process-local.

Show the exact active path:

```sh
sarvadrik data path   # contributors: pnpm sarvadrik data path
```

Clear Sarvadrik-owned runs, cache area, and UI settings:

```sh
sarvadrik data clear
```

Interactive clearing requires `y`/`yes`; Enter and every other answer cancel. Automation may use `--yes`:

```sh
sarvadrik data clear --yes
```

The clear implementation names and validates the owned `runtime/` and `settings.json` paths. It keeps `migration.json` so cleared runs are not re-imported from AgentMap locations, never touches those locations, and unlinks (never follows) a symlinked `runtime/`. It does not recursively delete an arbitrary supplied directory. It never deletes the target repository, Codex's session directory, Claude Code's directory/settings/transcripts, kubeconfig, Terraform, or upstream telemetry data. Clearing settings makes Getting Started appear on the next CLI launch.
