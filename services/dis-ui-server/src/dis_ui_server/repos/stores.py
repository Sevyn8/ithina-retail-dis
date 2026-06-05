"""``identity_mirror.stores`` reads — THE chokepoint for the in-query tenant predicate.

``identity_mirror`` is RLS-OFF (D41), so the explicit ``WHERE tenant_id = <token
tenant>`` below is the ONLY isolation on the store list — there is no database
backstop; a missing predicate is a cross-tenant leak. That is exactly why this
query lives in one function in one module (the registered 14b weak link, with
its revisit trigger): every store read goes through here, and the tenant-A/
tenant-B isolation test pins the behaviour. The read still runs inside
``rls_session`` — the GUC is a no-op on an RLS-OFF table, but the engine's
wrong-database / bypassing-role posture guard applies to every connection.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import Row, select
from sqlalchemy.ext.asyncio import AsyncEngine

from dis_rls import rls_session
from dis_ui_server.models import StoreRow


async def list_onboarded_stores(engine: AsyncEngine, tenant_id: UUID) -> Sequence[Row[Any]]:
    """The token tenant's stores, stable order (name, then store_id).

    ``tenant_id`` MUST come from the verified token (``tenant_uuid_of``); this
    function trusts its caller on that — the auth seam is the only producer.
    """
    statement = (
        select(StoreRow)
        .where(StoreRow.tenant_id == tenant_id)  # the in-query scoping (D41) — do not remove
        .order_by(StoreRow.name, StoreRow.store_id)
    )
    async with rls_session(engine, tenant_id) as conn:
        result = await conn.execute(statement)
        return result.all()
