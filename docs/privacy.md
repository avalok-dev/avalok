# Privacy and local data

Avalok runs entirely on your machine. There is no Avalok cloud service, account, analytics, telemetry about how you use Avalok, crash reporting, or update check. This page describes what the installed `avalok` package reads, stores, and sends. It does not describe what other tools (Codex, Claude Code, your model providers, cloud providers) do with their own data.

## What Avalok reads

| Source                             | What is read                                                                                                                                                                                                                                                                                                                                   | When                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **The repository you point it at** | Source and configuration files, parsed as data (bounded by file-count and size limits). Honors `.gitignore` and `.avalokignore`. Skips `node_modules`, virtualenvs, `.env*` files, Terraform state, `.tfvars`, and lock files. Environment and secret-like configuration values are discarded; for Kubernetes Secrets only key names are kept. | At startup, `doctor`, and on Rescan   |
| **Codex sessions**                 | Session files in `~/.codex/sessions` (or `$CODEX_HOME/sessions`): prompts, commands, file changes, tool and model activity as Codex recorded them. Read-only; the dashboard reads them live and Avalok does not copy them into its own storage.                                                                                                | When you list or open a Codex session |
| **Claude Code**                    | Whether `~/.claude` exists, and whether `~/.claude/settings.json` or the repository's `.claude/settings*.json` configure an Avalok hook (only the presence of the hook URL is checked). Transcripts are not read.                                                                                                                              | Capability report and `doctor`        |
| **Telemetry and hooks you send**   | OpenTelemetry traces and Claude Code hook payloads that programs on your machine send to `127.0.0.1:4318`.                                                                                                                                                                                                                                     | When they are sent                    |
| **Executables on `PATH`**          | Whether `codex` and `claude` exist (file existence only; nothing is executed).                                                                                                                                                                                                                                                                 | Capability report and `doctor`        |

Static analysis never executes, imports, builds, or installs anything from your repository, and never sends its contents anywhere.

## What Avalok stores

Only its own data, in your platform's user-data directory:

| Platform | Location                                           |
| -------- | -------------------------------------------------- |
| macOS    | `~/Library/Application Support/Avalok`             |
| Linux    | `$XDG_DATA_HOME/avalok` or `~/.local/share/avalok` |
| Windows  | `%LOCALAPPDATA%\Avalok`                            |

- `runtime/`: normalized runs from received OpenTelemetry traces and Claude Code hooks. Before anything is stored, secret-named fields (authorization, cookies, API keys, tokens, passwords, private keys, credentials, connection strings) are replaced with `[REDACTED]`, and long values are truncated.
- `captures/` (only if you opt in): events saved by `avalok hook <tool> --capture` so the format of an agent's hook events can be studied. The default keeps field names and value types, not content; `--capture-raw` keeps events as received, which can include prompts, commands, file contents and paths. Never created unless you pass the flag; removed by `avalok data clear`. See [hook capture](development/hook-capture.md).
- `settings.json`: UI preferences (for example, whether Getting Started was dismissed).
- `migration.json`: a record of the one-time copy of data from the product's former AgentMap development locations ([details](development/data-migration.md)).

Repository analysis results are kept in memory only. Avalok never writes to your repository, Codex's or Claude Code's directories, kubeconfig, or Terraform files.

## Clearing data

```sh
avalok data path          # show the directory
avalok data clear         # delete Avalok's runs and settings (asks first)
```

`data clear` deletes only Avalok's `runtime/`, `captures/` and `settings.json`. Uninstalling the package does not remove this directory; clear it first if you want it gone.

## Network

- **The installed product makes no outbound network connections.** The dashboard (`127.0.0.1:4737`) and receiver (`127.0.0.1:4318`) listen on loopback only and do not contact other hosts. Next.js telemetry is disabled.
- Opening the dashboard asks your operating system to open `http://127.0.0.1:<port>` in your default browser (skip with `--no-open`).
- Installing or upgrading with npm contacts the npm registry, as any package install does.
- Loopback servers are protected against web pages in your browser (DNS rebinding and cross-origin requests are rejected); see [local HTTP security](security/local-http.md).

## Contributors (source checkout)

Development workflows disable Next.js telemetry too (`apps/web/next.config.ts`). One exception remains: Next.js's development server (`pnpm dev`) checks `https://registry.npmjs.org/-/package/next/dist-tags` for newer Next.js versions when it starts. No project data is sent, Next.js offers no switch to turn it off, and the packaged product never runs the development server. `pnpm install` and CI use the npm registry and GitHub as usual.

## Verification

Before release, outbound connections were measured by hooking Node's network APIs in every Avalok process (including child processes) while running the packaged product, sending traces, and using the dashboard: no connection to any non-loopback host was attempted. The same method showed that contributor `next build` previously posted to `telemetry.nextjs.org`; it no longer does.
