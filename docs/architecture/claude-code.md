# Claude Code runtime adapter

## Integration method

Claude Code is integrated through current supported interfaces rather than depending on its version-sensitive transcript schema:

1. Claude Code OpenTelemetry traces provide prompt-to-API/tool span hierarchy.
2. HTTP lifecycle hooks provide immediate prompt, file, command, MCP, web, response, and error observations with the documented hook fields.

Hook requests are observational. AgentMap responds successfully and never returns a permission decision, changes tool input/output, or blocks Claude Code.

## Enable traces

Start AgentMap first with `pnpm dev`, then launch Claude Code from a shell with:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
claude
```

`http/protobuf` also works since M7.3; either OTLP/HTTP encoding reaches the same pipeline.

Claude tracing is a Claude Code beta feature and may change. AgentMap treats missing attributes defensively.

## Enable hooks

Add the following pattern to project-local `.claude/settings.local.json`. Repeat the same handler for each listed event:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "http", "url": "http://127.0.0.1:4318/v1/claude/hooks", "timeout": 5 }]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [{ "type": "http", "url": "http://127.0.0.1:4318/v1/claude/hooks", "timeout": 5 }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "http", "url": "http://127.0.0.1:4318/v1/claude/hooks", "timeout": 5 }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "http", "url": "http://127.0.0.1:4318/v1/claude/hooks", "timeout": 5 }]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "*",
        "hooks": [{ "type": "http", "url": "http://127.0.0.1:4318/v1/claude/hooks", "timeout": 5 }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "http", "url": "http://127.0.0.1:4318/v1/claude/hooks", "timeout": 5 }]
      }
    ],
    "StopFailure": [
      {
        "hooks": [{ "type": "http", "url": "http://127.0.0.1:4318/v1/claude/hooks", "timeout": 5 }]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{ "type": "http", "url": "http://127.0.0.1:4318/v1/claude/hooks", "timeout": 5 }]
      }
    ]
  }
}
```

This repository does not install hooks automatically because hook scope and privacy are user choices.

## Observable behavior and limits

Supported hook observations include user prompts, successful and failed tools, Read/Edit/Write file paths, Bash/PowerShell commands, MCP tool identity, web activity, stop/response, and session boundaries. Prompt/response content is bounded and raw data is sanitized before persistence. Thinking/reasoning content is never reconstructed or displayed.

Hook events do not provide token usage. Tokens and model/API hierarchy appear only when Claude's OpenTelemetry trace export provides them. Historical runs are the observations AgentMap has already persisted; AgentMap does not ingest private historical transcript contents by default.

The collector health response includes a `claude` section with hook, normalization, unsupported-event, error, live-status, and last-received counters. See the [Milestone 4 acceptance guide](../development/milestone-4-acceptance.md) for a harmless prompt and expected nodes.
