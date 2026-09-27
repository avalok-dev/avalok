# AgentMap local data

AgentMap stores only its own observed-run persistence and small UI settings in a user-local application-data directory:

- macOS: `~/Library/Application Support/AgentMap`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/agentmap`
- Windows: `%LOCALAPPDATA%\AgentMap`

`AGENTMAP_DATA_DIR` overrides the root for development/tests. Runtime snapshots are under `runtime/`; first-run settings are in `settings.json`; `migration.json` records the one-time M7.3 migration from the provisional M7.1 `~/.agentmap/runtime` (see `data-migration.md`). Repository analysis caching remains process-local.

Show the exact active path:

```sh
agentmap data path   # contributors: pnpm agentmap data path
```

Clear AgentMap-owned runs, cache area, and UI settings:

```sh
agentmap data clear
```

Interactive clearing requires `y`/`yes`; Enter and every other answer cancel. Automation may use `--yes`:

```sh
agentmap data clear --yes
```

The clear implementation names and validates the owned `runtime/` and `settings.json` paths. It keeps `migration.json` so cleared runs are not re-imported from `~/.agentmap/runtime`, never touches `~/.agentmap` itself, and unlinks (never follows) a symlinked `runtime/`. It does not recursively delete an arbitrary supplied directory. It never deletes the target repository, Codex's session directory, Claude Code's directory/settings/transcripts, kubeconfig, Terraform, or upstream telemetry data. Clearing settings makes Getting Started appear on the next CLI launch.
