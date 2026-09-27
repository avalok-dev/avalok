# Runtime privacy, redaction, and size limits

Runtime telemetry is stored locally under `.agentmap/runtime` by default and is gitignored. AgentMap does not upload traces, prompts, responses, Claude sessions, Codex sessions, or repository source to an AgentMap service.

Before persistence and raw inspection, the shared runtime policy recursively redacts case- and separator-insensitive sensitive keys including authorization, API keys, tokens, access/refresh tokens, cookies, set-cookie, passwords, secrets, client secrets, database URLs, and connection strings.

Default bounds are:

- 4,000 characters per string;
- 50 array items;
- 80 object keys;
- 6 nested levels;
- 5 MiB collector request body, including the decompressed limit for gzip.

Truncated strings, arrays, and objects retain a visible wrapper containing the bounded value, `truncated: true`, and `originalSize` where it is known. Diagnostics count redacted and truncated fields. Values are not executed or interpolated into commands.

These safeguards reduce accidental exposure and UI damage but are not a data-loss-prevention system. Instrument applications to avoid exporting unnecessary prompt, response, authorization, cookie, and PII content in the first place. OpenInference's own hide-input/output configuration should be used when available.
