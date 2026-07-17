resource "aws_ecs_cluster" "main" {
  name = "papyr"
  setting {
    name  = "containerInsights"
    value = "disabled" # Insights bills per metric; off keeps the deploy cheap.
  }
}

# A service can only reference FARGATE / FARGATE_SPOT in its capacity_provider_
# strategy if the cluster has them associated first. Without this the first
# apply fails with "capacity provider not found".
resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
}

locals {
  server_image   = "${aws_ecr_repository.repos["papyr-server"].repository_url}:${var.image_tag}"
  compiler_image = "${aws_ecr_repository.repos["papyr-compiler"].repository_url}:${var.image_tag}"

  # Plain (non-secret) env for the server. Secrets come from SSM below.
  server_env = merge(
    {
      NODE_ENV         = "production"
      PORT             = "3000"
      DATA_DIR         = "/data"
      META_DIR         = "/secrets"
      COMPILER_URL     = "http://localhost:4020"
      PAPYR_PUBLIC_URL = "https://${var.domain_name}"
      COOKIE_SECURE    = "1"
      TRUST_PROXY      = "1" # behind the ALB, so X-Forwarded-For is trusted for rate-limit keys
      PAPYR_AI_MODEL   = var.ai_model
    },
    var.auth_enabled ? { AUTH_ENABLED = "1" } : {},
    var.sso_only ? { PAPYR_SSO_ONLY = "1" } : {},
  )
}

resource "aws_ecs_task_definition" "app" {
  family                   = "papyr"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  # /data — shared with the compiler.
  volume {
    name = "data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.main.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.data.id
        iam             = "DISABLED"
      }
    }
  }

  # /secrets — server only (see efs.tf for why the compiler must not mount this).
  volume {
    name = "secrets"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.main.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.secrets.id
        iam             = "DISABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name        = "compiler"
      image       = local.compiler_image
      essential   = true
      environment = [{ name = "DATA_DIR", value = "/data" }, { name = "PORT", value = "4020" }]
      mountPoints = [{ sourceVolume = "data", containerPath = "/data", readOnly = false }]
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"require('http').get('http://localhost:4020/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "compiler"
        }
      }
    },
    {
      name        = "server"
      image       = local.server_image
      essential   = true
      environment = [for k, v in local.server_env : { name = k, value = tostring(v) }]
      secrets     = [for k, p in aws_ssm_parameter.secret : { name = k, valueFrom = p.arn }]
      dependsOn   = [{ containerName = "compiler", condition = "HEALTHY" }]
      # Give the shutdown hook time to flush open Yjs docs + autosave-commit.
      stopTimeout = 120
      mountPoints = [
        { sourceVolume = "data", containerPath = "/data", readOnly = false },
        { sourceVolume = "secrets", containerPath = "/secrets", readOnly = false },
      ]
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "server"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "app" {
  name            = "papyr"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count

  capacity_provider_strategy {
    capacity_provider = var.use_fargate_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true # required for egress without a NAT gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "server"
    container_port   = 3000
  }

  health_check_grace_period_seconds = 180

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # EFS holds all state, so replacing the single task loses nothing. Rolling
  # (100/200) is zero-downtime; there's a brief 2-task window where — without
  # REDIS_URL — a hot doc could momentarily seed on both. It's seconds and
  # autosaved; set 0/100 if you'd rather trade that for a short downtime.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.https, aws_ecs_cluster_capacity_providers.main]

  lifecycle {
    ignore_changes = [desired_count] # don't fight manual/console scaling
  }
}
