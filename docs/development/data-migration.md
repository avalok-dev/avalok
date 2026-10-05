# Local data migration

Avalok was developed under the working name **AgentMap**. Development builds may have left data in AgentMap locations. Avalok copies that data into its own data root once, never modifies or deletes the originals, and reports what it did.

The short-lived **Sarvadrik** name (the M7.4B release candidate) was never published, so Sarvadrik data locations are not migrated. A Sarvadrik root left by a local release-candidate test contains only copies of AgentMap data, which Avalok migrates from the AgentMap original; delete the Sarvadrik directory manually if you have one.

## Locations

| Kind                                           | Location                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| **Avalok data root** (current)                 | macOS `~/Library/Application Support/Avalok`                             |
|                                                | Linux `$XDG_DATA_HOME/avalok` (absolute only) or `~/.local/share/avalok` |
|                                                | Windows `%LOCALAPPDATA%\Avalok` or `%USERPROFILE%\AppData\Local\Avalok`  |
| AgentMap data root (M7.2–M7.4A builds), source | macOS `~/Library/Application Support/AgentMap`                           |
|                                                | Linux `$XDG_DATA_HOME/agentmap` or `~/.local/share/agentmap`             |
|                                                | Windows `%LOCALAPPDATA%\AgentMap`                                        |
| AgentMap M7.1 location, source                 | `~/.agentmap/runtime`                                                    |

Inside the Avalok root: `runtime/` (normalized runs), `settings.json` (UI settings), `migration.json` (migration record). Repository analysis cache is process-local and never written to disk. `AVALOK_DATA_DIR` (or `AVALOK_DATA_ROOT`) overrides the root for development and tests.

Older contributor collector runs may have written a repository-local `.agentmap/runtime`. That is gitignored contributor data, not a user location, and is not migrated.

## Strategy: copy → verify → activate

On each `avalok` start (not `doctor`), before services start, each source is processed in the order above:

1. If a data-root override is set, skip everything: an isolated root never silently imports personal data.
2. If `migration.json` records the source as `completed`, skip it (idempotent).
3. If the source has neither snapshots nor settings, skip it.
4. Consider only regular files named like runtime snapshots (`codex|claude|telemetry-<sha256>.json`). Symlinks and anything else are ignored.
5. If the destination already exists, skip it. Newer data, or the same run from an earlier source, is never overwritten.
6. Copy into a staging directory inside the new `runtime/`, verify that the SHA-256 matches the source and the JSON parses (corrupt snapshots are ignored), then activate with an exclusive hard link (or an exclusive copy where links are unsupported). Readers never see a partial file and a concurrent writer is never clobbered.
7. Copy the AgentMap `settings.json` only if Avalok has no settings yet.
8. Record the source's outcome in `migration.json` (`{ "version": 2, "sources": { "<key>": … } }`: counts, time, error; never file contents).

Source keys: `agentmap-data-root` and `agentmap-home-directory`. Legacy directories are **never modified or deleted**. A failure leaves the source intact, records `failed`, prints a short note, does not block startup, and is retried on the next start. Already-activated files are skipped on retry.

## Visibility

- Startup prints, once per source: `Copied N earlier AgentMap runs [and settings] from <location> (original kept)`.
- `avalok doctor` reports the data root and writability. For each AgentMap location that has data, it reports one of: will be copied on next start; migrated (counts, settings, original kept); failed (reason, original untouched); or not migrated because of an override. With no AgentMap data it prints `No earlier AgentMap data to migrate`.

## Clearing

`avalok data clear` removes only the Avalok root's `runtime/` and `settings.json`. It keeps `migration.json`, so cleared runs are **not** re-imported on the next start. It never touches AgentMap locations. A symlinked `runtime/` is unlinked, not followed.

To remove AgentMap data after `avalok doctor` reports it as migrated, delete it manually, for example:

```sh
rm -r ~/.agentmap                                   # M7.1 location
rm -r "$HOME/Library/Application Support/AgentMap"  # macOS AgentMap root
rm -r "${XDG_DATA_HOME:-$HOME/.local/share}/agentmap"   # Linux AgentMap root
```

Avalok never deletes legacy data automatically.

## Simulating legacy data safely

```sh
FAKE_HOME="$(mktemp -d)/Fake Home"
mkdir -p "$FAKE_HOME/.agentmap/runtime"
cp <some-runtime-snapshot>.json "$FAKE_HOME/.agentmap/runtime/"
HOME="$FAKE_HOME" avalok doctor .        # "will be copied on next start"
HOME="$FAKE_HOME" avalok . --no-open     # "Copied 1 earlier AgentMap run ... (original kept)"; Ctrl+C
HOME="$FAKE_HOME" avalok doctor .        # "migrated (1 copied ...); original kept"
```

Do not set `AVALOK_DATA_DIR` for this test; an override disables migration by design. Automated coverage: `packages/capabilities/tests/migration.test.ts` and the doctor test in `packages/cli/tests/distribution.test.ts`.
