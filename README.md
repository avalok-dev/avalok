# Avalok

**Watch what your coding agent just did to your architecture, then share the recap.**

Avalok is a local-first dashboard. It maps your repository's architecture (services, datastores, infrastructure), then overlays what your coding agent actually did: which parts it touched, what it ran, where it spent time and what failed. One command, no account, nothing leaves your machine.

![Avalok showing the architecture of a sample platform: services, datastores, and AWS/Kubernetes deployment configuration on one canvas](docs/assets/avalok-overview.png)

> **Developer preview (`0.1.0-alpha.2`).** Run `npx avalok` in a repository. Interfaces and data formats may change between alpha releases. To build from a clone instead, see [Try it today](#try-it-today).

## The loop

1. **Run Avalok in a repository** while Claude Code or Codex works (or after it finishes): `npx avalok`.
2. **See where the agent went.** The map shows which services, files and infrastructure it touched, and the session opens straight away if one ran in this repository.
3. **Share the recap.** One click (or `avalok recap`) produces a card, an interactive replay, a diagram or a Markdown block for your pull request. You review it first; nothing is uploaded.

## Quick start

Requires Node.js **22.12 or newer** (tested on Node 22 LTS and Node 24 LTS).

```sh
npx avalok          # in your repository: map it and open the dashboard
```

That is all for Codex: Avalok reads its session files read-only. For Claude Code, run `avalok setup claude` once (it prints the settings and writes nothing; `--apply` adds them after you confirm). No agent handy? `avalok demo` opens a built-in demo.

```sh
avalok recap        # Markdown summary of the newest agent session in this repo (paste into a PR)
avalok wrapped      # your agent week as a card (counts only)
avalok doctor       # check the setup without starting anything
avalok feedback     # print a prefilled GitHub issue link (nothing is sent)
```

Avalok starts a dashboard at `http://127.0.0.1:4737` and a local receiver at `http://127.0.0.1:4318`, and opens your browser. Press Ctrl+C to stop.

### Try it today

Avalok is not on npm yet. Build the release candidate from a clone (needs Node 24.19 and pnpm 11.19, see [CONTRIBUTING](CONTRIBUTING.md)):

```sh
pnpm install --frozen-lockfile
pnpm release:build --skip-smoke          # -> artifacts/release/avalok-0.1.0-alpha.2.tgz
npm install -g ./artifacts/release/avalok-0.1.0-alpha.2.tgz
cd /path/to/your/repository
avalok
```

## What it is, and what it is not

**It is** a local view of your repository's detected architecture with your agent's observed activity on top, and a way to turn a session into something you can share. Every element carries evidence and a confidence level; Avalok says "detected", "observed" and "inferred", and does not claim to understand your whole system.

**It is not** a hosted observability platform. There are no accounts, teams, stored history across machines, prompt management or evals, and no cloud or cluster connection. It does not run, build or install anything from your repository, does not call an LLM, and does not block or change what your agent does. It reads what already exists on your machine.

## Privacy, and how to check it

- Everything runs on your machine. The dashboard and receiver bind to `127.0.0.1` only.
- No Avalok cloud service, account, analytics, crash reporting or update check.
- Repository analysis never executes your code, never uploads source, never calls an LLM.
- Exports never include prompts, run titles, commands, file paths or secret-looking values, and you see a preview before anything is saved.

Check it yourself rather than taking our word:

```sh
avalok demo --no-open &          # then, on macOS or Linux:
lsof -nP -iTCP -sTCP:LISTEN | grep -E ":(4737|4318)"     # both show 127.0.0.1, not * or 0.0.0.0
```

Outbound connections were also measured before release and none to a non-loopback host were attempted ([how](docs/privacy.md)). The code is open (Apache-2.0). Details: [Privacy](docs/privacy.md) · [Security](SECURITY.md) · [Local HTTP security](docs/security/local-http.md) · [Threat model](docs/security/threat-model.md).

## How it works in depth

| Layer              | How                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Architecture**   | Static analysis of source and configuration files: services, routes, model/tool/datastore integrations, dependencies |
| **Infrastructure** | Terraform, Kubernetes, Helm, Docker, and Compose files, parsed as data, including inferred AWS relationships         |
| **Agents**         | Local Codex and Claude Code sessions, read from their own session files with no setup; OpenTelemetry traces optional |
| **Runtime**        | OpenTelemetry traces (OTLP/HTTP protobuf or JSON), with OpenInference semantics for LLM, tool, and retrieval spans   |

Every detected element carries **evidence** (the file and reason it was detected) and a **confidence** level. Avalok reports what it detected and observed; it does not claim complete understanding of your system.

### Architecture

Avalok parses JavaScript/TypeScript (TypeScript compiler API, syntax only) and Python (`@lezer/python`) without importing, running, or installing anything from your repository. It groups code into service units (workspace packages, Python projects, container build contexts) and shows the system at service level. Files appear in the inspector, not as thousands of nodes.

### Live runtime

Runtime activity is normalized into one event model and replayed on the same canvas: Map, Live, and Runs views; a timeline with seek and speed; an inspector with raw and normalized data. Reconciliation matches runtime activity to architecture entities by path, workspace ownership, and route or integration identity. Anything it cannot match (terminal commands, model calls, MCP tools) stays visible instead of being forced into a match.

### Infrastructure intelligence

Terraform (HCL and JSON), Kubernetes manifests, Helm charts (bounded static values substitution), Dockerfiles, and Compose files are parsed as data. Avalok infers AWS resource relationships and links application services to their configured deployment (container → Kubernetes workload → cluster → cloud).

**This is configured architecture, not live state.** Avalok does **not** connect to AWS APIs, Kubernetes clusters, CloudWatch, Prometheus, or cost services. It never runs `terraform`, `helm`, `kubectl`, or cloud CLIs, and never reads `.tfvars` or Terraform state; Kubernetes Secret and secret-like configuration values are discarded.

## Supported sources

| Source                                               | Static architecture | Runtime observation | Configuration inference | Notes                                                            |
| ---------------------------------------------------- | :-----------------: | :-----------------: | :---------------------: | ---------------------------------------------------------------- |
| JavaScript / TypeScript                              |          ✓          |  via OpenTelemetry  |            —            | Imports, routes, AI SDK, datastore and HTTP integrations         |
| Python                                               |          ✓          |  via OpenTelemetry  |            —            | FastAPI, Flask, Django routes; PEP 621, Poetry, requirements     |
| Docker                                               |          ✓          |          —          |            ✓            | Dockerfile structure, ports, build ownership                     |
| Docker Compose                                       |          ✓          |          —          |            ✓            | Services, dependencies, ports; environment values discarded      |
| Terraform                                            |          ✓          |          —          |            ✓            | Resources and references; no state, `.tfvars`, or providers      |
| Kubernetes                                           |          ✓          |          —          |            ✓            | Multi-document manifests; Secret values discarded (keys only)    |
| Helm                                                 |          ✓          |          —          |            ✓            | Direct `.Values` substitution only; no `helm template`           |
| AWS                                                  |          —          |          —          | ✓ (from configuration)  | Inferred from Terraform/Kubernetes; no AWS API access            |
| Codex                                                |          —          |          ✓          |            —            | Local session files: history and live tailing, read-only         |
| Claude Code                                          |          —          |          ✓          |            —            | Its local session files (no setup); optional hooks and traces    |
| OpenTelemetry                                        |          —          |          ✓          |            —            | OTLP/HTTP traces, protobuf or JSON (no gRPC, metrics, or logs)   |
| OpenInference                                        |          —          |          ✓          |            —            | Agent, chain, LLM, tool, retriever, embedding, and related spans |
| Go, Java, Kotlin, Rust, Ruby, PHP, C#, Swift, C, C++ |   inventory only    |  via OpenTelemetry  |            —            | Files are counted and grouped, not parsed                        |

## OpenTelemetry

Point any OTLP/HTTP trace exporter at Avalok. No Collector is needed:

```sh
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf   # or http/json
```

The standard Python exporter (`opentelemetry-exporter-otlp-proto-http`) works as-is; see [`examples/python-otel-direct`](examples/python-otel-direct). The dashboard's **Setup → OpenTelemetry setup → Send Test Trace** sends a clearly labeled synthetic trace to prove the path. Generic HTTP/database spans stay generic; only OpenInference or GenAI semantics are shown as agent activity.

## Codex

Avalok discovers Codex session files in `~/.codex/sessions` (or `$CODEX_HOME`), replays them, and tails active sessions live. It shows commands, file changes, MCP calls, model responses, and errors. It never reconstructs hidden reasoning and never writes to Codex's directory. There is nothing to set up; `avalok setup codex` shows how many sessions Avalok can read.

## Claude Code

There is nothing to set up. Avalok discovers the session files Claude Code already writes to `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR`), replays them, and follows running sessions live. Access is read-only, and sessions started in a parent folder of your repository are listed too. Two optional extras push events as they happen:

