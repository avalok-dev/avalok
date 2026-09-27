# Terraform analysis

AgentMap parses `.tf` with HashiCorp's `@cdktf/hcl2json` WebAssembly parser and `.tf.json` with JSON parsing. It does not run Terraform, providers, provisioners, modules, planning, or state commands.

Supported structure includes resources, data sources, module calls, providers, nested blocks, literal attributes, `count`/`for_each` expressions as unevaluated metadata, and static traversals such as `aws_vpc.main.id`. Resources use their Terraform addresses as identity. Explicit traversals create `references` edges.

The inventory skips `.terraform/`, state files, `.tfvars`, `.auto.tfvars`, and `.terraform.lock.hcl`. Literal capacity attributes are emitted as configured metrics. Sensitive-looking attributes are excluded. Expressions remain unresolved strings and are never presented as computed values.

Malformed files create `terraform.parse-failed` diagnostics and do not stop other analyzers. See [aws-inference.md](./aws-inference.md) for provider-specific ontology mapping.
