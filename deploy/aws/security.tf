# Public edge: the ALB accepts HTTP/HTTPS from anywhere.
resource "aws_security_group" "alb" {
  name        = "papyr-alb"
  description = "Papyr ALB ingress"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP (redirected to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "papyr-alb" }
}

# The task: inbound only from the ALB (app port); egress open for git/OAuth/APIs.
resource "aws_security_group" "task" {
  name        = "papyr-task"
  description = "Papyr Fargate task"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "App port from ALB only"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "papyr-task" }
}

# EFS mount targets accept NFS only from the task SG.
resource "aws_security_group" "efs" {
  name        = "papyr-efs"
  description = "Papyr EFS mount targets"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "NFS from tasks"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.task.id]
  }
  tags = { Name = "papyr-efs" }
}
