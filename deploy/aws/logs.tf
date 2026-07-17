resource "aws_cloudwatch_log_group" "app" {
  name              = "/papyr/app"
  retention_in_days = 14
}
