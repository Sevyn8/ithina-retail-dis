# streaming-consumer
#
# A Pub/Sub consumer: subscribes to ingress.ready, runs the mapping/normalize/
# validate pipeline, writes canonical rows. NOT an HTTP server. Modeled on the
# uv-based pattern. CONFIRM the entrypoint against
# services/streaming-consumer/src/streaming_consumer/main.py.
#
# Build from the REPO ROOT:
#   docker build -f docker/streaming-consumer.Dockerfile -t IMAGE .

FROM python:3.12-slim AS base

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY libs ./libs
COPY services/streaming-consumer ./services/streaming-consumer

RUN uv sync --frozen --package streaming-consumer --no-dev

# CONFIRM the real entrypoint.
CMD ["uv", "run", "--package", "streaming-consumer", "python", "-m", "streaming_consumer.main"]
