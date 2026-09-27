# Helm analysis

Helm analysis discovers `Chart.yaml`, default `values.yaml`, and YAML templates. It statically substitutes direct `.Values` paths, `.Release.Name`, `.Release.Namespace`, `.Chart.Name`, common name includes, and safe `default`, `quote`, and `toString` pipelines.

Helm is never executed. Control flow, `tpl`, `lookup`, arbitrary functions, and missing values remain unresolved and produce diagnostics. Rendered Kubernetes records retain chart/template evidence and are attached to the chart hierarchy.

Terraform `helm_release` resources reconcile to local charts only when the literal chart path resolves to that chart directory. Release name and namespace are corroborating metadata, not dynamic rendering inputs.
