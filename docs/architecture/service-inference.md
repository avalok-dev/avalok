# Service inference and hierarchy

The analyzer's ownership boundary is a `ServiceUnit`, not a language-specific package. Units are
discovered from Node workspaces, Python project/requirements manifests, Compose build contexts, and
Dockerfiles with owned source. Evidence is merged when several signals describe the same
repository-relative directory.

Files belong to the longest matching service directory. This makes
`backend/app/services/research.py` part of the backend service even when a broader root workspace
also exists. Folder names improve display labels but never create a service without manifest,
deployment, Docker, or source-root evidence.

Service IDs derive from normalized repository-relative path segments. Integration IDs derive from
normalized integration identity. Edge IDs derive from source, target, and relationship. Discovery
order and runtime state do not participate, so rescans produce stable identities.

## System view

The default map shows service/application boundaries and meaningful models, databases, queues, and
external APIs. Routes, modules, and files remain inspector detail. Service metadata includes
languages, technologies, ports, Compose identities, routes, files, evidence, and confidence.

The system view is capped at 30 nodes. If detectors produce more, service nodes are retained and
lower-confidence integrations are omitted from the default view with a diagnostic. Sarvadrik does
not solve complexity by shrinking hundreds of file nodes.

## Relationships

Relationships retain semantics:

- `imports` for cross-service source imports;
- `depends on` for workspace or Compose deployment dependency;
- `uses` for evidence-backed integrations;
- `calls` for a literal host/port that uniquely matches another service.

Coexistence is not connectivity evidence. A frontend and backend are connected only when a literal
URL/host/port, Compose/proxy evidence, resolved import, or runtime observation supports the edge.

Runtime reconciliation keeps exact source path first, followed by longest service ownership,
unique `service.name`/Compose identity, route, port, and integration identity. Every accepted match
retains its evidence, while unmatched runtime entities stay visible.
