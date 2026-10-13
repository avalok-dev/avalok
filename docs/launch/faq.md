# FAQ

Draft answers. Re-check every comparison against the other tool's current documentation before publishing.

## Why local?

Your code and your agent's sessions are sensitive, and the question "what did the agent just do here?" does not need a server. Avalok reads files already on your machine and shows them on `127.0.0.1`. There is no account to create and nothing to upload.

## Does it send my code anywhere?

No. Repository analysis parses files as data and never uploads source, calls an LLM or runs your code. The dashboard and receiver listen on loopback only, and outbound connections were measured before release with none to a non-loopback host ([docs/privacy.md](../privacy.md)). Exports are generated locally and previewed before saving. You can verify the listening addresses yourself with the command in the README.

## What does it read?

Your repository's source and configuration files (skipping `.env*`, Terraform state, `.tfvars`, lock files and `node_modules`), Codex session files read-only, and the Claude Code hooks and OpenTelemetry traces you choose to send to it. Full list: [docs/privacy.md](../privacy.md).

## How is this different from Langfuse, Phoenix and similar tools?

Those are observability platforms: they collect traces from applications, store them, and offer teams, history, evals and prompt management, often hosted or self-hosted as a server. They are good at that. Avalok is narrower: a single local command that ties what your coding agent did to your repository's architecture, then helps you share the result. It does not store history across machines, run evals or manage prompts, and it is not trying to. Some of those tools can also trace coding agents through hooks; if you already run one, you may not need Avalok. [FILL: confirm against each tool's current docs.]

## Why not just read the diff?

The diff is the right tool for reviewing code. Avalok answers different questions: which services and infrastructure did the session touch, what did it run, where did time go, what failed and was retried, and what can I show a teammate without sharing the transcript.

## Does it understand my whole system?

No, and it says so. It reports what it detected, observed and inferred, each with evidence and a confidence level. Runtime activity it cannot match to the architecture stays visible rather than being forced onto a node.

## Which agents and languages work?

Codex (session files, no setup), Claude Code (hooks via `avalok setup claude`, or OpenTelemetry), and any OTLP/HTTP trace source. Deep static analysis covers JavaScript/TypeScript and Python; Docker, Compose, Terraform, Kubernetes and Helm are parsed as configuration. Other languages are counted but not parsed. Kiro and Cursor are planned, see the [roadmap](../../ROADMAP.md).

## Will it change or block my agent?

No. Hooks are observational only. Avalok never returns an allow or deny decision and never writes to Codex's or Claude Code's directories. `avalok setup claude --apply` edits only your project's `.claude/settings.local.json`, after showing you the change and making a backup, and `--remove` undoes it.

## Is it free? Is there a paid version?

The local edition is free and open source (Apache-2.0). A hosted or team product may be built later as a separate thing; it would not change what the local edition does.

## What is the catch? It is an alpha.

Interfaces and data formats may change between alpha releases, and it has been tested on [FILL: platforms]. See the limitations in the README. Please tell us what breaks: `avalok feedback`.
