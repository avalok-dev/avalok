# Milestone 6 manual acceptance plan

From the repository root, install the locked dependencies and start AgentMap:

```bash
corepack pnpm install --frozen-lockfile
pnpm dev
```

Open the URL printed by Next.js, normally `http://localhost:3000`. Use **Source** to select fixtures. The tests below require no AWS credentials, kubeconfig, Terraform, Helm, or kubectl installation.

## A. Regression

1. Select **Demo fixture**. Confirm Map, Live, Runs, replay, speed, seek, reset, and inspector still work.
2. Select **FastAPI fixture** and **Polyglot fixture**. Confirm JS/TS, Python, Docker, Compose, routes, ports, imports, evidence, and confidence remain visible.
3. If local Codex or Claude observations exist, select each source. Confirm historical runs open and live sources continue tailing; **Jump to Live** returns to the newest event.
4. Complete section G to verify OTLP/OpenInference, Live, Runs, replay, and runtime reconciliation.

Expected: existing application/runtime behavior is unchanged. Missing local Codex/Claude data is shown as unavailable, not as fabricated sessions.

## B. Terraform

Select **Terraform AWS**.

- **All**: expect AWS, VPC, EKS, ALB, PostgreSQL/RDS, and S3 system-story nodes.
- **Infrastructure**: expect subnet and IAM detail in addition to the system nodes.
- Inspect VPC, subnet, EKS, ALB, RDS, and S3. Expect provider, Terraform address/type, safe configuration, source file, evidence, and confidence.
- Expect reference-backed EKS → IAM/subnet, ALB → subnet, and subnet → VPC relationships.

Should not appear: credentials, account secrets, state/tfvars contents, provider binaries, three invented pod identities, remote-module contents, or a claim that these resources are live.

## C. Kubernetes

Select **Kubernetes**.

Expected deterministic path:

```text
Ingress · Research → Service · Backend → Deployment · Backend → Container · Api
```

Inspect the Deployment and container. Expect namespace `research`, three configured replicas, image `ghcr.io/agentmap/backend:1.2.3`, port `8000`, CPU request `250m`, CPU limit `1`, memory request `256Mi`, and memory limit `512Mi`. Expect relationships to ConfigMap `backend-config`, Secret `backend-secrets`, ServiceAccount `backend`, and HPA min/max `2/8`.

Search the UI and serialized test output for `fixture-secret-must-not-leak`; it must not appear. Secret key names/references may appear, but values and decoded data must not.

## D. Helm

Select **Helm chart**.

Expect chart `research-api`, Deployment, Service, and Ingress. Values should resolve replicas `2`, image `ghcr.io/agentmap/backend:1.2.3`, port `8000`, host `research.example.test`, and configured CPU/memory requests and limits. The chart should be configuration evidence and the Service/Ingress relationships should match Kubernetes semantics.

Run the focused test below and inspect the malformed-Helm case for an unresolved-expression diagnostic:

```bash
pnpm --filter @visual-system/analyzer exec vitest run tests/infrastructure.test.ts --reporter=verbose
```

No Helm command, chart hook, plugin, install, or template execution is used.

## E. EKS

The source picker’s **Infrastructure AI platform** fixture provides the full EKS story; the focused `eks-unified` test proves the exact cluster/namespace association.

1. Select **Infrastructure AI platform**.
2. In **All**, inspect AWS Infrastructure → Research Platform (EKS) → Namespace · Research → Deployment · Backend → Backend API.
3. Switch to **Infrastructure** to reveal subnet, IAM, and container detail.

EKS-to-namespace and ALB-to-Ingress links exist only because explicit `agentmap.dev/cluster` and `agentmap.dev/load-balancer` labels match Terraform resource identity. Node groups/subnets/IAM stay grouped or detail-only. No association is claimed from directory proximity alone.

## F. Unified system

Select **Infrastructure AI platform**.

Expected application nodes: Frontend, Backend API, Worker, OpenAI, PostgreSQL, Redis, and AWS integration.

