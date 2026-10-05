# Local HTTP security

Avalok runs two HTTP servers on the user's machine:

| Server    | Default                | Serves                                                                         |
| --------- | ---------------------- | ------------------------------------------------------------------------------ |
| Dashboard | `127.0.0.1:4737` (CLI) | UI, `/api/*` (repository analysis, Codex sessions, runtime runs, settings)     |
|           | `127.0.0.1:3000` (dev) |                                                                                |
| Collector | `127.0.0.1:4318`       | OTLP/HTTP `/v1/traces`, Claude hooks `/v1/claude/hooks`, test trace, `/health` |

Both bind to loopback only. **That is not enough on its own.** Any web page open in the user's browser can send requests to `127.0.0.1`, and DNS rebinding can make a foreign hostname resolve to `127.0.0.1` so a page can _read_ responses. Avalok therefore treats every browser-controlled input as untrusted: `Host`, `Origin`, `Content-Type`, path, query, headers, and bodies.

## Rules

Validation lives in one small package, `@visual-system/local-security` (pure functions, used by both servers). It parses headers strictly against allowlists. There are no substring checks, so `localhost.attacker.example`, `127.0.0.1.attacker.example`, and `attacker.example@127.0.0.1` never match.

### Host (both servers, every path)

- Allowed hostnames: `127.0.0.1`, `localhost` (case-insensitive), and `[::1]`. Anything else is rejected with `403`: foreign names, LAN addresses, `0.0.0.0`, other `127.x` addresses, IPv4-mapped or expanded IPv6 forms, trailing-dot names, userinfo, paths, malformed ports, and a missing Host.
- The port must be the port the server actually listens on. A Host without a port means `:80` and is rejected.
  - **Collector:** the socket's local port (`request.socket.localPort`), so `--otlp-port` and ephemeral test ports work automatically.
  - **Dashboard:** `AVALOK_DASHBOARD_PORT` (set by the CLI), otherwise `PORT`. `next dev` and `next start` publish the bound port, including after `next dev` falls forward to another port. If neither is known, only the hostname is checked.

This check is what stops DNS rebinding. A rebound page sends `Host: attacker.example:4737`, so it cannot read repository analysis, Codex sessions, runtime runs, capabilities, or even the HTML.

### Origin

| Where                                                 | Missing Origin | Same loopback server | Other loopback port | Foreign / `null` |
| ----------------------------------------------------- | -------------- | -------------------- | ------------------- | ---------------- |
| Dashboard, every path and method                      | allowed        | allowed              | 403                 | 403              |
| Collector `/v1/claude/hooks`, `/v1/avalok/test-trace` | allowed        | 403                  | 403                 | 403              |
| Collector `/v1/traces`, `/health`                     | allowed        | allowed              | allowed             | 403              |

- "Same loopback server" means `http://` plus an allowed loopback hostname plus the dashboard's own port. `http://localhost:4737` and `http://127.0.0.1:4737` are both the same Avalok dashboard; `https://127.0.0.1:4737` is not.
- **Missing Origin is allowed.** Browsers send `Origin` on every `POST` (and on cross-origin `fetch`), so the browser threat always carries one. Clients that omit it are the CLI, curl, OTLP exporters, and Claude Code. Those are local programs, which this layer does not try to stop (see the [threat model](threat-model.md)). Requiring Origin would break OTLP exporters and Claude Code without adding protection.
- **`Origin: null` is always rejected.** Browsers send it from sandboxed iframes, `file:` pages, `data:` URLs, and some cross-origin redirects. Avalok has no legitimate use for it.
- Claude Code and the dashboard's server-side test-trace proxy never send `Origin`, so on those two collector routes any Origin, even a loopback page, means a browser and is refused.
- OTLP exporters normally send no Origin; an exporter running in a local web page would send a loopback Origin, which is allowed. It still needs a CORS preflight that Avalok never approves.

### Content-Type