- **Traces:** launch Claude Code with `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_TRACES_EXPORTER=otlp`, and `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces`.
- **Hooks (optional):** run `avalok setup claude` in your project to see the exact settings. It writes nothing; `avalok setup claude --apply` adds them to the project's `.claude/settings.local.json` after you confirm (existing files are backed up first, `--remove` undoes it). Or add `"type": "http"` hooks pointing at `http://127.0.0.1:4318/v1/claude/hooks` yourself.

Hooks are observational only; Avalok never blocks or changes Claude Code. Full configuration: [docs/architecture/claude-code.md](docs/architecture/claude-code.md).

## Share what your agent did (details)

Everything below is generated on your machine from local data: Codex session files and the Claude Code and OpenTelemetry runs Avalok stored. You review it before sharing; nothing is uploaded.

- **In the dashboard:** the **Share** button opens a preview with a recap card (SVG or PNG), an **interactive replay** (one HTML file anyone can open in a browser), the architecture diagram, and a Markdown summary for pull requests.
- **From the terminal:**

```sh
avalok recap                                  # Markdown summary of the newest session that ran in this repo (paste into a PR)
avalok recap --format svg                     # recap card  -> avalok-recap.svg
avalok recap --format html                    # interactive replay -> avalok-replay.html
avalok recap --format diagram --out docs/architecture.svg   # architecture diagram for your README
avalok wrapped                                # your agent week as a card -> avalok-wrapped.svg (counts only)
```

