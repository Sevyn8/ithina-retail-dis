"""Structured logging convention for DIS.

Every log line is JSON (Cloud Logging-friendly) and carries the load-bearing
context fields: ``service``, ``stage``, ``tenant_id``, ``trace_id`` (root CLAUDE.md
logging rule). Helpers here bind that context once and inject it into every record,
structlog-style, so call sites don't repeat it.

NEVER log PII or raw receiver payloads (CLAUDE.md). These helpers cannot enforce
that — it is a call-site discipline.

``configure_logging`` installs the JSON formatter (call once at process start).
``get_logger`` returns an adapter pre-bound with context; ``.bind(**more)`` returns
a child adapter with additional fields (e.g. binding ``stage``/``trace_id`` as a
chunk moves through the pipeline).
"""

from __future__ import annotations

import logging
from collections.abc import MutableMapping
from typing import Any

try:  # python-json-logger >= 3 moved the formatter to a submodule.
    from pythonjsonlogger.json import JsonFormatter
except ImportError:  # 2.x compatibility
    from pythonjsonlogger.jsonlogger import JsonFormatter

# Context keys bound on every DIS log line.
_CONTEXT_KEYS = ("service", "stage", "tenant_id", "trace_id")

_DEFAULT_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


class DisLoggerAdapter(logging.LoggerAdapter):
    """Logger adapter that merges bound context into each record's ``extra``."""

    def process(self, msg: str, kwargs: MutableMapping[str, Any]) -> tuple[str, MutableMapping[str, Any]]:
        extra = {**(self.extra or {}), **kwargs.get("extra", {})}
        kwargs["extra"] = extra
        return msg, kwargs

    def bind(self, **fields: Any) -> DisLoggerAdapter:
        """Return a child adapter with ``fields`` added to the bound context."""
        return DisLoggerAdapter(self.logger, {**(self.extra or {}), **fields})


def configure_logging(level: int | str = logging.INFO) -> None:
    """Install the JSON formatter on the root logger. Idempotent; call once at startup."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter(_DEFAULT_FORMAT))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


def get_logger(service: str, **context: Any) -> DisLoggerAdapter:
    """Return a logger for ``service`` pre-bound with ``service`` and any ``context``.

    Bind ``stage``, ``tenant_id``, ``trace_id`` here or later via ``.bind(...)``.
    """
    return DisLoggerAdapter(logging.getLogger(service), {"service": service, **context})