| Route                                               | Accepted                                                             | Otherwise |
| --------------------------------------------------- | -------------------------------------------------------------------- | --------- |
| Dashboard `/api/*` mutations (non-GET/HEAD/OPTIONS) | `application/json` (parameters allowed)                              | 415       |
| Collector `/v1/claude/hooks`                        | `application/json`                                                   | 415       |
| Collector `/v1/avalok/test-trace`                   | `application/json` (body ignored, ≤ 16 KiB)                          | 415       |
| Collector `/v1/traces`                              | `application/json`, `application/x-protobuf`, `application/protobuf` | 415       |

`text/plain`, `application/x-www-form-urlencoded`, and `multipart/form-data` are the CORS-safelisted types: a page can send them cross-origin with no preflight (for example from an HTML form or `fetch(..., { mode: "no-cors" })`). Requiring JSON forces a preflight, which Avalok never answers with CORS approval. The Origin check stops the request server-side regardless.

### Claude Code hook content type: evidence

Claude Code's hooks reference documents HTTP hooks as follows: Claude Code "sends the hook's JSON input as the POST request body with `Content-Type: application/json`" (code.claude.com/docs/en/hooks, checked 2026-09-27). Avalok's documented configuration (`docs/architecture/claude-code.md`) uses `"type": "http"` hooks, and all existing fixtures are JSON. No legitimate Claude Code path sends `text/plain`, so only `application/json` is accepted.

### CORS

Neither server sends any `Access-Control-*` header, so every preflight fails in the browser. Rejection does not rely on CORS, though: the server itself refuses foreign Host and Origin values before any route runs.

## Where it is enforced

| Server    | Mechanism                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Dashboard | `apps/web/src/middleware.ts` (matcher `/:path*`) → `guardDashboardRequest` in `src/lib/request-guard.ts`                      |
| Collector | `guardCollectorRequest` at the top of the request handler in `apps/collector/src/server.ts`, plus per-route media-type checks |

A rejected request's body is never read. Responses are `{"error": "Forbidden: …"}` or `{"error": "Unsupported Content-Type. …"}` with `Cache-Control: no-store`. They contain no paths or data.

## Payload limits

| Input                          | Limit                                                                     |
| ------------------------------ | ------------------------------------------------------------------------- |
| OTLP `/v1/traces`              | 5 MiB received **and** 5 MiB after gzip/deflate (other encodings: 415)    |
| Claude hooks                   | 5 MiB (`maxHookBodyBytes`; hook payloads can carry tool output)           |
| Test trace                     | 16 KiB (ignored)                                                          |
| Dashboard `POST /api/settings` | 16 KiB, streamed with an early abort                                      |
| Headers / slow clients         | Node defaults: 16 KiB headers, 60 s header timeout, 300 s request timeout |
| Persisted values               | Sanitized: strings 4,000 chars, arrays 50, object keys 80, depth 6        |

Other dashboard routes are GET-only and read no body. The 5 MiB limit matches common OTLP exporter batch sizes. Persisted run count is not capped; disk usage is bounded by what local programs choose to send (see the threat model).

## Remote binding

`AVALOK_ALLOW_REMOTE_OTLP=1` with a non-loopback `AVALOK_OTLP_HOST` is a pre-existing escape hatch for the standalone development collector only. It disables the Host check (remote exporters send the machine's address); the Origin and content-type rules still apply. The product CLI always binds `127.0.0.1` and never sets it. Remote/LAN access is not a supported product mode.

## Verification

- Unit/integration: `packages/local-security/tests`, `apps/collector/tests/security.test.ts`, `apps/web/tests/request-guard.test.ts`.
- Packaged product: `pnpm dist:smoke` (and `pnpm release:build`) run 17 `security:` checks against the installed production servers.
- Manual commands: [`docs/architecture/milestone-7-4a.md`](../architecture/milestone-7-4a.md#manual-verification).
