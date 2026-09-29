# Python repository analysis

Sarvadrik analyzes Python statically inside `@visual-system/analyzer`. It never invokes Python,
imports a target module, creates an environment, installs a dependency, or evaluates project
configuration.

## Inputs

Supported inputs are `.py`, `pyproject.toml`, root and `requirements/*.txt` requirements files,
Pipfile, and `.env.example`/sample/template files. PEP 621 and Poetry dependency metadata are read
from TOML data. Requirement markers and constraints are discarded after extracting a normalized
distribution name. Malformed documents and lines produce diagnostics without stopping the scan.

Python source uses `@lezer/python`, a pure-JavaScript grammar parser. Lezer gives the Node analyzer
a non-executing syntax tree with error recovery and no native binding or dependency on the user's
Python installation. The V1 extractor reads architecture-oriented signals: imports, relative
imports, declarations, decorators, literal calls, environment variable names, literal URLs,
connection schemes, and static route decorators.

Local imports resolve against the owning project directory, conventional `src/` roots, package
directories, `__init__.py`, and relative import levels. Unresolved expected-local imports are
diagnostics, not fatal errors.

## Frameworks and integrations

FastAPI recognition combines dependency, import, and `FastAPI()` construction evidence. Literal
`@app`/`@router` HTTP decorators become route metadata under the service. `APIRouter` and
`include_router` usage is retained as source evidence; dynamic router composition is not executed.

Flask recognizes `Flask`, `Blueprint`, and literal route decorators. Django V1 recognizes project
structure and Django imports/dependencies; it does not evaluate settings or URL configuration.

AI/data coverage includes OpenAI, Anthropic, OpenAI Agents SDK imports, LangChain, LlamaIndex, MCP,
OpenInference, OpenTelemetry, SQLAlchemy, PostgreSQL, SQLite, MySQL, MongoDB, Redis, Celery, and RQ.
A dependency alone stays low-confidence technology metadata. An integration is promoted only when
independent usage, call, environment-name, connection-scheme, Compose, or runtime evidence raises
confidence.

Only environment variable names are retained. Connection strings contribute their scheme only.
External HTTP services require a literal hostname; arbitrary strings and dynamically computed
targets are not guessed.

## Limits

This is architecture analysis, not Python type checking. V1 does not resolve dynamic imports,
metaprogramming, framework plugin loading, computed decorators, dependency injection semantics, or
runtime settings. It intentionally favors explainable partial results over false certainty.
