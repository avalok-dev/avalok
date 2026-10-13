# X and Reddit drafts

Attach the demo GIF ([demo-recording.md](demo-recording.md)) to the first post of each. Post only after publishing. Replace each `[FILL: ...]`.

## X thread

1. Your coding agent finished. What did it actually do to your architecture?
   Avalok maps your repo, then shows what Claude Code or Codex touched, ran and broke. Local, one command: `npx avalok` [GIF]

2. It reads your repo as data (services, datastores, Terraform, Kubernetes, Docker) and overlays the agent session on that map. Parts it touched light up; slow steps stay lit longer.

3. One click makes a recap you can share: a card, a single-file interactive replay anyone can open, a diagram, or a Markdown block for your PR. You preview it first. No prompts, commands or file paths in it. [image of a recap card]

4. Local only: binds to 127.0.0.1, no account, no analytics, no outbound connections (measured before release), never runs your code.

5. Honest limits: alpha; deep analysis for JS/TS and Python; infra from config, not live state; Kiro and Cursor not yet. [FILL: repo link] Tell me what looks wrong on your repo: `avalok feedback`.

## r/ClaudeAI

**Title:** I built a local dashboard that shows what Claude Code did to your project's architecture (free, open source)

I wanted to know which services and infrastructure a Claude Code session had actually touched, not just which files. Avalok maps the repo, then uses Claude Code hooks (`avalok setup claude` prints the config and writes nothing unless you pass `--apply`) to overlay the session. You can export a recap card, interactive replay or a Markdown summary for a PR; exports exclude prompts, commands and paths, and you preview them first.

Hooks are observational only: it never blocks or changes Claude Code. Everything stays on your machine. Alpha; `npx avalok`. [FILL: link]. What would make this useful in your workflow? What is missing?

## r/ChatGPTCoding

**Title:** Free local tool: see which parts of your system a Codex or Claude Code session touched

Same pitch, different angle: Codex needs no setup, Avalok reads your local session files read-only and opens the newest session that ran in the repo you start it in. Recap, replay, diagram and Markdown exports for sharing. Open source, no account, nothing leaves your machine. [FILL: link] I would like to hear what it gets wrong on your repos.

## Reddit rules

Check each subreddit's self-promotion rules the day you post and follow them. Do not cross-post identical text at the same minute. Reply to every comment, including critical ones.
