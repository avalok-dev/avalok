resource "aws_eks_cluster" "platform" {
  name     = "unified-platform"
  role_arn = aws_iam_role.eks.arn
  vpc_config { subnet_ids = [aws_subnet.private.id] }
}
resource "aws_iam_role" "eks" {
  name               = "unified-eks"
  assume_role_policy = "{}"
}
resource "aws_subnet" "private" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
