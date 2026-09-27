# AWS inference

Terraform `aws_*` resources map into a small, reusable ontology:

- network: VPC, subnet, routes, gateways, security groups
- traffic: ALB/load balancer, listener, target group, Route 53
- compute: EKS/node group, EC2, ECS, Lambda
- data: RDS, ElastiCache, MSK, S3, SQS, SNS, DynamoDB
- identity: IAM roles, policies, and bindings

An AWS provider boundary groups system-level resources. VPC, ALB, EKS, managed data services, queues, and functions remain visible by default; subnet, IAM, listener, target-group, and similar fan-out defaults to detail visibility.

Only explicit Terraform traversals, literal properties, and exact repository annotations create relationships. AgentMap does not call AWS APIs, resolve ARNs, inspect accounts, or claim a deployed/live state.
