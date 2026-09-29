# Milestone 5 acceptance guide

> **Historical record.** Written while the product's working name was AgentMap; the product is now **Sarvadrik** (CLI `sarvadrik`, environment variables `SARVADRIK_*`). Commands and names below are as they were at the time.

Use Node `24.19.0` and pnpm `11.19.0`. Run every command from the repository root unless a step
says otherwise.

## Automated baseline

```bash
node --version
pnpm --version
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands pass. The production build may retain the pre-existing non-blocking message
about the optional Next.js ESLint plugin.

## A. Milestones 1-4 regression

Start AgentMap:

```bash
pnpm dev
```

Open `http://localhost:3000`.

1. Choose **Demo fixture**. Verify Map, Live, Runs, play/pause, seek, speed, timeline selection,
   inspector, metrics, and replay still work.
2. Choose an existing **Codex** session. Verify history loads, Files/Terminal/MCP/model activity is
   preserved, Live follows appended events, scrubbing stops follow mode, and **Jump to live** resumes.
3. Choose an existing **Claude Code** run. Verify its normalized observations and trace hierarchy.
   Use `docs/development/milestone-4-acceptance.md` to create one if no local run exists.
4. Choose **Current repository**. Verify the existing AgentMap JS/TS packages and evidence appear.
   Choose a runtime run afterward and toggle **Show execution**.
5. Run the existing deterministic telemetry example in a second terminal:

   ```bash
   pnpm --filter @visual-system/instrumented-ai-app dev
   ```

   Then send a request in a third terminal:

   ```bash
   curl -sS -X POST http://127.0.0.1:4319/prompt \
     -H 'content-type: application/json' \
     -d '{"prompt":"Explain the local fixture"}'
   ```

   Choose the newest **OTLP** run. Verify OpenInference agent/retriever/tool/model spans, SQLite,
   replay, Live arrival, and Jump to Live behave as in Milestone 4.

## B. FastAPI fixture

Open the source selector and choose **FastAPI fixture**. This analyzes
`packages/analyzer/tests/fixtures/python-fastapi`.

Expected default map:

- **Backend API** (FastAPI, Python, port 8000);
- **OpenAI**;
- **PostgreSQL**.

Select **Backend API**. The inspector should show `GET /health` and `POST /chat`, Python/FastAPI
metadata, owned files, port 8000, and evidence from `pyproject.toml`, Python imports/construction,
and the Dockerfile. Backend confidence should be Confirmed, OpenAI High, and PostgreSQL Medium with
the current fixture evidence.

## C. Polyglot fixture

Choose **Polyglot fixture**. This analyzes `examples/polyglot-ai-platform`.

Expected high-level nodes:

- Frontend;
- Backend API;
- Worker;
- OpenAI;
- PostgreSQL;
- Redis.

Expected relationships include Frontend → Backend API (`calls`, supported by the literal Compose
service URL), Compose deployment dependencies, Backend API → PostgreSQL/Redis, and Worker → Redis.
`depends on` is deployment evidence and must not be presented as an observed network call. Routes
and source files belong in the inspector, not as dozens of canvas nodes.

## D. Python live telemetry

Terminal 1:

```bash
pnpm dev
```

Terminal 2 (no Python package installation required):

```bash
python3 examples/polyglot-ai-platform/backend/fixture_server.py
```

Terminal 3:

```bash
curl -sS -X POST http://127.0.0.1:4320/chat \
  -H 'content-type: application/json' \
  -d '{"prompt":"Explain the polyglot fixture"}'
```

In AgentMap, choose **Polyglot fixture first**, then choose the newest OTLP run with service
`research-api`. Completed spans should arrive live and replay in this order/shape:

```text
POST /chat
  -> Research Agent
     -> Fixture retrieval
     -> PostgreSQL query
     -> Deterministic model
  -> Queue follow-up
     -> Redis cache
```

The runtime execution nodes remain visible while Backend API, Worker, PostgreSQL, and Redis receive
the static/runtime overlay.

## E. Reconciliation

Inspect these event-to-architecture matches in the normalized event view:

- `backend/app/main.py` and `service.name=research-api` → **Backend API**;
- route `/chat` → **Backend API** route metadata;
- `db.system=postgresql` → **PostgreSQL**;
- `worker/tasks.py` → **Worker**;
- `db.system=redis` → **Redis**.

The current event metadata should contain `architectureEntityIds` and `architectureMatches` with
match type, confidence, and a readable evidence sentence. Unknown runtime nodes must remain visible
rather than being forced onto a static component.

## F. Docker Compose without Docker

Choose **Polyglot fixture** and inspect its evidence. Do not run `docker compose`. The same expected
services and deployment edges should appear from static parsing alone. Backend API should show port
8000; the map should not contain a generic top-level “Docker” node.

Focused automated verification:

```bash
pnpm --filter @visual-system/analyzer test
```

The golden test asserts Frontend, Backend API, Worker, OpenAI, PostgreSQL, Redis, stable IDs, bounded
node count, Compose relationships, and absence of literal Compose secret values.

## G. Safety

Before and after selecting each repository fixture:

```bash
git status --short
```

Analysis must not modify the target fixture. It should still work with Docker stopped and without a
Python virtual environment. Watch the terminal running `pnpm dev`: selecting a fixture must not run
Python, pip, uv, poetry, npm in the target, Docker, Compose, or target scripts. Disconnecting the
network must not prevent analysis.

The polyglot Compose fixture includes recognizable placeholder secret values. Search the browser
inspector/evidence and API response: only `DATABASE_URL` and `OPENAI_API_KEY` names may appear, not
their literal values. The automated safety test also creates an external symlink and `.venv`; their
contents must not appear in analyzed files.

## H. Bad input

Run:

```bash
pnpm --filter @visual-system/analyzer test
```

The `malformed` fixture covers invalid Python, pyproject, requirements, and Compose. The
`unsupported-go` fixture covers inventory-only language reporting. The temporary safety fixture
covers a large ignored virtualenv path and an external symlink. Expected behavior is a bounded
warning/diagnostic and useful partial output—never a crash, execution, or fabricated architecture.

## I. Architecture quality review

On both allowlisted fixtures, explicitly look for:

- file-node or route-node explosion;
- duplicate services, databases, or integrations;
- incorrect FastAPI/Flask/Django detection;
- OpenAI/Anthropic nodes supported only by a dependency;
- a Compose `depends_on` edge mislabeled as an application call;
- wrong file ownership or unresolved local Python imports;
- incorrect runtime mapping or overconfident matches;
- graph spaghetti, unstable positions, or graph jumping after Rescan;
- missing entity/relationship evidence.

The normal polyglot fixture should stay well below the 30-node system-view budget.

## J. Existing feature regression

Finally switch back, in order, to a Codex run, a Claude Code run, the
`instrumented-ai-app` telemetry run, and Demo. Verify source switching, replay state, Live, Jump to
Live, raw/normalized inspection, metrics, and the established visual language remain unchanged.
