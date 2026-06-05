"""HTTP server entrypoint: app factory, lifespan, router mounting.

Startup split (test-pinned, the liveness/readiness foundation):

- MISSING required config (``POSTGRES_URL``) fails fast inside the lifespan —
  startup aborts and the platform crashloops, the correct signal for
  misconfiguration.
- PRESENT-but-unreachable database does NOT block startup: ``create_rls_engine``
  is lazy (no connection until first execute), the lifespan performs no
  connectivity check, so ``/healthz`` serves 200 while ``/readyz`` degrades to
  503 where the first real connect happens.

The lifespan owns the engine (dis-rls CLAUDE.md: caller owns the engine, no
hidden global) and disposes it on shutdown.

Run: ``uvicorn dis_ui_server.main:app`` (the Dockerfile CMD).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from dis_core.logging import configure_logging, get_logger
from dis_ui_server.api import api_router
from dis_ui_server.catalog import build_field_catalog
from dis_ui_server.config import API_PREFIX, SERVICE_NAME, UiServerConfig
from dis_ui_server.db import create_engine_from_config
from dis_ui_server.errors_http import register_error_handlers
from dis_ui_server.handlers import health

_log = get_logger(SERVICE_NAME)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    config = UiServerConfig.from_env()  # raises on missing required env
    engine = create_engine_from_config(config)  # lazy: no connection yet
    app.state.config = config
    app.state.engine = engine
    # Built once per process (inputs are code constants; no DB, no tenant). A
    # label-vs-derivation drift raises FieldCatalogDriftError HERE, aborting
    # startup — crashloop is the correct signal, never a half-true catalog.
    app.state.field_catalog = build_field_catalog()
    _log.bind(stage="startup").info("dis-ui-server started")
    try:
        yield
    finally:
        await engine.dispose()
        _log.bind(stage="shutdown").info("dis-ui-server stopped")


def create_app(extra_api_routers: Sequence[APIRouter] = ()) -> FastAPI:
    """Build the application.

    ``extra_api_routers`` is a TEST seam: tests mount probe routes under the
    ``/api/v1`` prefix through the same mechanism production handlers will use,
    proving the prefix wiring without mutating module state. Production callers
    use the module-level ``app`` and pass nothing.
    """
    configure_logging()  # idempotent
    app = FastAPI(title=SERVICE_NAME, lifespan=_lifespan)
    register_error_handlers(app)
    app.include_router(health.router)  # probes at the root, per infra convention
    app.include_router(api_router)  # the /api/v1 base for all UI data endpoints
    for router in extra_api_routers:
        # Same prefix constant, same include mechanism, per-app (the shared
        # api_router is never mutated, so test routes cannot leak across apps).
        app.include_router(router, prefix=API_PREFIX)
    return app


app = create_app()
