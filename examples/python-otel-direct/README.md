# Python → Sarvadrik with the standard OTLP exporter

Sends one OpenInference-shaped trace (agent → retriever, LLM, tool) using only the maintained
OpenTelemetry packages: `opentelemetry-sdk` and `opentelemetry-exporter-otlp-proto-http`
(OTLP/HTTP **protobuf**). No Sarvadrik-specific exporter, no JSON workaround, no Collector, no
model or network API call.

Start Sarvadrik first (`sarvadrik .`), then in an isolated environment:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Expected output ends with `SUCCESS`, and the run `python-otel-direct · answer question` appears
in Live and Runs with 4 spans and 18/6 tokens. Standard variables apply:

```sh
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces   # default used by app.py
OTEL_SERVICE_NAME=my-service
```

Never install these packages into the global Python environment.
