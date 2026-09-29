# OpenTelemetry and OpenInference ingestion

## Supported

Sarvadrik includes a small local receiver bound to `127.0.0.1:4318` by default. It accepts OTLP/HTTP trace export requests encoded as protobuf (`application/x-protobuf`, the default of most official exporters) or JSON (`application/json`) at `POST /v1/traces`, preserves trace/span hierarchy and timing, normalizes OpenInference semantic attributes when present, persists normalized runs locally, and updates the existing Live view through SSE.

The endpoint is:

```text
http://127.0.0.1:4318/v1/traces
```

Configure standard exporters with:

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
# Optional: http/protobuf is the usual default; http/json is also accepted.
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf
```

Milestone 4 introduced OTLP/HTTP JSON. Milestone 7.3 added OTLP/HTTP protobuf through the same decode → canonical request → normalization pipeline; see `docs/development/otlp-protobuf.md`. OTLP/gRPC is not supported. Other media types receive HTTP 415.

## Classification

OpenInference `AGENT`, `CHAIN`, `LLM`, `TOOL`, `RETRIEVER`, `EMBEDDING`, `RERANKER`, `PROMPT`, `GUARDRAIL`, and `EVALUATOR` spans are mapped to existing Sarvadrik categories. MCP is used only when the tool identity explicitly indicates MCP.

Generic spans remain conservative:

- HTTP semantic attributes or server/client span kinds produce HTTP observations;
- `db.system` produces database observations;
- GenAI semantic attributes produce model observations;
- otherwise the operation remains a service observation.

Generic HTTP traffic is never labeled as an AI agent. Cost stays unavailable unless a future source provides reliable provider/model pricing data.

## Run the deterministic example

From the repository root:

```bash
pnpm dev
pnpm --filter @visual-system/instrumented-ai-app dev
curl -sS -X POST http://127.0.0.1:4319/prompt \
  -H 'content-type: application/json' \
  -d '{"prompt":"Explain the local fixture"}'
```

Open Sarvadrik at `http://localhost:3000`, choose **Telemetry**, and select the newest `instrumented-ai-app` trace. The expected path is:

```text
User → instrumented-ai-app → Fixture Research Agent
  ├─ Retrieve fixture documents
  ├─ sqlite
  ├─ fixture_lookup
  └─ deterministic-model
User/request → Return response
```

Exporters deliver completed spans, so the trace appears immediately after the example request completes. Sarvadrik accurately presents these as completed observations received live; it does not fabricate a span-start signal.

## Configuration and security

- `SARVADRIK_OTLP_HOST` changes the bind host.
- `SARVADRIK_OTLP_PORT` changes the port.
- `SARVADRIK_ALLOW_REMOTE_OTLP=1` is required before a non-loopback bind is accepted.
- `SARVADRIK_DATA_DIR` changes the local persistence directory.
- request bodies default to a 5 MiB maximum;
- gzip bodies are bounded after decompression;
- malformed spans are rejected or reported as partial success without terminating the collector.

The collector health endpoint is `GET http://127.0.0.1:4318/health`. It reports received/normalized counts, malformed payloads, redaction/truncation counts, active services, and the last receive time.

For the complete redaction, malformed-input, load, live behavior, and visual inspection procedure, use the [Milestone 4 acceptance guide](../development/milestone-4-acceptance.md).
