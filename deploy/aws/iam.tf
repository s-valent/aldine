data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: pull images from ECR, write logs, read the SSM secrets.
resource "aws_iam_role" "execution" {
  name               = "papyr-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "read_secrets" {
  # Only granted when there are secrets to read.
  count = length(local.secret_keys) > 0 ? 1 : 0
  statement {
    actions   = ["ssm:GetParameters"]
    resources = [for p in aws_ssm_parameter.secret : p.arn]
  }
}

resource "aws_iam_role_policy" "read_secrets" {
  count  = length(local.secret_keys) > 0 ? 1 : 0
  name   = "papyr-read-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.read_secrets[0].json
}

# Task role: the app itself needs no AWS API access (git/OAuth/compile are all
# outbound HTTP), so this stays empty — least privilege.
resource "aws_iam_role" "task" {
  name               = "papyr-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
