# Local telemetry setup

Sarvadrik listens on loopback and accepts **trace** payloads over **OTLP/HTTP**, encoded as either protobuf or JSON:

```text
http://127.0.0.1:4318/v1/traces
```

| Exporter protocol | Content-Type             | Accepted |
| ----------------- | ------------------------ | -------- |
| `http/protobuf`   | `application/x-protobuf` | Yes      |
| `http/json`       | `application/json`       | Yes      |
| `grpc`            | —                        | No       |

The signal-specific endpoint includes `/v1/traces` and is used as-is. A base `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` also works for exporters that append the signal path, as the [OTLP exporter specification](https://opentelemetry.io/docs/specs/otel/protocol/exporter/) requires. Most official exporters default to `http/protobuf`, so usually only the endpoint needs setting:

```sh
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
```

No OpenTelemetry Collector is required. A Collector remains an optional bridge, for example for gRPC-only exporters: receive gRPC in the Collector and export `otlphttp` to Sarvadrik.

## Python

The standard, maintained `opentelemetry-exporter-otlp-proto-http` exporter sends protobuf directly to Sarvadrik. Always install into an isolated environment:

```sh
python3 -m venv .venv
.venv/bin/pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
.venv/bin/python your_app.py
```

`examples/python-otel-direct/` is a complete credential-free example. The gRPC exporter (`opentelemetry-exporter-otlp-proto-grpc`) is not supported directly.

## Node.js

Either official JavaScript OTLP HTTP exporter works: `@opentelemetry/exporter-trace-otlp-proto` (protobuf) or `@opentelemetry/exporter-trace-otlp-http` (JSON). Register it with the Node SDK before application code and set its `url` to the full traces endpoint. See the [JavaScript exporter documentation](https://opentelemetry.io/docs/languages/js/exporters/).

```sh
npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-proto
```

## OpenInference

OpenInference is a semantic convention layered on OpenTelemetry, so it works over either encoding. Sarvadrik normalizes agent, chain, LLM/model, tool, retriever, embedding, reranker, prompt, guardrail, evaluator, GenAI, and token attributes. Unknown span kinds are preserved as generic activity with a diagnostic. See [OpenInference](https://arize-ai.github.io/openinference/).

## Immediate local proof

Open **Setup → Connect Telemetry → Send Test Trace**. Sarvadrik sends five deterministic-shape spans directly to its own loopback collector. No API key, model call, internet request, or external AI is involved. Every visible service/entity/run/span is labeled Synthetic Fixture/Test. Select **View in Live** to open it.
