# Threat model (developer preview)

Avalok is a local-first developer tool. It reads the current repository, local Codex session files, and observations sent to its loopback receiver, and shows them in a dashboard served on loopback. It has no accounts, cloud service, analytics, crash reporting, or update checks.

## Assets

- Repository source structure and file paths (analysis output).
- Codex session transcripts (`~/.codex/sessions`), Claude Code observations, and OTLP telemetry, which can contain prompts, tool output, commands, and file contents.
- Avalok's own data directory (`runtime/`, `settings.json`).
- The integrity of what the dashboard shows (fabricated observations are misleading).

## In scope

| Threat                                                                                                                                     | Mitigation                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Malicious website in the user's browser** sends requests to loopback ports                                                               | Server-side Origin validation; JSON-only mutations; no CORS headers ([local HTTP](local-http.md))                                                                                                              |
| **DNS rebinding** (foreign hostname resolved to 127.0.0.1 to read responses)                                                               | Host must be a loopback name on the server's actual port, on every path of both servers                                                                                                                        |
| **Cross-origin POST** (forms, `no-cors` fetch, `text/plain`) to forge Claude observations, trigger the synthetic trace, or change settings | Claude hooks/test trace reject any Origin and require `application/json`; dashboard mutations require same-loopback Origin (if present) and JSON                                                               |
| **Malformed telemetry sender** (huge, compressed, malformed, or deeply nested payloads)                                                    | Size limits before and after decompression; unsupported encodings/types rejected; malformed spans counted, not trusted; persisted values sanitized and bounded                                                 |
| **Malicious repository contents** (the analyzed target)                                                                                    | Static, read-only, non-executing analysis: code is parsed, never imported or run; no target scripts, builds, installs, or network access; bounded inventory                                                    |
| **Malformed Terraform/Kubernetes/Helm/Compose files**                                                                                      | Parsed as data with recovery; `.tfvars`, state, and `.terraform` excluded; environment and secret values discarded; Helm templating is bounded static substitution, never `helm`/`kubectl`/providers           |
| **Malicious telemetry strings / untrusted Codex or Claude content** rendered in the UI                                                     | Rendered only as React text (escaped); no raw-HTML or dynamic-code sinks (guarded by `apps/web/tests/rendering-safety.test.ts`); inspector shows JSON as text                                                  |
| **Secrets in observations** (headers, env-like keys)                                                                                       | Key-based redaction before persistence (authorization, cookies, API keys, tokens, passwords, secrets, AWS secret access keys, private keys, credentials, connection strings); strings/arrays/objects truncated |
| **Browser-selected filesystem paths**                                                                                                      | The dashboard analyzes only the server-selected target or fixed allowlisted samples; Codex sessions are matched by discovered id; runtime runs are stored under hashed names                                   |
| **Build-machine data leaking into the package**                                                                                            | Build tracing kept away from the home directory; neutral-path release build fails on home/username/checkout paths ([release build](../development/release-build.md))                                           |

## Out of scope (not defended)

- **Local processes running as the same user.** They can read `~/.codex` and Avalok's data directory directly, send OTLP/hook requests without an Origin, and fill the disk. Avalok does not authenticate local clients; adding a token would not stop a process that can read the token file.
- **A compromised machine, root/administrator, or malware** with the user's privileges.
- **Other users on a shared host.** Loopback sockets are reachable by every local user. The data directory is created with default permissions and settings are written `0600`. Multi-user hosts are not a supported target for the preview.
- **Browser extensions** with host permissions for localhost.
- **Remote/LAN access.** It is unsupported. The development-only `AVALOK_ALLOW_REMOTE_OTLP=1` escape hatch disables the Host check for that collector.
- **Content-based secret detection** (secrets inside command strings, prompts, or file contents). Redaction is key-based; Avalok is not a DLP product.
- **Supply chain** of npm dependencies beyond the lockfile and exact-pinned runtime dependencies.

## Residual risks

- A page on **another loopback port** of the same machine (for example a compromised local dev server) is cross-origin and blocked from dashboard mutations and Claude hooks, but it may send OTLP traces with a loopback Origin after a preflight. The browser blocks that preflight because Avalok sends no CORS headers.
- Next.js development mode (`pnpm dev`) is for contributors. It binds `127.0.0.1` and is protected by the same middleware, but it also serves Next's development tooling.
