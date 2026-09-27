# Milestone 4 manual acceptance guide

Run all commands from the repository root unless a step says otherwise. Keep `pnpm dev` running in its own terminal; it starts both the web application on `http://localhost:3000` and the loopback collector on `http://127.0.0.1:4318`.

## 1. Milestone 1 regression

1. Open AgentMap and choose **Demo fixture**.
2. In **Map**, confirm the original research-agent topology renders and nodes can be selected.
3. In **Live**, press play, pause, seek, and change speed. The highlight and inspector must follow the same timeline position.
4. Press **Jump to Live** after seeking backward. It must return to the newest event and resume following.
5. In **Runs**, replay the demo. Metrics, timeline, inspector, and raw/normalized tabs must remain usable.

Expected: no missing or duplicate nodes, no stale selection, and no change to the original visual language.

## 2. Codex regression

1. Open the source selector and choose a known historical **Codex** task.
2. Confirm prompt/response, model, Files, Terminal, and MCP nodes appear only when the selected task contains that evidence.
3. Inspect file and command events, token/model/tool metrics, raw data, and diagnostics.
4. Select a currently changing Codex task, perform a harmless read and `pwd` in that task, and watch Live.
5. Seek backward, let another event arrive, then press **Jump to Live**.

Expected: historical replay is deterministic; new JSONL records arrive without a page refresh; Jump to Live resumes tail-following; existing Codex classifications and metrics do not regress.

## 3. Repository regression and reconciliation

1. Choose **Current repository** and use **Rescan**.
2. Confirm application/package/integration entities, dependency edges, evidence, confidence, file detail, and diagnostics appear.
3. While the repository remains selected, choose a Codex or telemetry run.
4. Toggle the execution overlay and inspect an illuminated architecture component.

Expected: static architecture remains the primary map. Exact source paths and workspace ownership have the strongest evidence. Unmatched runtime nodes remain visible instead of being forced onto an unrelated component.

## 4. Claude Code

Configure the environment and hooks from [claude-code.md](../architecture/claude-code.md), start AgentMap, open Claude Code in this repository, and send this harmless prompt:

```text
Read README.md. Create agentmap-claude-smoke.txt containing only "AgentMap Claude smoke test". Run pwd and then wc -c agentmap-claude-smoke.txt. Do not modify any other file.
```

Open the source selector; it polls while open, so a **Claude Code** run should appear without reloading the page. Select it.

Expected: User → Claude Code, Files activity for the README read and smoke-file write, Terminal activity for `pwd`/`wc`, and a response event. PreToolUse may appear immediately as started; PostToolUse updates that observation to completed. Model hierarchy/tokens appear only when Claude's optional OpenTelemetry trace export supplies them. No thinking or chain-of-thought appears. Delete the smoke file after the check.

## 5. OpenTelemetry/OpenInference end to end

Terminal 1:

```bash
pnpm dev
```

Terminal 2:

```bash
pnpm --filter @visual-system/instrumented-ai-app dev
```

Terminal 3:

```bash
curl -sS -X POST http://127.0.0.1:4319/prompt \
  -H 'content-type: application/json' \
  -d '{"prompt":"Explain the local fixture"}'
```

Open the source selector and select the newest **OTLP** run for `instrumented-ai-app`. Expected topology:

```text
User → instrumented-ai-app → Fixture Research Agent
                              ├─ Retrieve fixture documents
                              ├─ sqlite
                              ├─ fixture_lookup
                              └─ deterministic-model
instrumented-ai-app → Return response
```

Expected metrics: 900 ms duration, 24 input tokens, 12 output tokens, one model call, three tool-like calls, and unavailable cost. The trace inspector must show span/parent IDs and parent breadcrumbs. Runs must still be present after a browser refresh.

## 6. Live behavior

Keep a selected telemetry or Claude run open in **Live**. New persisted batches are polled every 500 ms and applied through the existing delta/replay path. The source selector itself polls every two seconds while open.

