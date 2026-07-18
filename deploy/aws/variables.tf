variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "eu-central-1"
}

variable "cpu_architecture" {
  description = "Fargate CPU architecture. ARM64 (Graviton) is ~20% cheaper; images must be built for it."
  type        = string
  default     = "ARM64"
}

variable "domain_name" {
  description = "Public domain the app is served on."
  type        = string
  default     = "papyr.tobiasrahloff.com"
}

variable "route53_zone_name" {
  description = "Existing Route53 hosted zone that owns the domain (no trailing dot). The domain_name must be at or below it."
  type        = string
  default     = "tobiasrahloff.com"
}

# ---- container sizing (Fargate task) ----
# Fargate valid combos: cpu 1024 (1 vCPU) allows memory 2048–8192. TeX Live needs
# headroom, so 1 vCPU / 3 GB is the cheap-but-workable default. Bump for big papers.
variable "task_cpu" {
  description = "Task-level CPU units (1024 = 1 vCPU)."
  type        = number
  default     = 1024
}

variable "task_memory" {
  description = "Task-level memory in MiB."
  type        = number
  default     = 3072
}

variable "use_fargate_spot" {
  description = "Run on Fargate Spot (~70% cheaper). Spot tasks can be reclaimed with ~2 min notice; the app autosaves on SIGTERM. Set false for on-demand stability."
  type        = bool
  default     = true
}

# ---- image tags (pushed to ECR by push-images.sh / the CD workflow) ----
variable "image_tag" {
  description = "Image tag for both the server and compiler images in ECR."
  type        = string
  default     = "latest"
}

# ---- app config ----
variable "auth_enabled" {
  description = "Enable accounts + sessions (AUTH_ENABLED)."
  type        = bool
  default     = true
}

variable "sso_only" {
  description = "Disable password endpoints; sign-in only via a configured OAuth provider (PAPYR_SSO_ONLY)."
  type        = bool
  default     = true
}

variable "ai_model" {
  description = "PAPYR_AI_MODEL (optional; used when an AI key secret is set)."
  type        = string
  default     = "anthropic/claude-opus-4.8"
}

# ---- transactional email (SES) ----
variable "enable_ses" {
  description = "Provision SES (domain identity, DKIM, MAIL FROM) and let the app send reset emails via the task role."
  type        = bool
  default     = true
}

variable "ses_from" {
  description = "From address for outbound email. Empty → \"Papyr <no-reply@<domain>>\"."
  type        = string
  default     = ""
}

variable "ses_mail_from_subdomain" {
  description = "Subdomain used as the custom MAIL FROM domain (for SPF alignment)."
  type        = string
  default     = "mail"
}

# ---- secrets ----
# Each non-empty entry becomes an SSM SecureString parameter and is injected into
# the server container as the env var of the same name. Empty values are skipped,
# so you only provision the providers you actually use. Put real values in
# terraform.tfvars (gitignored) or set them out-of-band after apply.
variable "secret_env" {
  description = "Map of ENV_VAR_NAME => secret value to store in SSM and inject into the server."
  type        = map(string)
  default     = {}
  sensitive   = true
}

# ---- deploy behaviour ----
variable "desired_count" {
  description = "Number of tasks. Keep at 1 unless you also set REDIS_URL + sticky routing (collab is single-node otherwise)."
  type        = number
  default     = 1
}
