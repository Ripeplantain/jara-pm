# Targets: `dev` (default in docker-compose.yml, source mounted, hot reload) and `prod`
# (docker-compose.prod.yml: Next standalone output, non-root, no secrets in the image).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- dev ---
FROM deps AS dev
COPY . .
RUN mkdir -p .next && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]

# --- production build ---
FROM deps AS build
COPY . .
# Next.js inlines NEXT_PUBLIC_* into the client bundle at build time, so these have to be
# present here rather than at run time. All three are public by design: the PostHog project
# token is write-only ingestion. Privileged secrets stay runtime-only, as below.
ARG NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=""
ARG NEXT_PUBLIC_POSTHOG_HOST=""
ARG NEXT_PUBLIC_POSTHOG_SESSION_REPLAY="false"
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=$NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_POSTHOG_SESSION_REPLAY=$NEXT_PUBLIC_POSTHOG_SESSION_REPLAY
RUN npm run build

# --- prod (last stage) ---
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
# AUTH_SECRET, NEXTAUTH_URL and BACKEND_INTERNAL_URL are runtime environment variables only.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
