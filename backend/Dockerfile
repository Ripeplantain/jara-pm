# Two targets: `dev` (default in docker-compose.yml: dev deps, source mounted, --reload)
# and `prod` (docker-compose.prod.yml: runtime deps only, no tests, no reload, non-root).

# --- dependency build stage (prod) ---
FROM python:3.13-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY requirements.txt ./
RUN python -m venv /venv && /venv/bin/pip install -r requirements.txt

# --- dev ---
FROM python:3.13-slim AS dev
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY . .
RUN useradd --create-home app && mkdir /data && chown app /data
USER app
# Apply migrations, then serve. SQLite is single-writer: exactly one worker.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --reload"]

# --- prod (last stage, so it is what a plain `docker build` produces) ---
FROM python:3.13-slim AS prod
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/venv/bin:$PATH"
WORKDIR /app
COPY --from=builder /venv /venv
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
# Same user (and uid) as the dev image, so one data volume works with either. The DB lives on a
# mounted volume at /data, never in the image. No secrets are baked in:
# BACKEND_JWT_SECRET and LLM_API_KEY arrive as runtime environment variables.
RUN useradd --create-home app && mkdir /data && chown app /data
USER app
EXPOSE 8000
# SQLite is single-writer: exactly one worker, one replica.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]
