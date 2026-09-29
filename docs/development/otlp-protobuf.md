# OTLP/HTTP protobuf ingestion

Standard OpenTelemetry exporters commonly default to OTLP/HTTP with binary protobuf. Since M7.3 Sarvadrik accepts it directly on the standard trace path; OTLP/HTTP JSON continues to work unchanged.

## Pipeline

Both encodings share one pipeline. There is no protobuf-specific graph or normalization logic.

```text
POST /v1/traces
  ├─ application/x-protobuf → decodeOtlpTraceProtobuf ─┐
  └─ application/json       → JSON.parse ──────────────┤
                                                        ▼
               canonical OTLP request (OTLP/JSON shape: hex IDs, string int64)
                                                        ▼
               parseOtlpJson → normalizeTraces → LocalRuntimeStore → Live / Runs
```

`packages/telemetry-adapter/src/otlp-protobuf.ts` decodes `ExportTraceServiceRequest` with the maintained [`protobufjs`](https://github.com/protobufjs/protobuf.js) runtime against the **official** opentelemetry-proto `v1.11.0` definitions (vendored unmodified in `packages/telemetry-adapter/proto/`). It maps bytes IDs to lowercase hex, 64-bit integers to decimal strings, and `bytesValue` to base64 — exactly the OTLP/JSON representation — so `parseOtlpJson` handles both. There is no hand-written wire parser.

The descriptor is generated into `src/otlp-proto-descriptor.ts` and compiled into the bundle; nothing reads `.proto` files at runtime. A test fails if it drifts from the vendored definitions. Regenerate with:

```sh
pnpm --filter @visual-system/telemetry-adapter generate:otlp
```

## HTTP semantics

| Situation                                        | Status | Body                                                         |
| ------------------------------------------------ | -----: | ------------------------------------------------------------ |
| Valid protobuf                                   |    200 | Protobuf `ExportTraceServiceResponse` (empty = full success) |
| Valid protobuf with malformed spans              |    200 | Protobuf response with `partial_success.rejected_spans`      |
| Valid JSON                                       |    200 | JSON `{}` or `partialSuccess` (unchanged from M4)            |
| Empty protobuf body                              |    200 | Valid empty export (zero spans)                              |
| Malformed/truncated protobuf, bad gzip/deflate   |    400 | Protobuf `google.rpc.Status` (JSON `{error}` for JSON)       |
| Body or inflated body above 5 MiB                |    413 | Status body in the request's encoding                        |
| Unsupported `Content-Type` or `Content-Encoding` |    415 | Explanation                                                  |

Media types are compared case-insensitively and parameters such as `charset` are ignored. `application/protobuf` is accepted as an equivalent of `application/x-protobuf`. `Content-Encoding: gzip` and `deflate` are supported with inflation capped at the same limit. Successful responses are 200 so exporters do not retry; malformed payloads receive non-retryable 4xx codes so exporters drop rather than loop.

## Limits and safety

- 5 MiB request limit before and after decompression (unchanged).
- Decoding errors, including pathological nesting, are caught and reported as 400; the receiver keeps serving.
- Redaction, truncation, and diagnostics apply identically because they run after the shared canonical step.
- OTLP/gRPC is **not** supported. Metrics and logs signals are not ingested.

## Tests

- `packages/telemetry-adapter/tests/protobuf.test.ts` — protobuf produced by the official OpenTelemetry JS SDK `ProtobufTraceSerializer` (independent of Sarvadrik's decoder) decodes to exactly the same canonical spans as the SDK's JSON serializer; hierarchy, resource/`service.name`, scope, status, timestamps, attribute types, OpenInference tokens, redaction, empty and malformed bodies, response encoding, descriptor drift, and the checked-in fixture.
- `apps/collector/tests/collector.test.ts` — HTTP content types, gzip/deflate, 400/413/415 bodies, JSON regression.
- `apps/collector/tests/standard-exporters.test.ts` — the official `@opentelemetry/exporter-trace-otlp-proto` and `exporter-trace-otlp-http` exporters export directly and report `SUCCESS`.
- `examples/python-otel-direct` — the standard Python exporter, run by the clean-install smoke test with `--python`.

The deterministic fixture `packages/telemetry-adapter/tests/fixtures/openinference-trace.otlp.pb` can be regenerated with `node --experimental-strip-types packages/telemetry-adapter/scripts/write-protobuf-fixture.ts`. To send it manually:

```sh
curl -sS -X POST http://127.0.0.1:4318/v1/traces \
  -H 'content-type: application/x-protobuf' \
  --data-binary @packages/telemetry-adapter/tests/fixtures/openinference-trace.otlp.pb \
  -o /dev/null -w '%{http_code} %{content_type}\n'
```
