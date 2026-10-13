# Roadmap

Avalok is a developer preview. This page says what is planned, what is being considered, and what is deliberately not planned. It is a statement of intent, not a promise or a schedule.

## Now (before the first public release)

- Publish `0.1.0-alpha` to npm so `npx avalok` works.
- Test with real users of Claude Code and Codex; fix the top blockers they hit.
- A clearer first screen: your sessions first, sample projects and setup out of the way.

## Next (if people use it)

- More agent sources through hooks: **Kiro** (CLI first) and **Cursor** (IDE first). These need real hook payloads captured from real installs before any code is written.
- Insights on a session: what depends on the parts that changed, touched-but-not-tested files, and flags for sensitive areas (auth, payments, infrastructure, config). Each will cite its evidence.
- `avalok run -- <command>`: start an app with OpenTelemetry pointed at Avalok. Only useful for apps that already have OpenTelemetry instrumentation.
- A GitHub Action that posts the Markdown recap on a pull request.

## Considering

- Slower replay speeds, side-by-side comparison of two sessions, deeper language support in the analyzer beyond JavaScript/TypeScript and Python.

## Not planned in the open-source edition

- Accounts, hosted storage, team dashboards, prompt management or evals. Avalok is not trying to be a hosted LLM observability platform.
- Live connections to AWS, Kubernetes clusters, or cloud billing. Infrastructure analysis stays static and never runs `terraform`, `helm` or `kubectl`.
- Anything that sends your code, prompts or sessions off your machine, or that blocks or changes what your agent does.

A hosted or team tier may exist someday as a separate product. It is not part of this repository and will not change what the local edition does.

Want something here to move? Open an issue (`avalok feedback` prints a prefilled link) and say what you were trying to do.
