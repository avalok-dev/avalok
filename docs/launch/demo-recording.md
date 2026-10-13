# Demo GIF: recording plan

The GIF is the first thing people see, so it must show the loop and nothing else: **an agent session lights up the parts of the system it touched, and one click makes a shareable recap.** Target 15 to 25 seconds, under 8 MB, no sound, no text beyond the product's own UI.

The session is scripted so every take is identical. It is a **replayed, synthetic session** ([demo-session.mjs](demo-session.mjs) sends scripted Claude Code hook events through the real receiver). Say so in the README caption or the post; do not present it as a real agent run.

## Prepare (once per take)

Use a throwaway data folder so your own sessions never appear on screen. Run from the repository root with the built or installed `avalok` (examples below use the installed command; from a clone use `pnpm avalok`).

```sh
export AVALOK_DATA_DIR="$(mktemp -d)"           # Windows PowerShell: $env:AVALOK_DATA_DIR = (New-Item -Type Directory "$env:TEMP\avalok-demo-$(Get-Random)").FullName
avalok examples/polyglot-ai-platform --no-open   # leave running; note the dashboard URL it prints
```

In a second terminal, with the same `AVALOK_DATA_DIR`:

```sh
node docs/launch/demo-session.mjs examples/polyglot-ai-platform
```

Expected: `Sent 11 hook events for session demo-...`. Check with `avalok recap examples/polyglot-ai-platform`: it reports 11 steps observed, 1 failed, and "System parts touched" (Backend API, Redis, Worker, PostgreSQL).

Recording setup: browser window about 1280×800 on a clean profile (no bookmarks bar or extensions visible), dark theme as shipped, zoom 100%. Hide notifications. Record at 2x scale and downscale to about 960 px wide.

## Script (about 20 seconds)

| Time | Action                                                       | What the viewer sees                                                                    |
| ---: | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
|  0 s | Open the dashboard URL. Do not click anything for 2 seconds. | It opens straight into the session over the architecture map.                           |
|  3 s | Press play and pick 4x (1x is too slow for a GIF).           | Nodes the agent touched light up; the failing test step turns red and stays lit longer. |
| 10 s | Click the **Backend API** node.                              | The inspector shows what was observed there and the evidence.                           |
| 14 s | Click **Share**.                                             | The preview shows the recap card.                                                       |
| 18 s | Switch to the **Replay** option in the dialog, then stop.    | The interactive replay is one file anyone can open.                                     |

Do not show the Download button being clicked or any folder on your computer. Do not show the terminal in the GIF.

## After recording

1. Convert to GIF (for example `ffmpeg -i take.mov -vf "fps=12,scale=960:-1:flags=lanczos" -loop 0 docs/assets/avalok-demo.gif`) and check the size.
2. Watch it once at full speed and once frame by frame. Look for: your username, home path, other repositories, browser tabs, notifications, the real data path.
3. Uncomment the placeholder at the top of the README, add alt text, and commit the GIF.
4. Keep the take and the `demo-session.mjs` version used, so it can be re-recorded after a UI change.

## Known rough edges to fix or avoid on camera

- The dashboard shows the built-in demo for a moment before it lands on the session. Wait for it, or trim it.
- The recap headline says "ended with an error" for a session that failed a test and then recovered, because any failed step marks the run as errored. Do not show that headline in the GIF.
- Claude Code sessions never count "test runs" (only Codex does), so the recap shows commands, not tests.

## Teardown

Press Ctrl+C in the first terminal and delete the throwaway data folder (it only holds the scripted session).
