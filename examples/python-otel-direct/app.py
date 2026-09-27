"""Send one OpenInference-shaped trace to AgentMap with the standard OTLP/HTTP protobuf exporter.

No AgentMap exporter, no JSON workaround, no Collector. Configuration uses the standard
OpenTelemetry environment variables; the default endpoint is AgentMap's local receiver.
Run inside an isolated virtual environment (see README.md). No model or network API is called.
"""

import os
import sys
import time

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.trace import Status, StatusCode

ENDPOINT = os.environ.setdefault(
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://127.0.0.1:4318/v1/traces"
)
SERVICE = os.environ.get("OTEL_SERVICE_NAME", "python-otel-direct")


class RecordingExporter(OTLPSpanExporter):
    """The standard exporter, recording each export result so the example can report it."""

    results = []

    def export(self, spans):
        result = super().export(spans)
        self.results.append(result)
        return result


def main() -> int:
    exporter = RecordingExporter()  # http/protobuf is this exporter's only encoding.
    provider = TracerProvider(resource=Resource.create({"service.name": SERVICE}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("agentmap.examples.python-otel-direct", "0.1.0")

    with tracer.start_as_current_span(
        "answer question", attributes={"openinference.span.kind": "AGENT"}
    ):
        with tracer.start_as_current_span(
            "retrieve context",
            attributes={"openinference.span.kind": "RETRIEVER", "input.value": "fixture query"},
        ):
            time.sleep(0.01)
        with tracer.start_as_current_span(
            "chat completion",
            attributes={
                "openinference.span.kind": "LLM",
                "llm.model_name": "local-fixture-model",
                "llm.provider": "fixture",
                "llm.token_count.prompt": 18,
                "llm.token_count.completion": 6,
            },
        ):
            time.sleep(0.02)
        with tracer.start_as_current_span(
            "lookup tool", attributes={"openinference.span.kind": "TOOL", "tool.name": "lookup"}
        ) as tool:
            tool.set_status(Status(StatusCode.OK))

    provider.shutdown()
    succeeded = bool(exporter.results) and all(
        result.name == "SUCCESS" for result in exporter.results
    )
    print(
        f"Exported {len(exporter.results)} batches to {ENDPOINT} as {SERVICE}: "
        f"{'SUCCESS' if succeeded else 'FAILURE'}"
    )
    return 0 if succeeded else 1


if __name__ == "__main__":
    sys.exit(main())
