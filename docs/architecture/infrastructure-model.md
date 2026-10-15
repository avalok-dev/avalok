# Infrastructure model

Infrastructure parsers emit `InfrastructureAnalysis`: provider-neutral resources, semantic relationships, diagnostics, and source counts. A resource keeps a stable address, platform/provider, ontology kind, hierarchy parent, system/detail visibility, names, labels/selectors, images, ports, references, configured metrics, evidence, and confidence.

The graph projection uses explicit infrastructure entity kinds for cloud, network, cluster, namespace, workload, container, gateway, load balancer, function, config, and identity. Provider-specific types stay in `metadata.architecture.resourceType`; the core model is not AWS-specific.

Application entities default to the application layer. Infrastructure entities default to the infrastructure layer. A reconciled managed database can belong to both layers, preventing a generic PostgreSQL node and an RDS PostgreSQL node from appearing as duplicates.

Hierarchy and visibility are separate from discovery. All safely analyzed resources remain in the graph data. The default **All** view hides detail resources; **Infrastructure** exposes them for drill-down. Parent inspector data includes child IDs and summaries.

Stable IDs are derived from normalized source identity such as a Terraform address or Kubernetes namespace/kind/name. They never depend on display order or runtime state.
