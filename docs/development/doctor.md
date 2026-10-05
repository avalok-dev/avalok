# Avalok doctor

Run:

```sh
avalok doctor [path]          # installed package
pnpm avalok doctor [path]     # contributor workspace
```

`doctor` is diagnostic and does not start Avalok. It checks the CLI version and whether it runs from the installed package or the source workspace, Node version policy (older is blocking; newer than tested is a warning), OTLP/HTTP protobuf + JSON support (gRPC not supported), target readability, repository analysis, detected languages/configured infrastructure, Codex session availability, Claude Code availability and hook configuration, OTLP and dashboard ports, Avalok data-directory write/persistence health, legacy `~/.agentmap/runtime` detection and migration status, and loopback-only defaults. It never migrates; migration runs on `avalok` startup.

It does not install software, edit repositories, change agent settings, print conversations or telemetry payloads, inspect credentials, or contact cloud infrastructure. Its only write is a short probe file inside the Avalok-owned data directory, immediately removed.

Exit `0` means usable; warnings such as an absent optional agent source do not fail the command. Exit `1` means a blocker such as an unreadable repository, incompatible Node version, analyzer failure, non-Avalok OTLP port conflict, or unwritable data directory.

Output uses the repository basename and a home-relative data path. It never prints environment values, prompts, responses, tokens, session content, AWS credentials, or kubeconfig. Because repository and directory names remain, review those names before posting the output.

Useful failure checks:

```sh
pnpm avalok doctor .
pnpm avalok doctor . --otlp-port 4320
pnpm avalok doctor /path/to/repository
```
