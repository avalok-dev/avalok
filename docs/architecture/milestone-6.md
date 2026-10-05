# Milestone 6 — Infrastructure Intelligence

> **Historical record.** Written while the product's working name was AgentMap (later Sarvadrik); the product is now **Avalok** (CLI `avalok`, environment variables `AVALOK_*`). Commands and names below are as they were at the time.

## Status and intent

Milestone 6 extends AgentMap from application and runtime understanding into infrastructure understanding. The implementation remains a bounded, local, static analysis pipeline. It reads repository files, records evidence, and infers relationships; it never runs Terraform, Helm, kubectl, cloud CLIs, provider plugins, provisioners, or user code.

The default graph answers one question: **how does the application get from source code to the infrastructure it runs on and depends on?** Detail views may expose lower-level resources, but the initial map is deliberately grouped so that subnet, security-group, policy, and generated-object fan-out does not overwhelm the system story.

## Scope boundary

Included:

- Terraform native `.tf` and JSON `.tf.json` configuration
- Kubernetes multi-document YAML manifests
- statically resolvable Helm charts, values, and templates
- high-value AWS resource inference
- application-to-deployment, configuration-to-deployment, and runtime-to-deployment reconciliation
- configured resource metrics and a schema for future observed metrics and cost data

Excluded:

- Terraform execution, planning, state inspection, provider installation, provisioners, `.tfvars`, and secret resolution
- Helm rendering or plugin execution
- kubectl access, live cluster discovery, admission behavior, and controller-generated objects
- dynamic HCL evaluation, arbitrary template functions, loops whose cardinality cannot be established, and provider-specific computed values
- fabricated utilization, performance, or cost data

## Parser choices

### Terraform

AgentMap uses HashiCorp's maintained `@cdktf/hcl2json` package rather than Terraform CLI output. It embeds the upstream Go HCL parser as WebAssembly, parses in-process, and neither starts Terraform nor downloads providers. The converted structure preserves unresolved expressions as Terraform interpolation strings, which AgentMap records and scans for static resource traversals without evaluating functions or variables. `.tf.json` uses the platform JSON parser and Terraform's documented block nesting rules.

The alternatives considered were `hcl2-parser` and a local syntax scanner. `hcl2-parser` is a larger GopherJS conversion whose latest release is from 2021; a local scanner would reduce dependency size but would not be a mature HCL grammar. The CDK for Terraform parser is maintained by HashiCorp, was updated in 2025, reports source-aware syntax errors, and fits the repository's Node runtime. It is therefore the safer compatibility choice. It remains an infrastructure discovery parser in AgentMap, not a Terraform evaluator: converted data is sanitized and bounded before it reaches the public model.

### Kubernetes

The existing mature `yaml` package parses multi-document YAML. A document is considered Kubernetes configuration only when it has the expected `apiVersion`, `kind`, and `metadata.name` shape. Secret values and sensitive-looking keys are never copied into public metadata. Unsupported custom resources are retained as bounded generic infrastructure records rather than interpreted as workloads.

### Helm

Helm support reads `Chart.yaml`, default `values.yaml`, and `templates/`. It performs a deliberately small substitution pass for direct `.Values` lookups plus common `.Release.Name`, `.Release.Namespace`, and `.Chart.Name` references. Safe `default`, `quote`, and `toString` pipelines are recognized when their input is otherwise static. Control flow, `tpl`, `lookup`, arbitrary functions, and unresolved expressions remain unresolved and produce diagnostics. Helm itself is never invoked.

## Intermediate model

All three analyzers emit the same provider-neutral intermediate records before graph construction:

- `InfrastructureResource`: stable ID, source address, platform, resource kind, hierarchy, names, labels/selectors, images, ports, references, configured metrics, evidence, confidence, and default-visibility policy
- `InfrastructureRelationship`: source, target, semantic relationship, evidence, and confidence
- `InfrastructureAnalysis`: resources, relationships, diagnostics, and per-source metrics

The public graph uses infrastructure-specific entity kinds where the distinction changes comprehension (cloud, network, cluster, namespace, workload, container, gateway, load balancer, function, config, identity). Provider-specific resource types remain in metadata so future providers can use the same core model.

## Terraform inference

Terraform resources and modules receive stable addresses such as `aws_vpc.main` and `module.platform`. References in expressions create explicit `references` relationships. Local module sources are connected to their module call when the path is statically known. `count` and `for_each` are recorded as cardinality expressions; AgentMap does not multiply nodes unless the cardinality is a literal small value.

AWS resource types are mapped into a small ontology:

- network: VPC, subnet, gateway, route, security group
- traffic: load balancer, listener, target group, Route 53
- compute: EKS, node group, EC2, ECS, Lambda
- data: RDS, ElastiCache, MSK, S3, SQS, SNS, DynamoDB
- identity: IAM roles and policies
- deployment: `helm_release`

