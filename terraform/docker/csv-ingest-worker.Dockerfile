# csv-ingest-worker
#
# A Pub/Sub consumer (NOT an HTTP server): it subscribes to csv.received and
# runs the ingest pipeline. Modeled on the uv-based Python pattern (the repo
# uses uv / uv.lock). CONFIRM the entrypoint against the real service module
# (services/csv-ingest-worker/src/csv_ingest_worker/main.py).
#
# Build context is the REPO ROOT (the workspace uses shared libs/), so build with:
#   docker build -f docker/csv-ingest-worker.Dockerfile -t IMAGE .

FROM python:3.12-slim AS base

# uv for fast, lockfile-faithful installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy the workspace manifests first for layer caching.
# Adjust paths if the workspace layout differs.
COPY pyproject.toml uv.lock ./
COPY libs ./libs
COPY services/csv-ingest-worker ./services/csv-ingest-worker

# Install the service plus its workspace deps from the lockfile.
RUN uv sync --frozen --package csv-ingest-worker --no-dev

# Pub/Sub consumers are long-running; no port is exposed.
# CONFIRM: the real entrypoint. If the service exposes a console script, prefer it.
CMD ["uv", "run", "--package", "csv-ingest-worker", "python", "-m", "csv_ingest_worker.main"]
