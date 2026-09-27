# Local data migration

## Locations

| Kind                      | Location                                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| Current AgentMap root     | macOS `~/Library/Application Support/AgentMap`                               |
|                           | Linux `$XDG_DATA_HOME/agentmap` (absolute only) or `~/.local/share/agentmap` |
|                           | Windows `%LOCALAPPDATA%\AgentMap` or `%USERPROFILE%\AppData\Local\AgentMap`  |
| Provisional M7.1 location | `~/.agentmap/runtime`                                                        |

Inside the root: `runtime/` (normalized runs), `settings.json` (UI settings), `migration.json` (migration record). Repository analysis cache is process-local and never written to disk. `AGENTMAP_DATA_DIR` (or `AGENTMAP_DATA_ROOT`) overrides the root for development and tests.

Older contributor collector runs (pre-M7.2) may have written a repository-local `.agentmap/runtime`. That is gitignored contributor data, not a user location, and is not migrated.

## Strategy: copy → verify → activate

On each `agentmap` start (not `doctor`), before services start:

1. If `migration.json` says `completed`, stop (idempotent no-op).
2. If a data-root override is set, skip — an isolated root never silently imports personal data.
3. If `~/.agentmap/runtime` is absent, stop.
4. For each entry, consider only regular files named like AgentMap snapshots (`codex|claude|telemetry-<sha256>.json`). Symlinks and anything else are ignored.
5. If the destination already exists, skip it — newer data is never overwritten.
6. Copy into a staging directory inside the new `runtime/`, verify the SHA-256 matches the source and the JSON parses (corrupt snapshots are ignored), then activate with an exclusive hard link (or an exclusive copy where links are unsupported). Readers never see a partial file and a concurrent writer is never clobbered.
7. Record the outcome in `migration.json` (counts, time, error; never file contents).

The legacy directory is **never modified or deleted**. A failure leaves it intact, records `failed`, prints a short note, does not block startup, and is retried on the next start. Already-activated files are skipped on retry.

## Visibility

- Startup prints `Copied N earlier runs from ~/.agentmap/runtime (original kept)` once.
- `agentmap doctor` reports the data root and writability, and one of: no earlier data; earlier data will be copied on next start; migrated (counts, original kept); failed (reason, original untouched); or not migrated because of an override.

## Clearing

`agentmap data clear` removes only the new root's `runtime/` and `settings.json`. It keeps `migration.json`, so cleared runs are **not** re-imported from the legacy directory on the next start. It never touches `~/.agentmap`. A symlinked `runtime/` is unlinked, not followed.

To remove the legacy copy after confirming the migration (`agentmap doctor`), delete it manually:

```sh
rm -r ~/.agentmap/runtime   # macOS/Linux; only after doctor reports "migrated"
```

AgentMap does not offer automatic legacy deletion in M7.3.

## Simulating legacy data safely

```sh
FAKE_HOME="$(mktemp -d)/Fake Home"
mkdir -p "$FAKE_HOME/.agentmap/runtime"
cp <some-agentmap-runtime-snapshot>.json "$FAKE_HOME/.agentmap/runtime/"
HOME="$FAKE_HOME" agentmap doctor .        # "will be copied on next start"
HOME="$FAKE_HOME" agentmap . --no-open     # "Copied 1 earlier run ... (original kept)"; Ctrl+C
HOME="$FAKE_HOME" agentmap doctor .        # "migrated (1 copied ...); original kept"
ls "$FAKE_HOME/.agentmap/runtime" "$FAKE_HOME/Library/Application Support/AgentMap/runtime"
```

Do not set `AGENTMAP_DATA_DIR` for this test; an override disables migration by design.
