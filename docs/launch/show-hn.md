# Show HN draft

Post on a weekday morning US time, after publishing and after the L6 testers have had a chance to break it. Replace each `[FILL: ...]`.

## Title (pick one, under 80 characters)

- Show HN: Avalok, see what your coding agent did to your architecture
- Show HN: Avalok – a local map of what Claude Code or Codex just changed

## Post

I kept finishing agent sessions without knowing what they had actually touched. The diff shows files, not which services, datastores or infrastructure those files belong to, or where the session spent its time and what failed.

Avalok is a local dashboard for that. In a repository it statically maps the architecture (services, datastores, Terraform/Kubernetes/Docker config), then overlays what your agent did from Codex's session files or Claude Code hooks: which parts it touched, what it ran, what was slow, what failed. One click turns a session into a recap card, a single-file interactive replay, a diagram or a Markdown block for a PR description.

    npx avalok

Things I tried to get right:

- Local only. It binds to 127.0.0.1, has no account or analytics, makes no outbound connections (I measured this before release; method in docs/privacy.md), and never runs your code. Static analysis parses files as data.
- Exports never include prompts, commands, file paths or secret-looking values, and you see a preview before anything is saved. There are leak tests for every format.
- It says "detected", "observed" and "inferred", with evidence and a confidence level. It does not claim to understand your system, and runtime activity it cannot match to the architecture stays visible instead of being forced onto a node.

What it is not: a hosted LLM observability platform. No teams, stored history, evals or prompt management. [FILL: one sentence on how you think about the difference, e.g. "If you want traces from a production app across a team, use a platform built for that; this is the quick local look at what your agent just did to one repo."]

Limits today: deep analysis covers JavaScript/TypeScript and Python (other languages are inventory only), infrastructure is read from config rather than live state, and Kiro and Cursor are not supported yet. It is an alpha. [FILL: platforms and Node versions you tested.]

Code (Apache-2.0): [FILL: repo link]. I would especially like to hear what looked wrong or confusing on your own repository, `avalok feedback` prints an issue link.

## First comment (post right after, from your account)

Some background that did not fit above: [FILL: what you were building when you needed this, 3 to 5 sentences, true and specific]. The part I am least sure about is [FILL: e.g. how well the architecture map matches repositories that are not JS/TS or Python]. If you try it on a repo like that, I want to hear how it went.

## Likely questions, with the honest answer

See [faq.md](faq.md). Have the answers on "how is this different from Langfuse/Phoenix", "does it send my code anywhere" and "why not just read the diff" ready.
