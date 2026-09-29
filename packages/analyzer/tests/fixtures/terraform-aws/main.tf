provider "aws" {
  region = "us-west-2"
}

resource "aws_vpc" "platform" {
  cidr_block = "10.42.0.0/16"
  tags = { Name = "sarvadrik-platform" }
}

resource "aws_subnet" "private" {
  vpc_id    = aws_vpc.platform.id
  cidr_block = "10.42.1.0/24"
}

resource "aws_eks_cluster" "platform" {
  name     = "sarvadrik-platform"
  role_arn = aws_iam_role.eks.arn
  vpc_config { subnet_ids = [aws_subnet.private.id] }
}

resource "aws_iam_role" "eks" {
  name               = "sarvadrik-eks"
  assume_role_policy = "{}"
}

resource "aws_lb" "public" {
  name               = "sarvadrik-public"
  load_balancer_type = "application"
  subnets            = [aws_subnet.private.id]
}

resource "aws_db_instance" "postgres" {
  identifier        = "research-postgres"
  engine            = "postgres"
  instance_class    = "db.t4g.small"
  allocated_storage = 20
}

resource "aws_s3_bucket" "documents" {
  bucket = "sarvadrik-documents"
}