`recap` picks the newest session that ran in this repository, whichever agent it came from. OpenTelemetry traces usually record no folder, so name one with `--session <id>` (or `--session claude:<id>` when two sources share an id).

Add `--anonymize` to replace names with generic labels, `--no-brand` to drop the "Made with Avalok" footer, and `--force` to overwrite an existing file. Prompts, run titles, commands and file paths are never included, and secret-looking values are hidden. Names of system parts are included by default, so read the preview. Counts only cover steps Avalok actually observed; anything it could not observe (such as cost) is listed as not observed rather than estimated.

## Where Avalok keeps its data

Only its own observed runs and UI settings, in your platform's user-data directory (`avalok data path` shows it). `avalok data clear` removes them. Avalok never writes to your repository or to Codex's or Claude Code's directories.

## Current limitations

- Developer preview: interfaces and data formats may change between `0.1.0-alpha` releases.
- Deep static analysis covers JavaScript/TypeScript and Python; other languages are inventory-only.
- Static inference cannot resolve every computed import, route, or URL.
- Infrastructure analysis describes repository configuration, not live cloud or cluster state. It does not evaluate Terraform expressions, modules, `count`/`for_each`, or Helm control flow.
- OTLP/HTTP traces only: no OTLP/gRPC, metrics, or logs.
- One repository per run; no repository watcher (use Rescan).
- Requires Node.js 22.12 or newer; installed size is about 67 MB (measured on macOS arm64).

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev                       # dashboard http://localhost:3000, receiver http://127.0.0.1:4318
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm avalok <path>          # run the CLI from source
pnpm release:build             # neutral-path release build + installed-product smoke test
```

The codebase is a pnpm/Turborepo monorepo. See [CONTRIBUTING.md](CONTRIBUTING.md) for the package map and architecture documents.

## Contributing

Issues and pull requests are welcome; see the [roadmap](ROADMAP.md) for what is planned and what is not. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first, and report security issues as described in [SECURITY.md](SECURITY.md) rather than in public issues.

## Why "Avalok"?

Avalok (AH-va-lok) comes from the Sanskrit _avaloka_, "looking upon" or "observing": a fitting name for a tool that lets you look at your code, infrastructure, agents, and runtime in one view.

## Trademark

The Avalok name and logo are not licensed under Apache-2.0. You may use the code freely under the license; please do not use the name or logo in a way that suggests your fork or product is the official Avalok.

## License

Apache License 2.0; see [LICENSE](LICENSE). The published package also includes third-party components under their own licenses, listed in its `THIRD_PARTY_NOTICES.md`.

Website: [avalok.dev](https://avalok.dev)
