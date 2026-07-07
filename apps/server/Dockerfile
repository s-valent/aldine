# ---- build frontend ----
FROM node:22-alpine AS webbuild
WORKDIR /build
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm install --workspace apps/web --include-workspace-root=false
COPY apps/web apps/web
RUN npm run build -w apps/web

# ---- runtime ----
FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /srv
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
RUN npm install --workspace apps/server --include-workspace-root=false --omit=dev
COPY apps/server apps/server
COPY plugins plugins
COPY templates templates
COPY --from=webbuild /build/apps/web/dist apps/web/dist

ENV PORT=3000 \
    DATA_DIR=/data \
    META_DIR=/secrets \
    COMPILER_URL=http://compiler:4020 \
    PLUGINS_DIR=/srv/plugins \
    TEMPLATES_DIR=/srv/templates \
    WEB_DIST=/srv/apps/web/dist

EXPOSE 3000
WORKDIR /srv/apps/server
CMD ["npx", "tsx", "src/index.ts"]
