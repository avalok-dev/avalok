# Python repository analysis

Avalok analyzes Python statically inside `@visual-system/analyzer`. It never invokes Python,
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

## Parser limits and the `source.python-syntax` diagnostic

Python is parsed with `@lezer/python` (1.1.19, the latest release), which cannot read some valid modern syntax. Avalok therefore never treats a parse error as proof that code is invalid: the diagnostic is `info` severity and says the parser could not fully read the file, so some detected imports or routes may be missing.

Before reporting, the analyzer re-checks the file with same-length rewrites of the gaps it knows how to work around (`normalizeForSyntaxCheck` in `packages/analyzer/src/python-parser.ts`): float literals ending in a dot (`2.`), decorators with an arbitrary expression (`@a.b[0](1)`), and t-strings. The rewritten text is used only for that check, never for extracting signals.

Valid syntax that is still reported as parser-limited: parenthesized `with (a as b, c as d):` and a star in a subscript (`a[*b]`). Tests pin both lists (`packages/analyzer/tests/python-parse-gaps.test.ts`), using Python 3.14's own `ast.parse` as ground truth. Found 2026-10-07 when 5 of 56 valid files in a real repository were flagged because of trailing-dot floats.
