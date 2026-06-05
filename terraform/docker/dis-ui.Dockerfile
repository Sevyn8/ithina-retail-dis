# dis-ui (frontend)
#
# Builds the Vite SPA and serves the static assets with nginx, with SPA
# fallback (all routes -> index.html) so client-side routing works. Cloud Run
# serves this container.
#
# VITE_API_BASE is a BUILD-time var for Vite (baked into the bundle). Pass it
# as a build arg; the Terraform sets it as a runtime env on Cloud Run too, but
# Vite needs it at build time, so the build arg is what matters for the bundle.
#
# Build from services/dis-ui (the frontend package root):
#   docker build -f ../../docker/dis-ui.Dockerfile --build-arg VITE_API_BASE=URL -t IMAGE .

FROM node:20-slim AS build
WORKDIR /app

# pnpm (the repo uses pnpm for the UI).
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_BASE=""
ENV VITE_API_BASE=${VITE_API_BASE}
RUN pnpm build

# --- serve ---
FROM nginx:1.27-alpine AS serve

# SPA config: fall back to index.html for unknown routes; Cloud Run sets PORT.
COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
  listen       8080;
  server_name  _;
  root   /usr/share/nginx/html;
  index  index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
NGINX

COPY --from=build /app/dist /usr/share/nginx/html

# Cloud Run sends traffic to $PORT (default 8080). nginx listens on 8080 above.
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
