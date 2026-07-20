# Deploying Aldine on a single VPS

This is the recommended production setup: one dedicated-CPU box (e.g. a Hetzner
CCX, OVH, or any VPS with ≥8 GB RAM and 2+ dedicated vCPUs), Docker, and Caddy
for automatic HTTPS. It runs the whole stack from the committed compose files —
no managed platform required. (Prefer AWS? There's a complete Terraform
deployment — Fargate, EFS, ALB, SES — in [`deploy/aws`](aws/).)

## 1. Provision

- A VPS with **2+ dedicated vCPUs, ≥8 GB RAM, ≥40 GB disk**. LaTeX compiles are
  CPU/RAM bursts (~2 GB each) — size for your expected concurrent compiles.
- A domain, with an **A/AAAA record** pointing at the box.
- Install Docker Engine + the compose plugin.

```bash
sudo mkdir -p /opt/aldine && cd /opt/aldine
git clone <your-repo> .
```

## 2. Configure

Create `/opt/aldine/.env` (compose reads it automatically):

```dotenv
ALDINE_DOMAIN=aldine.example.com
ALDINE_PUBLIC_URL=https://aldine.example.com
ALDINE_APP_BIND=127.0.0.1          # app on loopback only; Caddy fronts it

# multi-user mode
AUTH_ENABLED=1
# Single sign-on (optional; each provider is independent). Set the callback/redirect
# URI in the provider console to  <ALDINE_PUBLIC_URL>/api/auth/oauth/<provider>/callback
# Google:  https://console.cloud.google.com/apis/credentials  (OAuth client, type "Web")
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
# GitHub login (SSO):  https://github.com/settings/developers
GITHUB_LOGIN_CLIENT_ID=...
GITHUB_LOGIN_CLIENT_SECRET=...

# GitHub sync (import repos as projects, push/pull) — a SEPARATE OAuth app with
# repo scope. Callback: <ALDINE_PUBLIC_URL>/api/github/oauth/callback
# (users can also connect with a Personal Access Token, no app needed).
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# AI error-fix (bring your own key; unset = feature off). If several are set,
# precedence is OPENROUTER > OPENAI > ANTHROPIC. Leave ALDINE_AI_MODEL unset to
# use the provider's default — if you do set it, use that provider's naming
# (e.g. "anthropic/claude-opus-4.8" for OpenRouter, "claude-opus-4-8" for
# direct Anthropic).
OPENROUTER_API_KEY=sk-or-...
#ANTHROPIC_API_KEY=
#OPENAI_API_KEY=
#ALDINE_AI_MODEL=

# password-reset email: SMTP (any provider) or AWS SES — set one transport.
# Without one, reset tokens are logged server-side (or echoed in the API
# response when ALDINE_RESET_ECHO=1 — dev only).
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="Aldine <no-reply@aldine.example.com>"
#SMTP_SECURE=1                    # implicit TLS (port 465) instead of STARTTLS
#SES_FROM="Aldine <no-reply@aldine.example.com>"   # AWS SES instead of SMTP
#AWS_REGION=eu-west-1             # required with SES_FROM

# optional per-user compile quota, in minutes per month (blank = uncapped).
# Useful when hosting for a group; over-quota compiles return HTTP 402.
ALDINE_COMPILE_QUOTA_MIN=

# error tracking (optional)
SENTRY_DSN=

# multi-node only: share rate limits + sync live collaboration across app
# instances (see the `redis` profile). With multiple app nodes you MUST run the
# load balancer with sticky routing so each project's /collab WebSocket lands on
# a consistent node (e.g. hash by the project id in the path, or a cookie) — see
# ../docs/SCALING.md. Single node needs none of this.
#REDIS_URL=redis://redis:6379
```

