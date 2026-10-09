# Avalok open-source launch plan (free local edition)

Drafted 2026-10-06. **Progress 2026-10-08: L0, L1, L2 and L3 are done and merged to `main`; see [HANDOFF.md](HANDOFF.md) for the current state, next tasks and how to test.** This is the working plan for coding agents. It replaces the paid-cloud track as the active priority. **Avalok Cloud is paused** (see [Paused work](#paused-work)). Goal: a stranger can run one command, see something real in under a minute, produce an artifact worth sharing, and want to tell someone, all locally with no account.

Read `AGENTS.md` and `docs/PROJECT_CONTEXT.md` first. Every invariant there still applies. This plan adds work; it does not relax any rule.

## The one loop

> **Watch what your coding agent just did to your architecture, then share the recap.**

1. Run `npx avalok` in a repo while Claude Code or Codex works (or after it finishes).
2. The map shows which services, files and infrastructure the agent touched.
3. One click produces a recap people can post, attach to a PR, or put in a README.

Every task below must make this loop faster, clearer or more shareable. If a task does not, it is out of scope for the launch track. Lead copy and UI with this loop, not with "OpenTelemetry viewer" or "see your whole system". The generic OTel and infrastructure features stay, as supporting depth.

## Verified starting state (2026-10-06)

| Item              | State                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Milestones        | M1-M6 and M7.1-M7.4C complete. Branch `m7.4c-avalok` is 17 commits ahead of `main` (`main` is its ancestor); nothing from M7.x is merged to `main`. Working tree was clean before this plan was added. The `avalok-dev` org exists (created 2026-10-04, no public repos) and `origin` already points to it.                                         |
| Post-M7.4C work   | Local run findings, node/edge badges, reviewed run-export v1 JSON, offline OpenAI trace import, packed `@visual-system/schema@0.2.0-alpha.1` candidate. Last full verification of this work: 2026-10-03 (lint, typecheck, test, build, `release:build` 66/66). Two commits landed after (schema packaging, build order). **Re-verify in L0.**       |
| npm               | `avalok@0.0.1` is published as a **placeholder** (has a `bin: avalok`, no real code). `latest` is therefore the placeholder, so `npx avalok` runs the placeholder today. The repo's real package is `0.1.0-alpha.1`, unpublished. The folder the placeholder was published from is not in this repo; `~/avalok-try` is only a tarball install test. |
| GitHub            | Target is `avalok-dev/avalok`. The plain `avalok` GitHub name is an existing org the maintainer does not own. `product.json` has `"repository": null`.                                                                                                                                                                                              |
| Node requirement  | Root `engines` is `>=24.19.0 <25` and the published manifest copies it. A grep found **no Node-24-only API** in `packages/` or `apps/` source (only JSON import attributes, which Node 22 supports). The pin looks like a toolchain choice, not a runtime need. **Verify in L1.**                                                                   |
| Install size      | Tarball 1.87 MB, but about 350 MB installed. `next`, `react`, `react-dom`, `typescript` and `@cdktf/hcl2json` are external runtime dependencies (`externalRuntime` in `packages/cli/scripts/build-distribution.mjs`). `dist/dashboard` is already a Next standalone server (6.2 MB).                                                                |
| Exports           | Only `avalok.run-export` v1 JSON (content-free, previewed, local download) in `runs-panel.tsx`. No SVG/PNG diagram, no recap, no HTML replay, no badge.                                                                                                                                                                                             |
| Demo / first run  | Deterministic demo (`examples/demo-agent`), getting-started panel, synthetic test trace, `avalok doctor` exist.                                                                                                                                                                                                                                     |
| Claude Code setup | Needs manual env vars or hand-written HTTP hooks. This is first-run friction. Codex sessions are auto-discovered.                                                                                                                                                                                                                                   |
| Cloud repo        | `avalok-cloud` is at C1 (skeleton, handlers, migrations). Paused.                                                                                                                                                                                                                                                                                   |

## Hard rules for this track

- Everything stays local-first. No account, no analytics, no crash reporting, no update check, no non-loopback connection from the packaged product. The zero-outbound-connections smoke check must keep passing.
- Static analysis stays non-executing and read-only (see `AGENTS.md`).
- Do not add cloud code, authentication, billing, or upload clients to this repo.
- **Never run `npm publish`, create GitHub releases, or push tags.** Publication happens only through `.github/workflows/release.yml` with explicit maintainer approval. Prepare artifacts and checklists; the maintainer publishes.
- Do not modify the user's `~/.claude` or `~/.codex` files without an explicit, previewed, user-confirmed action. Default is print-only.
- Exports are opt-in, previewed before download, and never include prompts, completions, secret values, absolute paths, or raw spans. Use language "detected / observed / inferred", never "complete".
- Preserve existing UI and Demo / Codex behavior unless a task says otherwise.
- Keep the tarball small and the install fast. Any new runtime dependency needs a size and license justification in the PR/commit message.
- Add focused tests for each behavior change; run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before handoff; run `pnpm release:build` after anything the installed package loads.

## Phases

Do them in order. Each phase ends with a gate. Do not start the next phase until the gate passes, unless marked parallel.

### L0 - Baseline and branch hygiene

Goal: know exactly what works before changing anything.

- [x] (done 2026-10-06) Run the full verification (`format:check`, lint, typecheck, test, build) and `pnpm release:build`. Record actual results in `docs/releases/developer-preview.md` (replace stale numbers; do not claim anything not run).
- [x] (done 2026-10-06, fast-forward possible; maintainer merges) List every difference between `m7.4c-avalok` and `main`. Propose merging to `main` (the maintainer approves and pushes). Update the checklist item "branches merged to `main`".
- [x] (done 2026-10-06, except live-session replay and failure coloring, still open) Do a manual pass in a browser: Demo, current repository, a historical Codex session, Live, findings, failure coloring (the 2026-10-03 pass did not visually exercise failure coloring).

**Gate:** all commands pass; results recorded; merge proposal written.

**L0 manual-pass findings (2026-10-06, source build, 1024x768 pane, no console errors).** Demo, current repository (26 entities), a historical Codex session (381 events, execution overlay, 22 failed and 21 slow-step findings) and Prepare export all worked. Issues found, each owned by a later phase:

1. **L1/L2:** Runs says "No runs yet" with a "Connect telemetry" button while the Setup panel reports 154 Codex sessions. A user with Codex sessions should land on their latest session, or at least see "Open your latest Codex session".
2. **L1/L2:** the Codex session picker is one flat list of 154 entries that all show the same project-folder name plus a date. Add a "latest" shortcut, grouping by day or repository, and a human-readable label.
3. **L1:** at about 1024 px wide the source name overlaps the Map button in the header. Fix the narrow layout. **Fixed 2026-10-06 in code (the mode switcher is only absolutely centered from the `xl` breakpoint up); not yet re-checked visually because the browser pane was not displayed.**
4. **L3 (privacy):** a run's title is the raw first user prompt, and it can include attachment file paths. Exports, recaps and the HTML replay must never include run titles or prompt text. Add this to the leak tests.
5. **Minor:** the console logs a React Flow warning ("parent container needs a width and a height") on first render.
6. **Still unverified:** live-session replay and failure coloring (a click on "Replay run" showed no visible change in the pane; recheck by hand).

### L1 - Easy install ("npx avalok works for everyone")

Goal: first command succeeds on a clean machine, on current Node LTS, quickly.

1. **Landing without asking for anything (maintainer decision 2026-10-06, top priority).** The first screen must never look like a permission or consent request. Avalok collects nothing and asks for no access, so the UI must not imply otherwise.
   - Remove the auto-opening "Getting started" modal on first launch. Setup stays available from a **Setup** button the user opens on purpose.
   - Remove "Connect telemetry" as the primary call to action in empty states (Runs, Live, source panel). Replace with direct actions: "Open your latest Codex session", "Pick a session", "Explore the demo".
   - Landing rule: if local Codex or Claude Code sessions exist, open straight into the most recent one over the repository map (with a clear way to switch). If none exist, show the repository map and an inline picker of what is available (sessions, the current repository, the demo). Never an empty screen, never a modal blocking the first view.
   - Copy audit: remove or reword anything that sounds like "allow", "enable", "authorize", "connect your account" or "collect". Add one plain line where it helps: "Everything stays on this machine. Avalok reads local session files and sends nothing anywhere."
   - OpenTelemetry setup (ports, env vars) moves under Setup > "Other tools" and is only shown when the user asks.
   - Add a UI test that the first load has no modal and no telemetry/permission wording, and a test for the landing rule above.
   - **Status 2026-10-06 (implemented, verified in the packaged build):** no auto-opening dialog; landing rule in `apps/web/src/lib/landing.ts` (newest session from this repository, else the repository map with the picker open); empty Runs/Live/Map states offer "Choose a session" and "Explore the demo"; "Connect telemetry" renamed to "OpenTelemetry setup" and kept only inside Setup and one quiet line in the picker; picker is newest-first with an "In this repository" group and a time and event count per row; guard tests in `apps/web/tests/{landing,first-run-copy}.test.ts`; `release:build` smoke 66/66. Still to do here: the OS-prompt question below, the narrow-width header overlap (L0 finding 3), and re-checking the Live empty state by hand.
   - Open question for the maintainer: what exactly looked like a permission prompt? It may have been the Getting Started dialog, or an operating-system prompt (for example macOS asking about files or network access). Identify which; an OS prompt cannot be removed by UI changes and needs a README note instead.
2. **Remove the Node 24 requirement from the published package.** **Status 2026-10-06: done and verified locally.** The published range is `>=22.12.0` (`product.json#nodeRange`), the dev pin stays Node 24.19, and the full installed smoke passes 66/66 on Node 22.23.3 and 24.19.0. The friendly unsupported-Node message already existed (now updated and unit-tested). CI: a Node 22 installed-smoke step was added to `distribution.yml` for all three OSes; it is verified only after the first CI run. Details below stay as the original task description.
   - Test the packaged product on Node 22 (current maintenance LTS) and 24; Node 20 is end-of-life, so do not target it unless free. Local machine has Node 20.14, 23.9 and 24.19 available for testing.
   - Split the development toolchain pin (`.node-version`, root `engines`, Next dev) from the published package's `engines`. Set the published range to the lowest version that passes the full installed smoke (expected `>=22`).
   - Add Node 22 and Node 24 to the distribution CI matrix on all three OSes.
   - On an unsupported Node, fail early with a friendly message that says which version is needed and how to get it (not a stack trace). Add a test.
3. **Reduce install size and time.** **Status 2026-10-06: first step done and verified.** The dashboard now ships Next's pruned runtime modules as a flat, real-file `dashboard/node_modules` (no compiler binary, no sharp), and `next`, `react` and `react-dom` are no longer installed by npm. Clean install: **344 MB to 67 MB**; tarball 1.9 MB to about 8 MB; installed smoke 66/66 on Node 22 and 24. Remaining option: bundle `typescript` into the CLI (about 23 MB). Linux and Windows sizes and the cold network first-run time are not yet measured. Original task description follows.
   - Measure first: record installed size and cold `npx avalok@<tarball>` time on a clean directory. Report numbers before and after.
   - Investigate, in this order of expected value: (a) trace the Next standalone output so the dashboard ships only what it needs and stop installing the full `next` package; (b) bundle `typescript` (parser only) into the analyzer bundle instead of installing it as a runtime dependency; (c) check `react`/`react-dom` duplication.
   - Targets (aspirations to verify, not promises): installed size well under 150 MB; cold first run under about 60 seconds on ordinary broadband. If a target is not reachable, document why and what was achieved.
4. **First-run commands and diagnostics.** **Status 2026-10-06: `avalok demo` done and verified in the packaged build (opens the built-in demo from an empty folder with no dialog); README documents the landing behavior and the demo. `avalok doctor` already reports node, repository, sources and ports; shortening its output is still open.**
   - `avalok` with no args in a repo must show a real map within about 10 seconds on a typical repo (the landing rule above decides which view).
   - Add `avalok demo` (or confirm `avalok --demo`): opens the bundled demo with no repository needed.
   - Keep `avalok doctor`. Make its output actionable and short.
5. **Placeholder replacement plan (document, do not publish).** **Status 2026-10-06: documented in the release checklist (dist-tag step added; the workflow default `latest` takes over from the placeholder).** The `latest` dist-tag currently points to the `0.0.1` placeholder. Add to the release checklist: publish `0.1.0-alpha.N` with the intended dist-tags, then verify `npm view avalok dist-tags` and that `npx avalok@latest --version` works from a clean directory before announcing. Update `.github/workflows/release.yml` and `docs/development/release-build.md` if they assume a different tag.
6. **README quick start** becomes: `npx avalok`, with Node versions stated honestly, plus the build-from-clone path in a collapsed section.

**Gate:** clean-machine install and first run verified on macOS, Linux and Windows CI (Node 22 and 24); installed size and first-run time reported; unsupported-Node message tested; zero-outbound-connections check passes.

### L2 - Agent setup without friction

**Status 2026-10-06/07: implemented and verified end to end in a scratch project.** `avalok setup claude [path]` prints the hooks (writes nothing); `--apply` shows a summary, asks to confirm (`--yes` when not interactive), backs up an existing file, merges only Avalok's entries and writes atomically; `--remove` undoes it; invalid JSON is never edited; idempotent; port follows `--otlp-port`; `avalok setup codex` explains there is nothing to set up and shows the session count. 15 new tests use temp directories only. The dashboard's Claude source now says to run `avalok setup claude`. Not done: a copy button and a live "waiting for first event" indicator inside the Setup panel, and a documented manual run with a real Claude Code session (needs the maintainer).

Goal: Claude Code and Codex users get value without reading telemetry docs.

- [ ] `avalok setup claude`: **print** the exact hook / OTel configuration for the user's Claude Code settings and where to put it. Add an explicit `--apply` that shows a diff and asks for confirmation before editing any settings file, makes a timestamped backup, and is idempotent and reversible (`avalok setup claude --remove`). Default never writes.
- [ ] Setup panel in the dashboard shows the same snippet with a copy button and a live "waiting for first event / connected" indicator.
- [ ] Codex: confirm discovery messaging says how many sessions were found and which one is shown by default (most recent). Counts only; no paths in screenshots or exports.
- [ ] Keep generic OTLP guidance secondary, under "Other tools".

**Gate:** documented manual run with real Claude Code and real Codex; tests for config generation, backup, idempotency and removal using temp directories only (never the real home).

### L3 - The shareable artifacts (the viral core)

**Status 2026-10-08: implemented and verified on real sessions; on branch `l3-shareable-artifacts`, not yet merged.**

- Done: active-resource glow (`deriveDwellState`, pure and tested; verified live on a real Codex session); diagram SVG/PNG, recap card, interactive HTML replay and Markdown summary (new `@visual-system/export` package, Share dialog with preview, anonymize and brand toggles); weekly "wrapped" card (`avalok wrapped`); CLI `avalok recap --format md|svg|html|diagram`; README embed hint for diagrams.
- Privacy is enforced by tests, not just intent: a leak test feeds paths, secrets, credentialed URLs, run titles and prompts through every output; labels are reduced or redacted; pages and images contain no scripts, links or external references; the replay page's embedded glow algorithm is checked against the dashboard's for parity.
- Bugs found by testing on real data and fixed: `safeLabel` redacted long paths as secrets; duplicate React keys after adding line numbers (the key test failed on the old formula); `wrapped` counted months-old steps of resumed sessions (it now counts only steps inside the window, per local day).
- Not done / known limits: PNG is browser-only (no Node rasterizer by design); `recap`/`wrapped` read Codex sessions only (Claude Code sessions are observed live through hooks and OTLP, not read from files); the Share dialog preview for very large repositories is small; the GitHub Action PR bot is post-launch; no hosted links by design.
- Not yet verified: the new commands under Node 22 and on Linux/Windows (CI will run the installed smoke), and a real-world check of "system parts touched" on a session that edited service code (covered by an integration test through the real reconciliation, but none of the 14 sessions scanned here edited recognized services).

Goal: normal use produces something people want to post. All generation is local, previewed, and works offline. Put shared rendering code in a new package or an existing reusable package (not inside React components), with tests.

Build in this order (each is independently shippable):

0. **Active-resource glow (prerequisite for the HTML replay and the demo GIF).** Today the map shows only traffic moving along connections. Add a glow on the node where the agent currently is, so a viewer always knows where time is being spent.
   - Define "active" from replay data: a node is active at time t while it has an in-flight span or an open tool/command/model call (start without end), plus a short fade after it ends. Where no duration exists, use a brief pulse, never a fabricated dwell time.
   - Make long steps visibly longer: the glow stays on for the whole span, so slow steps read as slow. Consider a subtle intensity cue for steps over the slow threshold, consistent with the findings (observed, not a production alert).
   - Works in Live, replay and scrubbing (seek must show the correct glowing node), and respects reduced-motion settings (static highlight instead of pulsing).
   - Implement the active-set derivation as a pure function in the replay/graph packages with tests; the UI only renders it. The HTML replay and recap reuse it.

1. **Architecture diagram export (SVG first).** Clean, sanitized, readable at README scale. Show a preview where the user reviews names and labels before saving; default excludes absolute paths, prompts and secret-like values. Offer an "anonymize labels" toggle. Provide PNG by rendering the SVG in the browser (canvas), not by adding a heavy native/headless dependency.
2. **Session recap card.** After a Codex or Claude session: duration, number of files and services touched, commands run, tests run, failures and retries, and the services most affected. A single image sized for social and PR use (SVG/PNG). Includes a small, clear "Made with Avalok - avalok.dev" footer, on by default and removable with an explicit flag/toggle. Only show what was observed; mark unavailable data as unavailable.
3. **Interactive HTML replay.** One self-contained `.html` file (no network, no external assets) containing the map and a scrubbable timeline of the session, so anyone can open it in a browser without installing anything. Same privacy review step and same content rules as the other exports. Size budget: document it and keep it reasonable (aim for a few MB at most for typical sessions; truncate or sample explicitly and say so, never silently).
4. **Weekly "wrapped" stats card (local only).** Computed from local Codex/Claude session files the user already has: sessions, files touched, commands, most-touched service, longest session, busiest day. Counts only, never content. Rides curiosity about oneself; the output is the ad.
5. **README badge and architecture embed.** `avalok badge` / `avalok diagram --readme` writes a static SVG into the repo (e.g. `docs/architecture.svg`) plus the Markdown snippet. Static file, no hosted service, no tracking.
6. **Markdown summary for PRs.** `avalok recap --format md` prints a concise "what the agent changed architecturally" block (services touched, risky areas, tests) that a person or a CI step can paste into a PR. No network. (A GitHub Action wrapper around this is post-launch work; do not build hosted components.)

Shared requirements:

- One command-line surface: `avalok recap [--session <id|latest>] --format svg|png|html|md [--out <path>] [--no-brand]`, matching the dashboard buttons.
- Every export goes through the privacy preview; nothing is written or opened without a user action.
- Golden-file tests (deterministic output for the demo run); a leak test that fails if absolute paths, home directory, usernames or secret-like strings appear in any export of the fixtures.
- Accessibility: exported SVG/HTML has titles/alt text and sufficient contrast.

**Gate:** each artifact generated for the demo and for a real Codex session, reviewed by eye; leak tests pass; works offline; installed-package smoke covers at least the CLI recap path.

### L4 - Make people come back (daily-use value)

Goal: turn the one-time wow into a habit. Still local, still evidence-based, still "observed / inferred", never "complete".

1. **Blast radius.** For a session, show what changed and what depends on it (use the existing graph and reconciliation; do not invent edges).
2. **Risk flags.** Highlight when a session touched sensitive areas (authentication, payments, infrastructure/IaC, environment/config files, datastore schemas, CI). Each flag cites its evidence; rules are reusable detectors with fixtures, not hard-coded to this repo.
3. **Touched but not tested.** Files or services changed in a session with no test activity observed.
4. **Session replay polish.** Smooth scrubbing, keyboard shortcuts, sticky selection. Speed control currently offers 0.5x, 1x, 2x and 4x. Slower playback (for example 0.25x) is a cheap addition and is expected to matter for demos, but it is optional: add it when users ask or when recording the demo GIF shows it is needed.
5. **Agent compare (stretch).** Two sessions on the same repository side by side. Only if L3 is done and time remains.

**Gate:** each feature has fixtures and tests; findings never claim certainty; unavailable data is labeled.

### L5 - Launch assets and repository readiness

Agent-doable:

- [ ] Rewrite the root README around the one loop. Lead with the demo GIF placeholder, a 3-line quick start, a short "what it is / what it is not", the privacy promise (with how to verify it), and the supported-sources table lower down.
- [ ] `docs/launch/` drafts: Show HN post, X thread, Reddit posts (r/ClaudeAI, r/ChatGPTCoding), a short blog post ("What 100 agent sessions did to my codebase" outline), newsletter pitch, FAQ ("Why local?", "How is this different from Langfuse/Phoenix/diagram tools?", "Does it send my code anywhere?"). Honest comparisons only; no unverifiable claims.
- [ ] Issue templates and labels (`good first issue`, `adapter`, `analyzer`, `docs`), a `ROADMAP.md` that names what is planned and what is not, a short `CODE_OF_CONDUCT` only if the maintainer provides a contact.
- [ ] Trademark note in the README (Avalok name and logo are not licensed by Apache-2.0) and a lightweight contribution sign-off policy (DCO) in `CONTRIBUTING.md`, pending maintainer choice.
- [ ] A scripted demo recording plan (exact commands, a fixture repo, a scripted session) so the GIF is reproducible.
- [ ] A user-test script (below) and a feedback path that needs no telemetry: `avalok feedback` prints or opens a prefilled GitHub issue link; nothing is sent by the tool.

Maintainer-only (the agent prepares, the maintainer does):

- Record the demo GIF/video; choose the final logo.
- Finalize the GitHub org (`avalok-dev`) and set `product.json#repository`; enable private vulnerability reporting; commit identity is already the GitHub noreply address (verified 2026-10-06), so no history rewrite is needed; review `AGENTS.md` for the machine-specific runtime note before the repo is public.
- Choose the copyright holder (LLC or individual) and add a `NOTICE` line if desired.
- Trademark search and USPTO filing; domain and handle reservation.
- npm account 2FA and trusted publishing; run the Release workflow; approve publication.
- Post the launch and respond to threads.

**Gate:** README and launch drafts reviewed by the maintainer; release checklist updated with the true state.

### L6 - Test with real people before announcing

- Get 10 developers who use Claude Code or Codex daily to install from the release candidate. Watch or screen-record where they hesitate. Fix the top blockers.
- Questions to ask: What were you trying to do? What did you expect to see? What surprised you? Would you be upset if this disappeared? Who else should see it? What would make your team pay for it? (Record answers in a private notes file, not in the repo.)
- Track: install success rate, time to first map, time to first export, how many exported something, how many came back the next day.
- Launch only when most testers get a map and an export without help.

**Gate:** top blockers fixed; at least several testers say they would miss it.

## Launch order (maintainer-driven)

1. Merge to `main`, publish the real package per the release checklist, and verify `npx avalok` from a clean machine.
2. Soft launch to the L6 testers and a few communities; fix anything that breaks.
3. Public launch: Show HN (weekday morning US time), X thread with the GIF, Reddit, then Product Hunt a few days later.
4. For two weeks: ship weekly, answer every issue within a day, post recaps made from real sessions.

Success bar for the first month (guides, not guarantees): several hundred GitHub stars, around 100 weekly active installs (measured only by opt-in signals such as GitHub stars, issues, npm download counts and direct conversations), and about 20 people who say they would miss it.

## What stays free and what is saved for later

Free forever (local, one person, one machine): the map, replay, findings, all exports in L3, the setup helpers, unlimited local runs, all adapters.

Later and paid (only after users ask and a buyer is validated; none of it is part of this track): hosted history across machines, private share links with access control, team dashboards, persistent alerts, the PR bot with organization policy, SSO/RBAC/audit/retention controls, cross-team cost analytics, live cloud or cluster connections. See `docs/PRODUCT_PLAN.md` and the paused cloud plan.

## Backlog added 2026-10-08

Details, ordering and research sources are in [HANDOFF.md](HANDOFF.md) (next tasks 1 and 3).

- **Before launch (recommended):** make `recap`, `wrapped` and the landing read every stored source (Claude Code hooks, OTLP), not only Codex files.
- **After launch:** a shared, non-blocking `avalok hook` forwarder, then **Kiro** (CLI first) and **Cursor** (IDE first) as hook-based sources with `avalok setup kiro` / `avalok setup cursor`; capture real hook payloads from the maintainer's machine before writing normalizers. Then optionally `avalok run -- <command>` to point an app's OpenTelemetry at the local collector.
- **Decision:** the live, local view tied to the repository's architecture is the wedge; do not try to become Langfuse. A hosted or team tier stays the paid product.

## Paused work

- **Avalok Cloud** (`../avalok-cloud`, plan C0-C8): paused as of 2026-10-06 at C1. Reason: no validated buyer yet, and the open-source launch comes first. Do not extend it in this track. Resume only after the open-source launch produces real demand signals. The public run-export v1 contract and `@visual-system/schema` packaging stay in this repo and must not be broken, because the paused cloud repo depends on them.
- **Dots integration, cost analytics, run comparison, AI debugging, PR architecture checks (hosted), live AWS/cluster data**: deferred; listed in `docs/PRODUCT_PLAN.md`.

## Definition of done for the launch track

- A stranger on a clean machine can run `npx avalok` on a current Node LTS and see a real map in about a minute.
- A Claude Code or Codex user can connect without reading telemetry documentation.
- Diagram, recap card, interactive HTML replay and Markdown summary can be produced locally with a privacy preview, with leak tests passing.
- README, launch drafts and release checklist are accurate to what actually ships.
- The maintainer's publication and legal steps are listed, current and unchecked until performed.
