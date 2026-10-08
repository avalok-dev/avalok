# Avalok product and release plan

> **Active priority (2026-10-06):** the free open-source launch, tracked in [OPENSOURCE_LAUNCH_PLAN.md](OPENSOURCE_LAUNCH_PLAN.md). The paid-cloud sections below are paused until real users and design partners ask for them; `avalok-cloud` is paused at C1.

Updated 2026-10-03. This is the working plan for the Apache-licensed local product and a first paid hosted product. Status is based on the code and release records in this repository, not a claim that an unpublished service exists.

## From the first idea to now

The original idea was three layers: **Architecture** (what exists), **Runtime** (what happened), and **Intelligence** (why it matters). The current developer preview implements the first two substantially. It has static JS/TS and Python analysis, Docker/Compose, Terraform, Kubernetes, Helm and AWS configuration inference; a map and inspector; Codex, Claude Code and OTLP/OpenInference runtime data; replay, reconciliation, local persistence, and an installable CLI candidate. Run/node/connection statistics and an offline OpenAI Agents trace importer started the intelligence layer. There is **no hosted Avalok service, account, checkout, subscription, or paid entitlement** yet. See [project context](PROJECT_CONTEXT.md) and the [release checklist](releases/developer-preview.md).

The table is a checklist coverage view, not a quality score or percent of engineering effort. Each fraction counts the named capabilities in its row; a capability can still need release verification.

| Track         | Checklist chart | Coverage | What is present                                                                                           | Next gap                                                                                            |
| ------------- | --------------- | -------: | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Architecture  | `██████░`       |      6/7 | JS/TS, Python, Docker/Compose, Terraform, Kubernetes/Helm/AWS, evidence and layer filters                 | Export a clean, sanitized architecture diagram                                                      |
| Runtime       | `██████░`       |      6/7 | Codex, Claude hooks/OTLP, generic OTLP/OpenInference, replay, reconciliation, offline OpenAI trace import | Supported Dots cloud activity ingestion                                                             |
| Intelligence  | `████░░░`       |      4/7 | Run/node/edge statistics, local run findings, memory/retrieval summary, map traffic/health cues           | Cost attribution, comparisons, actionable recommendations                                           |
| Local release | `█████░░░`      |      5/8 | CLI, packaged candidate, cross-platform smoke, public docs, CI                                            | Public repository, npm publication, website                                                         |
| Paid cloud    | `░░░░░░░`       |      0/7 | Product boundary documented only                                                                          | Identity, hosted ingestion, durable storage, entitlement, checkout, alert delivery, private sharing |

The local findings and map cues above were added in this working tree after the last release-candidate record and need the verification gates below before publication.

## Product boundary

**Free Apache-2.0 local edition:** static scanning; architecture and unified map; local Codex, Claude and OTLP traces; live view and replay; one-run node/connection statistics; local run findings and memory/retrieval activity; a manual, reviewed v1 run JSON export (working tree); and community adapters. Sanitized diagram export remains next. It stays useful without an account or an Avalok network connection. No artificial cap on local runs.

**First paid product, Avalok Cloud Solo (proposed):** persistent hosted trace history, up to three private projects, development/staging/production labels, 30-day retention, private share links, and two email alert rules (failure rate and p95 latency). A trial price to test demand is **$29/month for one user**, subject to customer interviews and actual hosting-cost measurements. Put hard ingest/storage quotas and a clear overage policy in the offer before charging. This is a proposed offer, **not a product that can be bought today**.

**Team/enterprise later:** multiple seats, SSO/SAML/SCIM, RBAC, audit exports, retention controls, regional residency, private networking, deployment options, policy checks, and advanced AI explanations. Do not promise these in Solo. Dots-specific activity can become an integration when documented access and stable event fields permit it.

Keep hosted ingestion, identity, billing and entitlements in a separate private commercial codebase. Share the Apache schemas, normalizers, graph and UI contracts. The existing public source remains Apache-2.0; do not add a license check or cloud dependency to the local executable.

