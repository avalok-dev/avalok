# Resource metrics and cost foundation

`ResourceMetric` distinguishes `configured`, `observed`, and `estimated` values and records source, unit, optional time/window, and confidence. `CostAttribution` distinguishes observed and estimated monetary data with currency, window, source, and confidence.

Milestone 6 populates configured Kubernetes replicas/requests/limits and literal Terraform capacity properties such as desired count, allocated storage, memory size, and instance class. It does not fabricate utilization, latency, or cost.

Future live adapters must add observed timestamps/windows. Cost adapters must label estimates explicitly. Missing data stays absent rather than becoming zero.
