# Kubernetes analysis

The existing `yaml` package parses multi-document YAML. Only documents with `apiVersion`, `kind`, and `metadata.name` are Kubernetes resources.

Supported resources include workloads, containers, Services, Ingress, ConfigMap, Secret references, PVCs, ServiceAccounts, HPAs, Namespaces, CRDs, and bounded generic custom resources. Service selection requires an exact selector subset match against pod-template labels. Ingress backends resolve by service name and namespace. Workload config, secret, identity, and volume references create explicit edges.

Configured replicas, CPU/memory requests, and CPU/memory limits are metrics with `configured` provenance. Secret payloads never enter analysis; only key names/counts and reference relationships are retained.

Invalid documents create diagnostics without aborting valid sibling documents or files. Avalok does not contact a cluster and cannot infer admission, controller output, or live state.