## License decision

**Keep Apache-2.0.** Both Apache-2.0 and MIT allow commercial use, modification and redistribution. Apache-2.0 provides an explicit contributor patent grant and patent-claim termination, and requires preserving the license and applicable notices. Its trademark clause also makes clear that the software license does not grant the Avalok brand. MIT is shorter and simpler but has no express patent clause. Neither license prevents someone else from hosting a competing service, so the paid value must be operations, collaboration, retention and support rather than exclusive rights to the local code. A separately written, unpublished hosted service can use commercial terms; check contributor provenance before moving third-party contributions across that boundary. This is a product recommendation, not legal advice. Sources: [Apache-2.0 text](https://opensource.org/license/Apache-2.0), [MIT text](https://opensource.org/license/mit), [GitHub licensing guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

## Feature decisions

| Priority | Feature                                                                   | Edition                          | Status          | Acceptance condition                                                                     |
| -------- | ------------------------------------------------------------------------- | -------------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| P0       | Reliable install and first-run demo                                       | Free                             | Candidate       | Clean install on macOS, Linux and Windows; no user paths/secrets in artifact             |
| P0       | Evidence-backed map + local replay                                        | Free                             | Built           | Analyzer remains read-only; unmatched runtime entities remain visible                    |
| P0       | Local run findings for failures, slow steps, retries and memory/retrieval | Free                             | Working tree    | Clearly labels observed vs unavailable; no false “alert sent” claim                      |
| P0       | Node call/failure badges and edge traffic/health                          | Free                             | Working tree    | Selected telemetry run only; ambiguous edge identity is not attributed                   |
| P0       | Reviewed, content-free v1 run JSON export                                 | Free                             | Working tree    | Exact bytes previewed before local download; no upload or account required               |
| P0       | Diagram export (SVG/PNG) with privacy preview                             | Free                             | Planned         | User reviews names/metadata before any export; no raw prompt or secret values by default |
| P0       | Hosted history + private projects                                         | Paid Solo                        | Not built       | Authenticated tenant isolation, quotas, 30-day retention and deletion tested             |
| P0       | Two persistent alert rules and email delivery                             | Paid Solo                        | Not built       | Rule evaluation, deduplication, delivery status, unsubscribe and test alert              |
| P0       | Checkout and self-service cancellation                                    | Paid Solo                        | Not built       | Stripe webhook-driven entitlement; failed payment and cancellation paths tested          |
| P1       | Private run links                                                         | Paid Solo                        | Not built       | Explicit share, expiring/revocable token, sanitized content                              |
| P1       | Cost analytics                                                            | Paid                             | Foundation only | Pricing source/version and token provenance shown; unknown cost stays unknown            |
| P1       | Run/environment comparison and architecture history                       | Paid                             | Not built       | Same-project comparable inputs and clear missing-data state                              |
| P1       | Public sanitized architecture and embeds                                  | Free distribution + paid hosting | Not built       | Publish allowlist and preview; never expose private endpoints or source by default       |
| P1       | Tool/environment setup sheet                                              | Free                             | Not built       | List detected tool and environment-variable names with evidence; never export values     |
| P1       | Draft MOP/runbook from the map                                            | Free draft + paid team workflow  | Not built       | Cite source evidence, flag inferred steps, require human review; never execute steps     |
| P2       | AI debugging and PR architecture checks                                   | Paid Team                        | Not built       | Evidence-linked suggestions, reviewable changes, predictable usage cost                  |
| P2       | Live AWS/cluster resource data                                            | Paid Team                        | Not built       | Explicit credentials, least privilege, observed provenance; never part of static scan    |

P0 is needed for the first release or paid pilot. P1 is useful after real users validate the core workflow. P2 is deliberately deferred until there is demand and operating capacity; it is not part of the initial paid promise.

## Dots integration

OpenAI's [Dots guide](https://learn.chatgpt.com/docs/dots) says Dots can coordinate work and create/continue local Codex tasks. A Dot's Activity screen is its current place to inspect task progress. The [enterprise local-access guide](https://learn.chatgpt.com/docs/enterprise/cloud-local-access) distinguishes local executor OpenTelemetry from cloud orchestration: local execution can emit supported events, while cloud orchestration does not flow to a local OTLP collector. It points enterprises to the Analytics API for aggregate Dot usage and the Compliance API for supported audit records. These are different products and coverage levels from the [OpenAI Agents API trace export](https://developers.openai.com/api/docs/guides/agents-api/observability), which Avalok already imports offline.

1. **Now:** document a reproducible Dot → local Codex task → Avalok Codex observation demo. Show the local task as Codex activity unless a supported field proves Dot origin; do not invent a Dot identity. Capture local executor OTLP in Avalok when configured.
2. **Next:** add an opt-in connector for supported enterprise Analytics/Compliance records only after validating a real workspace's access, schema, scope and privacy policy. Mark aggregates and audit records separately from full traces.
3. **Later:** if a documented Dot-specific trace/event export becomes available, normalize it through the runtime-adapter contract. Include delegated task graph, status, approvals, tools, errors, latency and usage only where actually present.

## Where to host and maintain it

Keep the **free local app** on GitHub and npm. A static documentation/marketing site can live at `avalok.dev`. For Solo, use `app.avalok.dev` for the authenticated dashboard and `ingest.avalok.dev` for OTLP/HTTP. A concrete first stack is a Next.js dashboard on Vercel, a bounded ingestion service on Google Cloud Run, managed Postgres for tenants/projects/run indexes, object storage for compressed trace payloads, and Stripe Checkout/Customer Portal for subscriptions. These are architecture choices to validate with a load test, not vendors already connected to this repository. Cloud Run supports request-driven scaling and max-instance limits; Stripe documents hosted Checkout and the self-service customer portal. Sources: [Cloud Run autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling), [Stripe Checkout pricing table](https://docs.stripe.com/payments/checkout/pricing-table), [Stripe customer portal](https://docs.stripe.com/customer-management).

Cloud upload must be **opt-in**. Put tenant/project API keys in the ingest boundary; redact at the local sender and again server-side; reject oversized requests; rate-limit per tenant; avoid storing prompt/output bodies by default; encrypt in transit and at rest; maintain tenant-isolation tests. Store only the metadata needed for dashboards in Postgres and enforce retention with a daily deletion job. Keep secrets out of the static scanner. Operate with CI deployment gates, managed backups and restore drills, health/error monitoring, ingestion lag and rejected-event metrics, budget alarms, and a short incident runbook. Start in one region and state that region clearly.

## Release sequence and gates

1. **Stabilize this local candidate:** restore dependencies; run format, lint, typecheck, tests, production build, release build and installed-package smoke. Manually inspect Demo, repository, Codex historical session, Live, memory findings and map activity. Update release records with actual results.
2. **Public preview:** choose the public GitHub repository and copyright holder; correct placeholder commit identity; confirm npm name, repository URL, security reporting, domain and site; merge to main; run CI and the publishable dry run; publish only after explicit maintainer approval. The detailed [developer-preview checklist](releases/developer-preview.md) remains the publication gate.
3. **Private paid pilot:** accept only the strict reviewed v1 export in an authenticated, project-scoped ingestion service with limits, server-side content checks, durable storage and deletion tests. Then add hosted history, rules, email and Stripe. The existing local download does not authorize upload; a separate opt-in sender is later work. Use test-mode checkout and synthetic telemetry. Run tenant-isolation, redaction, deletion, quota, cancellation and webhook replay tests. Invite a few design partners and measure actual ingest/storage/support cost.
4. **Paid launch:** publish Solo pricing, limits, data policy, support channel and cancellation terms only when a real customer can sign up, pay, send a trace, receive an alert, inspect history, and delete their data end to end.

Do not market local findings as paid production alerts, or label local Dot/Codex observations as full Dot cloud traces.