Expected infrastructure nodes: AWS Infrastructure, VPC, ALB, EKS, RDS/PostgreSQL, ElastiCache/Redis, S3, Terraform module/release, Helm chart, research namespace, three Deployments, backend Service, and Ingress. PostgreSQL and Redis are multi-layer entities rather than duplicated application/cloud nodes. Expect exactly three application `deployed as` workload relationships.

**All** tells the combined system story; **Application** isolates source architecture; **Infrastructure** shows configuration and drill-down; **Runtime** contains only observed/runtime context.

## G. Live OTEL

Keep `pnpm dev` running. In a second terminal run the deterministic local example with a service name that exactly matches the golden backend directory:

```bash
OTEL_SERVICE_NAME=backend pnpm --filter @visual-system/instrumented-ai-app dev
```

Generate one request from a third terminal:

```bash
curl -sS -X POST http://127.0.0.1:4319/prompt \
  -H 'content-type: application/json' \
  -d '{"prompt":"Explain the infrastructure fixture"}'
```

In AgentMap, first keep the golden repository loaded, then select the newest **Telemetry** run. Expect the OpenInference agent/model/tool/database path to replay. Backend API and its direct Backend Deployment context should become observed. AWS, VPC, ALB, and EKS must not be marked observed because an application span does not prove infrastructure activity.

## H. Resource configuration

Inspect **Deployment · Backend** in the golden fixture. Expect:

- replicas `3`, configured;
- CPU request `250m`, configured;
- CPU limit `1`, configured;
- memory request `256Mi`, configured;
- memory limit `512Mi`, configured;
- each value’s source path and configuration field.

None may be labeled usage, observed utilization, live pods, or cost.

## I. AWS resource details

Inspect EKS, RDS/PostgreSQL, S3, ALB, and then choose **Terraform AWS** or run the `terraform-serverless` fixture test to inspect Lambda.

Expect architecture-relevant values only: EKS name/version when declared, RDS engine/class/storage, S3 identity, ALB type/scheme when declared, and Lambda runtime/memory/timeout. The inspector must not dump raw HCL, credentials, account IDs as prominent identity, or large policy documents.

## J. Security

Run:

```bash
git status --short
pnpm --filter @visual-system/analyzer exec vitest run tests/infrastructure.test.ts
rg -n 'terraform\.tfstate|\.auto\.tfvars|terraform\.tfvars' .agentmapignore .gitignore packages/analyzer/src
```

Verify the analysis does not change repository files. Process inspection should show no `terraform`, `kubectl`, `helm`, or AWS CLI child process. The analyzer never reads state/tfvars, downloads remote modules, decodes Secrets, follows external symlinks, reads credentials, or contacts AWS/Kubernetes. Repository files listed by `git status` are development changes, not analyzer output.

## K. Bad input

Run:

```bash
pnpm --filter @visual-system/analyzer exec vitest run tests/infrastructure.test.ts --reporter=verbose
```

Expected: malformed HCL, malformed Kubernetes YAML, malformed Helm values/templates, unknown/custom Kubernetes resources, unsupported Terraform resources, unresolved references, and remote module sources produce bounded file-scoped diagnostics or safe generic metadata. Analysis continues and the UI does not crash. No remote module is fetched.

## L. Graph quality

Inspect **All** and **Infrastructure** for:

- no graph spaghetti in the default system story;
- no duplicate Frontend/Backend/Worker, PostgreSQL, Redis, workload, or Terraform/Helm/Kubernetes identity;
- subnet, security-group, IAM, and container fan-out hidden by default;
- no fake individual pods from replica counts;
- correct Service selector, Ingress backend, namespace, image, application/workload, EKS, and ALB reconciliation;
- evidence and confidence on every important entity/edge;
- stable positions and IDs when reloading/rescanning the same fixture.

Report any missing evidence, fuzzy/overconfident association, graph jumping, or unexpected duplicate as a defect.

## M. Metric honesty and final quality gate

Confirm the UI distinguishes configured CPU/memory/replicas from observed runtime metrics, application latency from infrastructure latency, and estimated cost from actual cost. With no source, show **Unavailable** or **Not observed**, never a fake zero.

Run the final gate:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
CI=true pnpm test
pnpm build
```

Expected: all commands exit zero. The current Milestone 6 handoff has 78 passing tests and a successful production build.
