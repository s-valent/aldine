#!/usr/bin/env bash
# One-shot Papyr → AWS deploy. Runs a preflight (fails early with a clear reason),
# then provisions infra, builds+pushes images, waits for the service to stabilise,
# and smoke-tests the URL. Idempotent: safe to re-run.
#
#   export AWS_PROFILE=papyr      # or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#   ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

fail() { echo "✗ $*" >&2; exit 1; }

# Pull a string value from terraform.tfvars; empty (never fails) if the file or
# key is absent — the defaults below then apply. Must not trip `set -e`.
tfvar() { { [ -f terraform.tfvars ] && grep -E "^[[:space:]]*$1[[:space:]]*=" terraform.tfvars | head -1 | sed -E 's/.*"([^"]+)".*/\1/'; } || true; }

TF="$(command -v terraform || command -v tofu || true)"
REGION="${AWS_REGION:-$(tfvar region)}"; REGION="${REGION:-eu-central-1}"
ZONE="$(tfvar route53_zone_name)";       ZONE="${ZONE:-tobiasrahloff.com}"
DOMAIN="$(tfvar domain_name)";           DOMAIN="${DOMAIN:-papyr.tobiasrahloff.com}"

echo "── preflight ────────────────────────────────────────"
[ -n "$TF" ] || fail "terraform (or tofu) not found on PATH."
command -v aws >/dev/null || fail "aws CLI not found."
command -v docker >/dev/null || fail "docker not found."
[ -f terraform.tfvars ] || fail "terraform.tfvars missing — cp terraform.tfvars.example terraform.tfvars and fill it in."

docker info >/dev/null 2>&1 || fail "Docker daemon is not running — start Docker Desktop, then re-run."

aws sts get-caller-identity >/dev/null 2>&1 || fail \
  "No valid AWS credentials. Configure SSO (aws configure sso) and run 'aws sso login --profile <name>', or export access keys, then re-run."
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "  aws account   : $ACCOUNT"
echo "  region        : $REGION"

# The hosted zone must pre-exist; Terraform only looks it up.
aws route53 list-hosted-zones-by-name --dns-name "$ZONE" \
  --query "HostedZones[?Name=='${ZONE}.']|[0].Id" --output text 2>/dev/null | grep -q hostedzone \
  || fail "Route53 hosted zone '$ZONE' not found in account $ACCOUNT. Create/delegate it first (Terraform does not register domains)."
echo "  route53 zone  : $ZONE ✓"
echo "  domain        : $DOMAIN"
echo "  preflight ok"

echo "── terraform apply ─────────────────────────────────"
"$TF" init -input=false
"$TF" apply -auto-approve

echo "── build + push images, roll service ───────────────"
./push-images.sh

echo "── wait for steady state ───────────────────────────"
aws ecs wait services-stable --cluster papyr --services papyr --region "$REGION"

echo "── smoke test ──────────────────────────────────────"
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/" || true)"
  [ "$code" = "200" ] && { echo "✓ https://${DOMAIN} is serving (HTTP 200)"; exit 0; }
  echo "  waiting for DNS/cert/app … (HTTP ${code}) [$i/30]"; sleep 20
done
echo "⚠ Service is stable but https://${DOMAIN} didn't return 200 yet — DNS or ACM"
echo "  validation can take a few minutes on first deploy. Re-check shortly."
