# Contributing to Papyr

Thanks for your interest! Papyr is a slim, self-hostable LaTeX collaboration
platform. This guide gets you productive quickly.

## Layout

```
apps/server     Fastify API + embedded Hocuspocus (Yjs) collab + git + datastore
apps/compiler   TeX Live compile service (latexmk wrapper), sandboxed
apps/web        React + Vite + CodeMirror 6 + pdf.js frontend
plugins/        Built-in plugins (zotero, references, aifix)
e2e/            Playwright suites (main + auth) and helpers
deploy/         Single-VPS deploy bundle (Caddy TLS, backups, prod compose)
docs/           Architecture & scaling notes
```

## Local development

```bash
npm ci
# one-time: a compiler on :4020 (docker container sharing ./.data)
docker build -t papyr-compiler apps/compiler
docker run -d --name papyr-compiler-dev -p 4020:4020 -v "$PWD/.data:/data" papyr-compiler

# API on :3000, Vite on :5173 (proxies /api + /collab to :3000)
npm run dev -w apps/server
npm run dev -w apps/web    # in another terminal
```

Open http://localhost:5173.

## Checks before a PR

```bash
npm run typecheck -w apps/server
( cd apps/web && npx tsc --noEmit )
npm run build -w apps/web
npm run test:github -w apps/server        # hermetic GitHub-sync integration test

# Playwright suites (need the compiler on :4020 + the dev stack running)
npx playwright test -c e2e                                   # main (no-auth)
npx playwright test -c e2e/playwright.auth.config.ts         # auth
```

CI runs the typecheck/build/integration checks on every push (`.github/workflows/ci.yml`).

## Conventions

- **Match the surrounding code** — comment density, naming, idioms.
- Security matters: the compiler is sandboxed (restricted shell-escape, no
  egress, dropped caps) and API tokens live in the secrets volume, never in the
  compiler-visible projects dir. Don't loosen these without discussion.
- New persistence goes through the `DataStore` interface (JSON + Postgres), not
  ad-hoc files. See [docs/SCALING.md](docs/SCALING.md).
- Prefer a focused Playwright or integration test with any behavioral change.

## Releasing

Tag a version and push it — `.github/workflows/release.yml` builds and publishes
the `papyr-app` and `papyr-compiler` images to GHCR and drafts a GitHub release:

```bash
git tag v0.4.0 && git push origin v0.4.0
```
