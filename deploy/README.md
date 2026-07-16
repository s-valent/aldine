# Deploying Papyr on a single VPS

This is the recommended production setup: one dedicated-CPU box (e.g. a Hetzner
CCX, OVH, or any VPS with ≥8 GB RAM and 2+ dedicated vCPUs), Docker, and Caddy
for automatic HTTPS. It runs the whole stack from the committed compose files —
no managed platform required, which keeps compute cost (your main COGS) low.

## 1. Provision

- A VPS with **2+ dedicated vCPUs, ≥8 GB RAM, ≥40 GB disk**. LaTeX compiles are
  CPU/RAM bursts (~2 GB each) — size for your expected concurrent compiles.
- A domain, with an **A/AAAA record** pointing at the box.
- Install Docker Engine + the compose plugin.

```bash
sudo mkdir -p /opt/papyr && cd /opt/papyr
git clone <your-repo> .
```

## 2. Configure

Create `/opt/papyr/.env` (compose reads it automatically):

```dotenv
PAPYR_DOMAIN=papyr.example.com
PAPYR_PUBLIC_URL=https://papyr.example.com
PAPYR_APP_BIND=127.0.0.1          # app on loopback only; Caddy fronts it

# multi-user mode
AUTH_ENABLED=1
# Single sign-on (optional; each provider is independent). Set the callback/redirect
# URI in the provider console to  <PAPYR_PUBLIC_URL>/api/auth/oauth/<provider>/callback
# Google:  https://console.cloud.google.com/apis/credentials  (OAuth client, type "Web")
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
# GitHub login (SSO):  https://github.com/settings/developers
GITHUB_LOGIN_CLIENT_ID=...
GITHUB_LOGIN_CLIENT_SECRET=...

# GitHub sync (import repos as projects, push/pull) — a SEPARATE OAuth app with
# repo scope. Callback: <PAPYR_PUBLIC_URL>/api/github/oauth/callback
# (users can also connect with a Personal Access Token, no app needed).
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# AI error-fix (bring your own key)
OPENROUTER_API_KEY=sk-or-...      # or ANTHROPIC_API_KEY
PAPYR_AI_MODEL=anthropic/claude-opus-4.8

# plan metering: monthly compile-minutes per user (blank = unmetered)
PAPYR_COMPILE_QUOTA_MIN=30

# error tracking (optional)
SENTRY_DSN=

# multi-node only: share rate limits + sync live collaboration across app
# instances (see the `redis` profile). With multiple app nodes you MUST run the
# load balancer with sticky routing so each project's /collab WebSocket lands on
# a consistent node (e.g. hash by the project id in the path, or a cookie) — see
# docs/SCALING.md. Single node needs none of this.
REDIS_URL=redis://redis:6379

# password-reset relay while no SMTP is wired (see caveats)
PAPYR_RESET_ECHO=
```

## 3. Launch (with TLS)

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --profile tls up -d --build
```

Caddy provisions and renews the certificate for `PAPYR_DOMAIN`. The app is bound
to loopback (`127.0.0.1:8080`) — only Caddy's 80/443 face the internet. The
compiler runs on an internal-only network (no egress) with all Linux caps
dropped.

## 4. Backups (systemd timer)

```bash
sudo cp deploy/papyr-backup.service deploy/papyr-backup.timer /etc/systemd/system/
# WorkingDirectory in the .service already points at /opt/papyr
sudo systemctl daemon-reload
sudo systemctl enable --now papyr-backup.timer
```

Daily snapshots of the `papyr-data` (projects/git) and `papyr-secrets` (users,
sessions, keys, comments, usage) volumes land in `/var/backups/papyr`, 14 kept.
Restore with `deploy/restore.sh <backup.tar.gz>` after `docker compose down`.

## 5. Upgrade

```bash
cd /opt/papyr && git pull
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml --profile tls up -d --build
```

## Scaling & monetization notes

- **Scale vertically first** — a bigger box absorbs a lot of users before you
  need HA. LaTeX compiles are the cost driver, so meter them: set
  `PAPYR_COMPILE_QUOTA_MIN` per plan and read `/api/usage` for a plan UI. Users
  over quota get HTTP 402 with `quotaExceeded: true`.
- **When one box isn't enough**, keep the web/collab tier here and run
  additional **compiler workers** on cheap burstable boxes pointed at the shared
  data volume (NFS/object store) — the compiler is stateless per compile.
- **Datastore**: the default is flat JSON files (fine for one node). To run
  multiple app nodes, switch to Postgres — no code change, just config:
  ```bash
  # in .env
  DATABASE_URL=postgres://papyr:papyr@db:5432/papyr
  # bring up with the bundled Postgres (or point at a managed one)
  docker compose --profile tls --profile postgres up -d
  ```
  Users, sessions, project metadata, comments, and usage move to Postgres;
  git repos stay on disk. The same test suite passes on both backends.

## Caveats to close before charging money

- **Password-reset email**: currently the reset token is logged server-side (or
  returned when `PAPYR_RESET_ECHO=1`). Wire SMTP into `/api/auth/reset-request`
  before onboarding real users.
- **Auth/metadata stores are flat JSON** (fine for a single node). Move to
  SQLite/Postgres behind the persistence interface when you scale horizontally.
