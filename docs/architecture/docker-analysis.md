# Docker and Compose analysis

Docker inputs are deployment evidence. AgentMap never invokes Docker, builds an image, pulls an
image, runs Compose, executes an instruction, or resolves a secret.

## Dockerfiles

The static Dockerfile reader handles comments, line continuations, shell/JSON command forms, and
multi-stage `FROM`. It records base images, stage aliases, work directory, copied paths, exposed
ports, entrypoint, command, and environment/argument names. Sensitive-looking command assignments
and URL credentials are redacted before they enter analysis data.

A Dockerfile strengthens the service rooted in its directory. A Python base image, Uvicorn command,
and exposed port corroborate a detected FastAPI service; Docker itself is not rendered as a
meaningless top-level node.

## Compose

`docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, and `compose.yaml` are parsed as bounded
YAML data. AgentMap retains service names, build contexts, Dockerfile names, image names, published
and target ports, `depends_on`, network/volume names, healthcheck presence, and environment variable
names.

Environment values are discarded at parse time. Literal passwords, database URLs, API keys, and
tokens in Compose therefore cannot appear in evidence, the graph, cache, or UI.

Build contexts map Compose services to statically discovered ownership boundaries. Known
PostgreSQL, Redis, MySQL/MariaDB, MongoDB, and RabbitMQ images may establish infrastructure
entities. `depends_on` becomes an explicit deployment dependency. It does not imply an application
call; calls require separate URL, port, proxy, source, or runtime evidence.

V1 does not expand Docker build arguments, execute variable interpolation, inspect image contents,
or model Swarm/Kubernetes behavior.
