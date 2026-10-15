# Infrastructure reconciliation

Application-to-deployment matching uses exact service/runtime names, directory identities, container image basenames, labels, and compatible ports. A unique match creates `deployed-as` with evidence and confidence. Ambiguous candidates remain unmatched.

Cross-source infrastructure matching supports:

- Terraform `helm_release` to a local Helm chart by normalized literal path;
- EKS to Namespace by exact `avalok.dev/cluster` label;
- ALB to Ingress by exact `avalok.dev/load-balancer` label;
- Terraform resources to one another by explicit HCL traversal;
- Kubernetes Service, Ingress, HPA, config, secret, identity, and volume semantics.

Managed PostgreSQL/Redis resources enrich an existing application integration when the engine identity is exact, avoiding duplicate database nodes.

Runtime events first reconcile to application entities through existing path/service/route/database rules. Avalok then follows one direct `deployed-as` edge and records `deployment-context`. It does not propagate activity onward to EKS, AWS, VPC, or load balancers without event-specific infrastructure evidence.