Expected: Claude PreToolUse can animate as observed start activity and the matching completion replaces it. Standard OTLP exporters send ended spans, so the example appears just after the request completes; AgentMap labels it as a completed observation and does not pretend the start was received live. Seeking disables follow; **Jump to Live** seeks to the latest observation and restores follow.

## 7. Telemetry-to-repository reconciliation

1. Choose **Current repository** first.
2. Send and select the example trace.
3. Keep the architecture map visible and enable the execution overlay.

Expected: `examples/instrumented-ai-app/src/server.ts` and `service.name=instrumented-ai-app` deterministically map activity to the example workspace/package with evidence and confidence. The SQLite runtime entity remains visible if static analysis has no matching database entity. Ambiguous services/routes must remain unmatched.

## 8. Redaction and truncation

Send a safe fake authorization value:

```bash
curl -sS -X POST http://127.0.0.1:4319/prompt \
  -H 'content-type: application/json' \
  -H 'x-agentmap-fake-secret: Bearer AGENTMAP_FAKE_TEST_SECRET_12345' \
  -d '{"prompt":"Redaction smoke test"}'
```

Select the new run and inspect raw telemetry. The `authorization` value must be `[REDACTED]`, and diagnostics must report redaction. Verify the persisted snapshots do not contain the fake value:

```bash
rg 'AGENTMAP_FAKE_TEST_SECRET_12345' .agentmap/runtime
```

Expected: `rg` returns no match. Oversized strings appear as an object containing `value`, `truncated: true`, and `originalSize`; they never render as an unbounded payload.

## 9. Malformed input resilience

```bash
curl -i -X POST http://127.0.0.1:4318/v1/traces \
  -H 'content-type: application/json' \
  --data-binary '{'
curl -sS http://127.0.0.1:4318/health
```

Expected: the first request returns HTTP 400; the health request still returns `status: ok`, and `malformedPayloads` increases. A non-JSON/protobuf content type returns 415 with `http/json` guidance. Payloads over 5 MiB return 413.

## 10. Moderate load

Emit one 1,000-span trace:

```bash
pnpm --filter @visual-system/instrumented-ai-app load -- --spans=1000
```

Optionally emit 25 smaller traces:

```bash
pnpm --filter @visual-system/instrumented-ai-app load -- --count=25 --spans=100
```

Expected: the source selector remains responsive, selecting the large trace completes, timeline seeking works, repeated service observations do not create duplicate service nodes, stable topology does not continually re-layout, and the UI does not freeze. Observe memory growth, timeline lag, or graph jumping and report them with the browser/Node versions if present.

## 11. Fresh-shell toolchain

Open a new terminal and run:

```bash
node --version
pnpm --version
which node
which pnpm
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

Expected: Node `v24.19.0`, pnpm `11.19.0`, and both executable paths beneath `/Users/jaishnav/.nvm/versions/node/v24.19.0/bin/`. Install, tests, and build pass without a per-terminal version workaround.

## 12. Visual inspection checklist

- Duplicate entities: none for repeated stable IDs.
- Parent/child relationships: model, retrieval, database, and tool spans descend from the fixture agent; breadcrumbs agree.
- Runtime-to-architecture mapping: only deterministic path/service/route/database evidence maps; no forced match.
- Graph layout: unchanged topology remains stable during live updates; no repeated jumping or needless new crossing edges.
- Live state: no stale selected event after a delta; Jump to Live follows the newest event.
- Metrics: fixture totals are exactly 24 input / 12 output tokens, 900 ms, one model call, three tool-like calls, and unavailable cost.
- Payload safety: no huge unbounded value and no fake secret in normalized, raw, or persisted data.
- Timeline: event highlight, inspector, and seek position remain synchronized.
- Switching: Demo, repository, Codex, Claude, and telemetry changes do not leak prior state.
- Classification: Claude file/terminal/MCP/web events match actual tools; generic OTLP HTTP/service spans are not labeled as agents.
- Regressions: Demo, Codex, repository map, evidence/confidence, replay, inspectors, and reconciliation remain functional.
