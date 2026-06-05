"""The ``/api/v1`` mount point for every UI data endpoint (durable invariant).

The prefix mechanism is a plain ``APIRouter(prefix=API_PREFIX)`` that
``main.py`` includes once; later handlers attach their routers here and
inherit the deployed base without restating it. The contract's relative
``/v1/<group>/<resource>`` paths are unchanged — only the deployed base is
``/api/v1`` — and dis-ui's ``client.ts`` fetch base must agree when the
frontend's real mode wires up (13b/19, contract Appendix B; flagged to the UI
engineer). Health probes deliberately do NOT live here: ``/healthz`` and
``/readyz`` stay at the root per infra convention.

Empty in Slice 13a (no UI data endpoints are in scope).
"""

from __future__ import annotations

from fastapi import APIRouter

from dis_ui_server.config import API_PREFIX

api_router = APIRouter(prefix=API_PREFIX)
