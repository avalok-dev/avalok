# Codex adapter

## Observed local format

The adapter was designed after inspecting the JSONL session files present on the development machine. The observed records have a top-level `type`, ISO `timestamp`, `ordinal`, and `payload`. The current files include:

- `session_meta` with IDs, working directory, originator, CLI version, and provider metadata;
- `turn_context` with the selected model and execution context;
- `event_msg` records for task start/completion, aborts, token counts, and completed items;
- completed items including `UserMessage`, `AgentMessage`, `CommandExecution`, `FileChange`, `McpToolCall`, and `Reasoning`;
- `token_usage_record` with response, turn, and thread token totals;
- lower-level `response_item` call/output records;
- compaction and world-state records.

This is an observed compatibility description, not a claim that the format is a stable public API. The parser therefore uses guarded property access, tolerates missing fields, and reports unsupported additions.

## Mapping rules

| Codex observation                       | Normalized event                      | Graph target             |
| --------------------------------------- | ------------------------------------- | ------------------------ |
| `task_started`                          | `agent.start`                         | Codex                    |
| `task_complete`                         | `response.completed`                  | User                     |
| `turn_aborted`                          | `agent.aborted` error                 | User                     |
| completed `UserMessage`                 | `prompt.received`                     | Codex                    |
| completed `AgentMessage`                | `response.message`                    | User                     |
| completed `CommandExecution`            | `terminal.command` or `terminal.test` | Terminal or Tests        |
| completed `FileChange`                  | `files.changed`                       | grouped Files            |
| completed `McpToolCall`                 | `mcp.tool_call`                       | server-specific MCP node |
| unique `token_usage_record.response_id` | `model.response`                      | Model                    |

`CommandExecution.duration` is converted from seconds/nanoseconds to milliseconds. A failed status or non-zero exit code becomes an error-category event. Test classification is a transparent command-name heuristic and does not claim static code understanding.

The current enriched `item_completed` records are preferred because they contain status, timing, output, and structured file changes. Lower-level function/custom calls are used only as a compatibility fallback when a loaded batch contains no completed items, preventing double-counting in current logs.

## Stable identity and deduplication

- Completed item IDs are reused as normalized event IDs.
- Model response IDs are prefixed with `model:`.
- Task boundary IDs use the turn ID and boundary.
- Events are stored in an ID-keyed map and sorted by timestamp when materialized.
- Entities and edges are stored in ID-keyed maps.

This makes repeated records and reconnect snapshots idempotent.

## Incremental reading

`IncrementalJsonlReader` tracks the byte offset already read, a byte buffer containing an incomplete final line, and the logical line number used by diagnostics. Only newline-terminated records are parsed. When more bytes arrive, the previous remainder is prepended. If a file is truncated, the cursor and remainder reset safely. The live API serializes filesystem notifications through one promise chain so overlapping notifications cannot race the cursor.

## Diagnostics

Malformed JSON, non-object JSON, and unsupported top-level record types are non-fatal diagnostics. The inspector shows recent diagnostics with codes and line numbers. Adapter or stream failures are surfaced by the source selector and connection indicator.

## Security properties

- Discovery accepts a server-side sessions root; browser requests pass only a discovered session ID.
- Tests and isolated local runs can override the home with `AI_VISUALIZER_CODEX_HOME` without changing the user's Codex configuration.
- Symlinks are not traversed during discovery.
- Session files are opened only for reading.
- The package has no HTTP client dependency and its no-network behavior is tested.
- Raw records are bounded before serialization to avoid accidentally shipping multi-megabyte outputs to the browser.
