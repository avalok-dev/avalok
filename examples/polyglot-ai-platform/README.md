# Polyglot AI platform

This deterministic fixture demonstrates Sarvadrik's TypeScript + Python + Docker Compose static
analysis and Python OTLP runtime reconciliation. The default live server uses only Python's standard
library. No Docker daemon, paid model, credentials, or dependency installation is required.

From the Sarvadrik repository root:

```bash
pnpm dev
python3 examples/polyglot-ai-platform/backend/fixture_server.py
curl -sS -X POST http://127.0.0.1:4320/chat \
  -H 'content-type: application/json' \
  -d '{"prompt":"Explain the fixture"}'
```

The production-shaped `backend/app/main.py` shows the FastAPI entry point that static analysis
recognizes. To run that variant, create an isolated environment and install the example requirements;
never install them globally.

```bash
python3 -m venv examples/polyglot-ai-platform/.venv
examples/polyglot-ai-platform/.venv/bin/pip install -r examples/polyglot-ai-platform/backend/requirements.txt
examples/polyglot-ai-platform/.venv/bin/uvicorn app.main:app \
  --app-dir examples/polyglot-ai-platform/backend --port 4320
```

The Compose file is analysis input. Sarvadrik does not run it.