## 3. Launch (with TLS)

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --profile tls up -d --build
```

Caddy provisions and renews the certificate for `ALDINE_DOMAIN`. The app is bound
to loopback (`127.0.0.1:8080`) — only Caddy's 80/443 face the internet. The
compiler runs on an internal-only network (no egress) with all Linux caps
dropped. The prod overlay also sets `TRUST_PROXY=1` (so per-client rate limits
see real IPs through Caddy) and `COOKIE_SECURE=1`.

## 4. Backups (systemd timer)

```bash
sudo cp deploy/aldine-backup.service deploy/aldine-backup.timer /etc/systemd/system/
# WorkingDirectory in the .service already points at /opt/aldine
sudo systemctl daemon-reload
sudo systemctl enable --now aldine-backup.timer
```

Daily snapshots of the `aldine-data` (projects/git) and `aldine-secrets` (users,
sessions, keys, comments, usage) volumes land in `/var/backups/aldine`, 14 kept.
Restore with `deploy/restore.sh <backup.tar.gz>` after `docker compose down`.
(If your compose project name isn't `aldine`, set `ALDINE_PROJECT` for both
scripts.)

## 5. Upgrade

```bash
cd /opt/aldine && git pull
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --profile tls up -d --build
```

## Scaling notes

- **Scale vertically first** — a bigger box absorbs a lot of users before you
  need HA. LaTeX compiles are the resource driver; if you host for a group,
  cap them per user with `ALDINE_COMPILE_QUOTA_MIN` and read `/api/usage` for a
  usage UI. Users over quota get HTTP 402 with `quotaExceeded: true`.
- **When one box isn't enough**, keep the web/collab tier here and run
  additional **compiler workers** on cheap burstable boxes pointed at the shared
  data volume (NFS/object store) — the compiler is stateless per compile.
- **Datastore**: the default is flat JSON files (fine for one node). To run
  multiple app nodes, switch to Postgres — no code change, just config:
  ```bash
  # in .env
  DATABASE_URL=postgres://aldine:aldine@db:5432/aldine
  # bring up with the bundled Postgres (or point at a managed one)
  docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml \
    --profile tls --profile postgres up -d
  ```
  Users, sessions, project metadata, comments, and usage move to Postgres;
  git repos stay on disk. The same test suite passes on both backends.
  Enabling Redis works the same way: `--profile redis` plus the `REDIS_URL`
  line in `.env`.

See [../docs/SCALING.md](../docs/SCALING.md) for the full multi-node picture
and the remaining single-node walls.

## All configuration

Everything is env-gated; blank/unset means "off" or the listed default.

| Variable | Purpose |
|---|---|
| `ALDINE_DOMAIN` | Domain Caddy serves + provisions TLS for (`tls` profile) |
| `ALDINE_PUBLIC_URL` | Absolute origin used in OAuth callbacks and reset links — required for SSO and email |
| `ALDINE_APP_BIND` | Host interface for the app port (set `127.0.0.1` behind a proxy) |
| `AUTH_ENABLED` | `1` = multi-user login, ownership, sharing. Unset = single-tenant, no login |
| `ALDINE_SSO_ONLY` | `1` = disable password auth entirely (SSO only) |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | Google SSO |
| `GITHUB_LOGIN_CLIENT_ID/SECRET` | GitHub SSO (login) |
| `GITHUB_CLIENT_ID/SECRET` | GitHub **sync** OAuth app (repo import/push/pull) — separate from login |
| `SMTP_HOST/PORT/USER/PASS/FROM`, `SMTP_SECURE` | Password-reset email via SMTP |
| `SES_FROM` + `AWS_REGION` | Password-reset email via AWS SES (instead of SMTP) |
| `ALDINE_RESET_ECHO` | `1` = echo reset tokens in the API response (dev only, never in prod) |
| `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY` | AI error-fix; precedence OpenRouter > OpenAI > Anthropic |
| `ALDINE_AI_MODEL`, `ALDINE_AI_BASE_URL` | Override AI model / OpenAI-compatible endpoint |
| `ALDINE_COMPILE_QUOTA_MIN` | Per-user compile minutes per month (blank = uncapped) |
| `DATABASE_URL` | Postgres datastore (blank = flat JSON files) |
| `PG_POOL_MAX` | Postgres pool size (default 10) |
| `REDIS_URL` | Shared rate limits + collab sync across app nodes |
| `SENTRY_DSN` | Error tracking |
| `TRUST_PROXY` | `1` = trust `X-Forwarded-For` (set by the prod overlay; needed behind any proxy) |
| `COOKIE_SECURE` | `1` = Secure session cookies (prod overlay sets it) |
| `RL_LOGIN_BURST`, `RL_REGISTER_BURST`, `RL_AI_BURST`, `RL_AI_REFILL_PER_MIN`, `RL_REF_BURST` | Rate-limit tuning (sane defaults) |
| `RL_COMPILE_CONCURRENCY` | Max concurrent compiles the app forwards (default 2) |
| `COMPILE_TIMEOUT_MS`, `MAX_CONCURRENT_COMPILES` | Compiler-container limits (set on the `compiler` service) |
| `ALDINE_PROJECT` | Compose project name for `backup.sh`/`restore.sh` (default `aldine`) |
