# Handoff (2026-10-08)

Read this first in a new session. It says where the open-source launch track stands, how to run and test everything, what is verified and what is not, and what to do next. The full plan is [OPENSOURCE_LAUNCH_PLAN.md](OPENSOURCE_LAUNCH_PLAN.md); durable architecture decisions are in [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md); mandatory rules are in `AGENTS.md`.

## State

- `main` is the tested code. CI (`verify`: lint, typecheck, test, build; plus the packed-install smoke on ubuntu, macOS and Windows, including Node 22) is green on `main`. Last full local gate: **432 unit tests**, `release:build` installed smoke **71/71 on Node 24 and on Node 22**.
- The product is Avalok (`avalok`): a local-first dashboard that maps a repository's architecture and overlays what coding agents and OpenTelemetry traces actually did. Open source (Apache-2.0), repo `avalok-dev/avalok`. **Nothing is published to npm** (the name holds a `0.0.1` placeholder, so `npx avalok` does not work yet) and no tags or releases exist.
- Avalok Cloud (`../avalok-cloud`, private) is **paused** at milestone C1. See its `docs/PAUSED.md`.

## What is done (launch track phases)

| Phase                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L0 baseline            | Uncached verification recorded; stale checklist items corrected.                                                                                                                                                                                                                                                                                                                                                                                |
| L1 easy install        | Landing without prompts (no auto dialog; opens the newest session from this repository, else the map with the session picker); Node 22 support (`product.json#nodeRange` `>=22.12.0`, dev toolchain still Node 24.19); install size 344 MB to 67 MB (dashboard ships Next's pruned runtime modules, no compiler binary, no sharp); `avalok demo`; header overlap fix; dist-tag notes in the release checklist.                                  |
| L2 agent setup         | `avalok setup claude` (print-only by default; `--apply` confirms, backs up, merges only Avalok's hooks; `--remove`) and `avalok setup codex`. Verified by the maintainer with a real Claude Code session.                                                                                                                                                                                                                                       |
| L3 shareable artifacts | Active-resource glow (`deriveDwellState`); new `@visual-system/export` package: recap card, architecture diagram, interactive single-file HTML replay, Markdown summary, weekly "wrapped" card; Share dialog (preview, anonymize and brand toggles, SVG/PNG/HTML/Markdown); CLI `avalok recap [--format md\|svg\|html\|diagram]` and `avalok wrapped`; Python parse diagnostics carry a line number and no longer report valid code as invalid. |

Bugs found by testing on real data or by CI and fixed (each has a regression test): over-redaction of long paths; duplicate React keys; `wrapped` counting months-old steps of resumed sessions; a Windows-only absolute-path leak in the README hint (found by the Windows CI job); a cold-start timeout in the layout test.

## How to run and test locally

Use Node 24 (`.node-version`) and pnpm 11.19. Do not run `next build` (or `pnpm build`) in this folder while a dev server is running from it; it corrupts the dev server's `.next`. `pnpm release:build` builds in a temp directory and is safe.

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test          # 432 tests
pnpm release:build                                # neutral-path build + installed smoke (71 checks)
pnpm avalok .                                     # dashboard from source (http://127.0.0.1:4737)
pnpm --silent avalok recap <path>                 # CLI from source
```

Install the real package as a global command (what a user will get):

```bash
pnpm release:build --skip-smoke && npm install -g ./artifacts/release/avalok-0.1.0-alpha.1.tgz
```

Manual checks worth repeating before launch: open the dashboard in a repository where an agent ran (it should open straight into the newest session); Share dialog on a real session (recap card, interactive replay, diagram, Markdown; review each preview; Download works); `avalok recap`, `avalok recap --format html`, `avalok wrapped`; Claude Code live view after `avalok setup claude --apply`.

## Known gaps (not done or not verified)

- `recap`, `wrapped` and the dashboard landing read **Codex session files only**. Claude Code, OTLP and (future) Kiro/Cursor sessions are stored in Avalok's own run store (`telemetry-adapter`, user-data `runtime/`) and these commands do not read it yet. This is the first thing to fix (below).
- "System parts touched" in the recap is covered by an integration test through the real reconciliation, but has **not** been seen on a real session that edited service code (none of the sessions scanned edited recognized services). Worth one real check.
- PNG export is browser-only by design (no Node rasterizer). The Share preview is small for very large repositories. The GitHub Action PR bot and hosted links are post-launch or paid.
- Open question to the maintainer: what exactly looked like an "allow access" prompt on first launch? If it was an operating-system pop-up (not the old Getting Started dialog), it needs a README note.
- Maintainer-only (the agent must not do these): npm publish via the protected Release workflow (default dist-tag `latest` replaces the `0.0.1` placeholder), trademark search and filing, copyright holder choice, recording the demo GIF, making the repository public, enabling private vulnerability reporting.

## Next tasks, in order

### 1. Make `recap`, `wrapped` and the landing source-agnostic (recommended before launch)

Goal: any source Avalok has stored (Claude Code hooks, OTLP, future Kiro/Cursor) works with `avalok recap`, `avalok wrapped` and the "open the newest session from this repository" landing, not just Codex files.

- Introduce a small session-source abstraction in the CLI: list sessions (id, cwd, modified time, event count, source) and load a session as a `Run` plus execution graph. Implementations: Codex files (existing) and the stored runtime runs (`telemetry-adapter` store). Keep the shared selection helpers in `@visual-system/export` (`pickSessionForRepository`).
- Repository matching for stored runs: Claude hook runs carry `cwd`; OTLP runs may not, so they are only chosen by explicit `--session <id>`.
- Acceptance: tests with injected sources (a Claude-style stored run is recapped and appears in `wrapped`); the CLI and dashboard agree on which session is "latest"; no behavior change for Codex; leak tests still pass for the new source.

### 2. Launch assets and testing (L5, L6 in the plan)

README rewrite around the one loop; launch drafts (Show HN, X, Reddit); demo GIF (maintainer records it; the replay page is the best asset); a user-test script and 10 real users. Detail in [OPENSOURCE_LAUNCH_PLAN.md](OPENSOURCE_LAUNCH_PLAN.md).

### 3. After launch: more agent sources (Kiro, Cursor), then `avalok run`

Research done 2026-10-08 from documentation only; **payload shapes are unverified**, so the first step for each is capturing real payloads from the maintainer's machine.

Shared design:

- Both Kiro and Cursor integrate through **command hooks**: a script receives a JSON event on stdin. Neither has a built-in trace exporter that was confirmed (Cursor's Enterprise plan emits metrics and logs, not traces). Third parties (Langfuse, Arize, SigNoz, opentelemetry-hooks) all trace them by hooks. Avalok already has the local equivalent of Langfuse's collector (`127.0.0.1:4318`, OTLP plus the Claude hook receiver), so no new server is needed.
- Add one tiny, cross-platform forwarder subcommand (`avalok hook <tool>`): reads stdin, POSTs to the local collector with a short timeout, **always exits 0, never blocks the agent, never returns an allow/deny decision** (Cursor hooks can return permissions; Avalok stays strictly observational). It needs a global install (`npx` per event is too slow).
- Add a normalizer per tool in the collector (modeled on `claude-adapter`) and an `avalok setup <tool>` command with the same safety rules as `setup claude` (print-only default, confirm, backup, idempotent, `--remove`, tests in temp directories only).
- Persist hook runs in the run store so task 1's `recap`/`wrapped` and the landing work for them automatically.

Kiro:

- CLI: documented command hooks (agent config files, or `.kiro/hooks/<name>.json` in the v3 layout; events include prompt submit, pre/post tool use, stop; `matcher` selects tools). IDE: hooks look file-event oriented and no documented IDE log path was found, so start with the **CLI**. A third-party tool reads CLI sessions from `~/.kiro/sessions/cli/` (JSONL plus metadata) but the schema is undocumented. Prefer hooks; consider a file adapter only after confirming the format.

Cursor:

- Command hooks in `hooks.json` (project `.cursor/`, user `~/.cursor/`, or enterprise `/etc/cursor/`), hot-reloaded, all matching files run. Events: before/after shell, MCP, file read/edit, prompt submit, subagent, session and `stop`. A forum thread reports the **Cursor CLI sends fewer events than the IDE**, so make the **IDE** the primary target. First step: capture real payloads.

`avalok run -- <command>` (optional, after users ask): starts the command with the OpenTelemetry environment pointing at the collector so an app shows up live without manual config. Only works if the app has OpenTelemetry instrumentation.

Positioning decision: do not try to become Langfuse (hosted storage, teams, prompt management, evals). The wedge is a live local view tied to the repository's architecture; a hosted or team tier is the natural paid product and stays out of the open-source code.

Sources: [Kiro CLI hooks](https://kiro.dev/docs/cli/hooks/), [Kiro v3 hooks](https://kiro.dev/docs/cli/v3/hooks), [Cursor hooks](https://cursor.com/docs/hooks), [Cursor CLI missing events](https://forum.cursor.com/t/cursor-cli-doesnt-send-all-events-defined-in-hooks/148316), [Langfuse Kiro](https://langfuse.com/integrations/developer-tools/kiro), [Langfuse Cursor](https://langfuse.com/integrations/developer-tools/cursor), [Arize Kiro tracing](https://www.arize.com/docs/ax/integrations/platforms/kiro/kiro-tracing), [SigNoz Cursor](https://signoz.io/docs/cursor-observability), [opentelemetry-hooks](https://github.com/o11y-dev/opentelemetry-hooks), [kapm](https://pkg.go.dev/github.com/kapmcli/kapm).

### 4. Later (only if users ask)

Extra insights (blast radius, risk flags, touched-but-not-tested files), slower replay speed (0.25x) in the dashboard, the GitHub Action PR comment, and the paid cloud tier. See the plan.

## Working agreements

- Branch from `main`, open a PR, wait for CI on all three OSes, then merge. Never push directly to `main`, never run `npm publish`, never create tags or releases.
- Add tests for every behavior change; privacy-sensitive output needs a leak test. Do not claim anything that was not run; say what is unverified.
- Do not modify `~/.claude`, `~/.codex` or any user settings without a previewed, confirmed action; tests use temp directories only.
- Use "detected / observed / inferred" language; never claim complete understanding.
