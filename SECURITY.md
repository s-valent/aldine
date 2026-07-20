# Security Policy

## Supported versions

Aldine is pre-1.0. Only the latest release (and `main`) receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use [GitHub private vulnerability reporting](../../security/advisories/new)
("Report a vulnerability" on the repo's Security tab). You'll get an initial
response within 72 hours. Coordinated disclosure is appreciated; we'll credit
you in the fix's release notes unless you prefer otherwise.

## Scope notes for self-hosters

- Aldine's compiler container is sandboxed (no network egress, dropped
  capabilities, CPU/memory/PID limits, restricted shell-escape), but LaTeX is a
  Turing-complete language processing untrusted input — treat the compiler
  container as semi-trusted and keep it isolated as shipped in
  `docker-compose.yml`.
- Auth is **off by default** (single-tenant). Before exposing an instance to
  the internet, set `AUTH_ENABLED=1` and serve over HTTPS (the `tls` compose
  profile ships a Caddy config).
- Session cookies are HTTP-only and revocable server-side; passwords are
  scrypt-hashed. Set `COOKIE_SECURE=1` behind HTTPS.

## Hall of fame

Reporters of validated vulnerabilities are listed here. Nothing yet — be the
first.