Recognized resource links come from explicit references, well-known attributes, and exact name/ARN expressions. Provider and region are recorded when they are literal. Unresolved variables are evidence, not values.

## Kubernetes inference

The analyzer recognizes workloads (Deployment, StatefulSet, DaemonSet, Job, CronJob, Pod), Service, Ingress, ConfigMap, Secret references, PVC, ServiceAccount, HPA, Namespace, and custom resources.

Relationships are deterministic:

- workload owns pod template and container detail
- Service selects a workload only when its selector is a subset of pod-template labels
- Ingress routes to a named Service backend in the same namespace unless explicitly qualified
- workload references ConfigMap, Secret, PVC, and ServiceAccount from the documented fields
- HPA targets its exact `scaleTargetRef`

Replicas, CPU/memory requests, and CPU/memory limits are stored as `configured` metrics. Missing values remain absent. Secret payloads are replaced by key names and counts only.

## Helm inference

A chart becomes a configuration boundary. Statically rendered Kubernetes resources retain both template evidence and chart/value evidence. A local Terraform `helm_release` is linked to a chart when its `chart` expression resolves to that chart path. Release name and namespace are used as corroborating evidence; they never override contradictory manifest identities.

## Cross-layer reconciliation

Reconciliation uses weighted, explainable evidence and never relies on name similarity alone when a stronger identifier exists.

Application to infrastructure:

1. exact container image or compose image match
2. exact declared service/runtime name match
3. workload/service labels and selectors
4. port agreement as corroboration
5. directory ownership and local chart/module path

Terraform to Kubernetes/Helm:

1. local `helm_release.chart` path
2. exact release and namespace
3. explicit cluster name annotations or values
4. Terraform expression references

Runtime to deployment:

1. reconcile runtime activity to the application entity using existing Milestone 5 rules
2. follow only direct, evidence-backed `deployed-as` relationships to workload/deployment context
3. attach deployment context to the event while keeping the application as the primary activity target

Runtime activity is not propagated to a VPC, cloud account, EKS cluster, database, or load balancer unless the event itself contains matching infrastructure semantics. This prevents the map from claiming unsupported live activity.

## Graph grouping and visibility

Every infrastructure entity remains addressable in analysis output, but metadata marks it as either `system` or `detail` visibility.

- **All**: application, runtime overlay, and system-level infrastructure
- **Application**: source-derived services and integrations
- **Infrastructure**: all infrastructure, including detail resources for drill-down
- **Runtime**: entities touched by the selected run plus their direct deployment context

Cloud/provider, cluster, namespace, Terraform module, and Helm chart boundaries are hierarchy parents. Subnets, security groups, IAM policies, generated container nodes, and similar resources default to detail visibility. Inspector metadata lists child counts and important child summaries so hierarchy is useful even before expanding the infrastructure-only view.

The analyzer no longer solves graph overload by deleting infrastructure records. Visibility is a presentation policy; analysis remains complete within repository limits.

## Metrics and cost foundation

The shared schema defines metric and cost attribution records with provenance:

- status: `configured`, `observed`, or `estimated`
- source and timestamp/window
- unit and numeric or original textual value
- confidence and evidence

Milestone 6 populates only configured Kubernetes requests, limits, and replicas, plus literal Terraform capacity properties such as instance class, memory size, desired count, or allocated storage. It does not invent utilization. Cost attribution remains empty unless an adapter supplies real or explicitly estimated data in a later milestone.

## Failure behavior and diagnostics

Each file is isolated. Malformed HCL, JSON, YAML, or a Helm template produces a file-scoped diagnostic and does not abort repository analysis. Unresolved expressions are preserved in redacted form with a reason. Unsupported resource kinds are represented generically when safe. Limits and partial analysis flags remain visible in the existing repository analysis contract.

No diagnostic or metadata field includes secret values, environment values, Terraform variable values, Kubernetes Secret payloads, provider credentials, or state data.

## Fixture and verification strategy

The test matrix contains dedicated fixtures for Terraform AWS, Kubernetes workloads, Helm, EKS reconciliation, serverless infrastructure, malformed Terraform, malformed Kubernetes, malformed Helm, secret safety, and duplicate reconciliation. A unified `infrastructure-ai-platform` example combines frontend, backend, worker, Terraform AWS, Helm/Kubernetes, PostgreSQL/RDS, Redis/ElastiCache, S3, and runtime-compatible service names.

Verification covers parser isolation, stable IDs, evidence and confidence, selector semantics, reference edges, hierarchy/default visibility, secret redaction, deterministic repeated output, bounded performance, application/deployment reconciliation, runtime deployment context, and production build/type/lint/format checks.

## Milestone 7 recommendation

The next milestone should add opt-in live cloud and cluster adapters behind explicit credentials and permission scopes, then layer observed utilization and provider billing data onto the provenance-aware metric model introduced here. Static Milestone 6 evidence must remain independently useful and auditable.
