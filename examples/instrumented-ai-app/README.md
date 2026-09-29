# Instrumented AI app

This deterministic local example emits a valid OTLP/HTTP JSON trace containing an HTTP request, OpenInference agent, retriever, tool, and model spans, a generic SQLite span, and a response step. It uses no paid provider and no credentials.

Run it with the Sarvadrik collector and web application as documented in `docs/architecture/opentelemetry.md`.

For a moderate local load check, emit one large trace or several smaller traces:

```bash
pnpm --filter @visual-system/instrumented-ai-app load -- --spans=1000
pnpm --filter @visual-system/instrumented-ai-app load -- --count=25 --spans=100
```

Set `OTEL_SERVICE_NAME` to exercise exact service-name reconciliation against another loaded repository. For example, use `OTEL_SERVICE_NAME=backend` with the Milestone 6 golden infrastructure fixture.
