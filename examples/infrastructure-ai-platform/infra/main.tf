provider "aws" { region = "us-west-2" }

resource "aws_vpc" "platform" {
  cidr_block = "10.60.0.0/16"
  tags = { Name = "research-platform" }
}
resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.platform.id
  cidr_block = "10.60.1.0/24"
}
resource "aws_iam_role" "eks" {
  name               = "research-eks"
  assume_role_policy = "{}"
}
resource "aws_eks_cluster" "platform" {
  name     = "research-platform"
  role_arn = aws_iam_role.eks.arn
  vpc_config { subnet_ids = [aws_subnet.private.id] }
}
resource "aws_lb" "research" {
  name               = "research-alb"
  load_balancer_type = "application"
  subnets            = [aws_subnet.private.id]
}
resource "aws_db_instance" "postgres" {
  identifier        = "research-postgres"
  engine            = "postgres"
  instance_class    = "db.t4g.small"
  allocated_storage = 20
}
resource "aws_elasticache_cluster" "redis" {
  cluster_id    = "research-redis"
  engine        = "redis"
  node_type     = "cache.t4g.small"
  num_cache_nodes = 1
}
resource "aws_s3_bucket" "documents" { bucket = "research-documents" }
resource "helm_release" "platform" {
  name      = "research-platform"
  namespace = "research"
  chart     = "../charts/research-platform"
}
