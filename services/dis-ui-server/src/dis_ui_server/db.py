"""The ORM declarative base and the engine wiring — both through dis-rls.

This service uses the SQLAlchemy ORM / declarative layer where other DIS
services use Core/text, justified by its CRUD and system-of-record nature
(``config.source_mappings``, later slices). The layer choice carries a
decisions.md D-number assigned by the operator at the Slice-13a commit gate.

The load-bearing constraint (root CLAUDE.md hard rule 1): any future model
declared on :class:`Base` executes ONLY inside ``rls_session(engine, tenant_id)``
— never a raw ``AsyncSession``, never a second engine. The engine itself comes
from ``dis-rls`` ``create_rls_engine`` so the ``current_database()=='ithina_dis_db'``
+ NOBYPASSRLS posture guard applies to every connection this service ever opens.

Slice 13a declares no models (there are no endpoints); the base exists so later
slices attach to an already-wired foundation instead of improvising one.

Engine creation is LAZY (no connection at construction): the lifespan creates
the engine without touching the network, so an unreachable database never
blocks startup or ``/healthz`` — the first connect happens in ``/readyz`` and
degrades there to 503.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.orm import DeclarativeBase

from dis_rls import create_rls_engine
from dis_ui_server.config import UiServerConfig


class Base(DeclarativeBase):
    """Declarative root for this service's future CRUD models.

    Every model on this base executes through the dis-rls session only
    (service CLAUDE.md durable invariant). No models exist in Slice 13a.
    """


def create_engine_from_config(config: UiServerConfig) -> AsyncEngine:
    """Create the (lazy) DIS engine; the caller owns and disposes it.

    Delegates to ``create_rls_engine`` so the wrong-database / bypassing-role
    refusal (dis-rls posture guard) covers this service structurally.
    """
    return create_rls_engine(config.postgres_url)
