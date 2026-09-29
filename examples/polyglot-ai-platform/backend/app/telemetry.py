import hashlib
import json
import os
import time
import urllib.request

def attribute(key, value):
    if isinstance(value, bool):
        encoded = {"boolValue": value}
    elif isinstance(value, int):
        encoded = {"intValue": str(value)}
    else:
        encoded = {"stringValue": str(value)}
    return {"key": key, "value": encoded}

def nanos(milliseconds):
    return str(milliseconds * 1_000_000)

def emit_trace(prompt="Explain the fixture"):
    started = int(time.time() * 1000)
    trace_id = hashlib.sha256(f"{prompt}:{started}".encode()).hexdigest()[:32]

    def span(span_id, name, offset, duration, attributes, parent=None, kind=1):
        return {
            "traceId": trace_id,
            "spanId": span_id,
            **({"parentSpanId": parent} if parent else {}),
            "name": name,
            "kind": kind,
            "startTimeUnixNano": nanos(started + offset),
            "endTimeUnixNano": nanos(started + offset + duration),
            "attributes": attributes,
            "status": {"code": 1},
        }

    backend_spans = [
        span("1000000000000001", "POST /chat", 0, 700, [
            attribute("http.request.method", "POST"),
            attribute("http.route", "/chat"),
            attribute("code.file.path", "backend/app/main.py"),
        ], kind=2),
        span("1000000000000002", "Research agent", 40, 560, [
            attribute("openinference.span.kind", "AGENT"),
            attribute("agent.name", "Research Agent"),
            attribute("code.file.path", "backend/app/agent.py"),
        ], "1000000000000001"),
        span("1000000000000003", "Fixture retrieval", 110, 90, [
            attribute("openinference.span.kind", "RETRIEVER"),
        ], "1000000000000002"),
        span("1000000000000004", "SELECT research context", 220, 80, [
            attribute("db.system", "postgresql"),
            attribute("db.operation.name", "SELECT"),
            attribute("code.file.path", "backend/app/db.py"),
        ], "1000000000000002"),
        span("1000000000000005", "Deterministic model", 330, 180, [
            attribute("openinference.span.kind", "LLM"),
            attribute("llm.provider", "fixture"),
            attribute("llm.model_name", "deterministic-model"),
            attribute("llm.token_count.prompt", 16),
            attribute("llm.token_count.completion", 8),
        ], "1000000000000002"),
    ]
    worker_spans = [
        span("1000000000000006", "Queue follow-up", 530, 100, [
            attribute("messaging.system", "redis"),
            attribute("code.file.path", "worker/tasks.py"),
        ], "1000000000000001"),
        span("1000000000000007", "Redis cache", 550, 45, [
            attribute("db.system", "redis"),
            attribute("code.file.path", "worker/tasks.py"),
        ], "1000000000000006"),
    ]
    payload = {"resourceSpans": [
        {
            "resource": {"attributes": [attribute("service.name", "research-api")]},
            "scopeSpans": [{"scope": {"name": "sarvadrik.python-example"}, "spans": backend_spans}],
        },
        {
            "resource": {"attributes": [attribute("service.name", "research-worker")]},
            "scopeSpans": [{"scope": {"name": "sarvadrik.python-example"}, "spans": worker_spans}],
        },
    ]}
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://127.0.0.1:4318/v1/traces")
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=3) as response:
        return response.status
