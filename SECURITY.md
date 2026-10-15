# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **private vulnerability reporting** for this repository: the **Security** tab → **Report a vulnerability**. Do not open a public issue, discussion, or pull request for a suspected vulnerability.

Include the Avalok version (`avalok --version`), your OS and Node.js version, steps to reproduce, and the impact you observed. Please do not include private repository contents, session transcripts, or real credentials.

This is a volunteer-maintained developer preview; reports are acknowledged and handled on a best-effort basis.

## Supported versions

Only the latest `0.1.0-alpha` release receives fixes during the developer preview.

## Scope

Avalok runs locally. In scope:

- Web pages in the user's browser abusing the loopback dashboard (`127.0.0.1:4737`) or receiver (`127.0.0.1:4318`): DNS rebinding, cross-origin requests, forged Claude Code observations
- Malicious repository contents, infrastructure files, telemetry, or agent session content causing code execution, file access outside documented locations, secret exposure, or script injection in the dashboard
- Build-machine or user data leaking into the published package

Out of scope: attacks that require a compromised machine, administrator/root access, or another process already running as the same user (see the [threat model](docs/security/threat-model.md)).

## How Avalok protects local data

- Both servers bind to `127.0.0.1` only and validate `Host` against loopback names on their actual port.
- State-changing dashboard routes, Claude Code hooks, and the synthetic test trace reject foreign or `null` `Origin` values and require `application/json`; no CORS headers are sent.
- Static analysis parses repository files as data and never executes them; it skips Terraform state and `.tfvars`, keeps only the key names of Kubernetes Secrets (values are discarded), and redacts secret-like configuration values.
- Observed telemetry and hook payloads are size-limited, and secret-named fields (authorization, cookies, API keys, tokens, passwords, private keys, credentials) are redacted before anything is stored.
- The dashboard renders untrusted values as text only.

Details: [docs/security/local-http.md](docs/security/local-http.md), [docs/security/threat-model.md](docs/security/threat-model.md), [docs/privacy.md](docs/privacy.md).
