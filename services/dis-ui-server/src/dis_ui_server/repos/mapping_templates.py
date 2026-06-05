"""``config.source_mappings`` reads + writes — through ``rls_session`` only (D67).

Statements execute Core-style on the session's connection (the service's pinned
ORM pattern): the declarative model supplies typed columns, the dis-rls
transaction supplies the tenant scope (RLS ON+FORCE, D69 — cross-tenant rows are
invisible on read AND refused on write by the policy's WITH CHECK).

Write semantics owned here (the slice's two recorded boundary calls):

- **Rename updates ALL lineage rows.** ``template_name`` is lineage metadata
  (D68: "operator-set human label … editable"), not version content — D17
  immutability covers ``mapping_rules``/``source_id``/seq/predecessor. Updating
  every row keeps the lineage label coherent; the EXCLUDE constraint arbitrates
  cross-template uniqueness atomically.
- **At most one DRAFT per template is a WRITE-PATH convention**, not a DB
  invariant: create mints the lineage's first DRAFT; edit updates the existing
  DRAFT in place or chains exactly one new DRAFT off the STAGED/ACTIVE head.
  Nothing here ever writes ``status`` ``ACTIVE``/``STAGED``, so these paths can
  never produce a second ACTIVE (the 14a consumer ``.first()`` hazard stays
  untriggered).

IntegrityError translation (and nothing broader — rule 6): the EXCLUDE
constraint ``ex_csm_template_name_per_source`` → 409 name conflict; the
``uq_csm_seq_per_source`` unique → 409 state conflict (a pure backstop — the
lock-then-reread in ``patch_template`` makes the normal interleaving converge
to edit-in-place instead); the tenant FK ``fk_csm_tenant`` → 403 (a verified
token can name a tenant DIS has not mirrored yet — a caller-state condition,
not a bug). Any OTHER IntegrityError re-raises — a NOT NULL or vocabulary
violation is a bug and must surface as a 500, never a misleading 4xx.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import Row, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from dis_core.errors import (
    MappingStateConflictError,
    MappingTemplateNameConflictError,
    ResourceNotFoundError,
    TenantScopeError,
)
from dis_rls import rls_session
from dis_ui_server.models import SourceMappingRow

_STATUS_DRAFT = "DRAFT"
_STATUS_DEPRECATED = "DEPRECATED"

_NAME_EXCLUDE_CONSTRAINT = "ex_csm_template_name_per_source"
_SEQ_UNIQUE_CONSTRAINT = "uq_csm_seq_per_source"
_TENANT_FK_CONSTRAINT = "fk_csm_tenant"


def _violates(exc: IntegrityError, constraint: str) -> bool:
    """True when the wrapped psycopg error names exactly this constraint."""
    diag = getattr(exc.orig, "diag", None)
    return diag is not None and getattr(diag, "constraint_name", None) == constraint


async def list_template_rows(
    engine: AsyncEngine, tenant_id: UUID, *, source_id: str | None = None
) -> Sequence[Row[Any]]:
    """Every version row visible to the tenant, lineage-grouped stable order."""
    statement = select(SourceMappingRow).order_by(
        SourceMappingRow.source_id,
        SourceMappingRow.template_name,
        SourceMappingRow.template_id,
        SourceMappingRow.version_seq_per_source.desc(),
    )
    if source_id is not None:
        statement = statement.where(SourceMappingRow.source_id == source_id)
    async with rls_session(engine, tenant_id) as conn:
        return (await conn.execute(statement)).all()


async def get_template_rows(engine: AsyncEngine, tenant_id: UUID, template_id: UUID) -> Sequence[Row[Any]]:
    """One lineage's version rows (version desc); empty when invisible/absent."""
    statement = (
        select(SourceMappingRow)
        .where(SourceMappingRow.template_id == template_id)
        .order_by(SourceMappingRow.version_seq_per_source.desc())
    )
    async with rls_session(engine, tenant_id) as conn:
        return (await conn.execute(statement)).all()


async def create_template(
    engine: AsyncEngine,
    tenant_id: UUID,
    *,
    template_id: UUID,
    source_id: str,
    template_name: str,
    mapping_rules: dict[str, Any],
    created_by_user_id: UUID | None,
) -> Row[Any]:
    """Insert the lineage's first version: DRAFT, seq trigger-assigned, no predecessor."""
    statement = (
        insert(SourceMappingRow)
        .values(
            tenant_id=tenant_id,
            source_id=source_id,
            template_id=template_id,
            template_name=template_name,
            # version_seq_per_source deliberately OMITTED: NULL reaches the
            # BEFORE-INSERT trigger, which assigns the per-template sequence.
            status=_STATUS_DRAFT,
            mapping_rules=mapping_rules,
            created_by_user_id=created_by_user_id,
        )
        .returning(SourceMappingRow)
    )
    async with rls_session(engine, tenant_id) as conn:
        try:
            result = await conn.execute(statement)
        except IntegrityError as exc:
            if _violates(exc, _NAME_EXCLUDE_CONSTRAINT):
                raise MappingTemplateNameConflictError(
                    f"template_name {template_name!r} is already used by another "
                    f"template of source {source_id!r}",
                    tenant_id=str(tenant_id),
                    source_id=source_id,
                    template_name=template_name,
                ) from exc
            if _violates(exc, _TENANT_FK_CONSTRAINT):
                # A verified token can carry a well-formed tenant DIS has not
                # mirrored yet; that is the caller's provisioning state, not a
                # server bug — 403, consistent with the no-oracle read posture
                # (reads for such a tenant simply see zero rows).
                raise TenantScopeError(
                    "token tenant is not provisioned in DIS (no identity_mirror row)",
                    tenant_id=str(tenant_id),
                ) from exc
            raise
        return result.one()


async def patch_template(
    engine: AsyncEngine,
    tenant_id: UUID,
    template_id: UUID,
    *,
    template_name: str | None,
    mapping_rules: dict[str, Any] | None,
    created_by_user_id: UUID | None,
) -> Sequence[Row[Any]]:
    """Apply one PATCH atomically; returns the lineage's fresh rows (version desc).

    One transaction, LOCK-THEN-REREAD first (two statements, both FOR UPDATE):
    concurrent PATCHes serialize on the lineage rows, and the SECOND read is the
    one decided on. The re-read is load-bearing, not belt-and-braces: under READ
    COMMITTED a blocked ``SELECT … FOR UPDATE`` resumes on its ORIGINAL statement
    snapshot, which excludes a row the lock-holder committed (e.g. its new DRAFT)
    — while the seq trigger's ``MAX`` inside our later INSERT runs on a FRESH
    snapshot that does see it, so the unique-seq backstop never fires and a
    single locked read would mint a SECOND DRAFT (reproduced live, 14b
    validation pass). Once statement 1 holds locks on every pre-existing row, no
    other lineage writer can commit (they all lock the same rows first), so
    statement 2's fresh snapshot is both complete and stable; the lifecycle
    decision (edit the DRAFT in place vs chain a new DRAFT off the head) is made
    on THAT read. The seq-collision 409 below remains as a backstop only.
    """
    lineage_stmt = (
        select(SourceMappingRow)
        .where(SourceMappingRow.template_id == template_id)
        .order_by(SourceMappingRow.version_seq_per_source.desc())
        .with_for_update()
    )
    async with rls_session(engine, tenant_id) as conn:
        await conn.execute(lineage_stmt)  # statement 1: acquire the locks (result unused)
        locked = (await conn.execute(lineage_stmt)).all()  # statement 2: fresh snapshot, decide on this
        if not locked:
            # Under RLS, absent and other-tenant are deliberately the same 404.
            raise ResourceNotFoundError(
                f"mapping template {template_id} not found",
                resource="mapping_template",
                identifier=str(template_id),
                tenant_id=str(tenant_id),
            )

        effective_name: str = locked[0].template_name
        if template_name is not None and template_name != effective_name:
            try:
                await conn.execute(
                    update(SourceMappingRow)
                    .where(SourceMappingRow.template_id == template_id)
                    .values(template_name=template_name)
                )
            except IntegrityError as exc:
                if _violates(exc, _NAME_EXCLUDE_CONSTRAINT):
                    raise MappingTemplateNameConflictError(
                        f"template_name {template_name!r} is already used by another "
                        f"template of source {locked[0].source_id!r}",
                        tenant_id=str(tenant_id),
                        source_id=locked[0].source_id,
                        template_name=template_name,
                    ) from exc
                raise
            effective_name = template_name

        if mapping_rules is not None:
            await _apply_rules_edit(
                conn,
                locked,
                tenant_id=tenant_id,
                template_id=template_id,
                template_name=effective_name,  # locked rows are stale after a rename
                mapping_rules=mapping_rules,
                created_by_user_id=created_by_user_id,
            )

        return (
            await conn.execute(
                select(SourceMappingRow)
                .where(SourceMappingRow.template_id == template_id)
                .order_by(SourceMappingRow.version_seq_per_source.desc())
            )
        ).all()


async def _apply_rules_edit(
    conn: AsyncConnection,
    locked: Sequence[Row[Any]],
    *,
    tenant_id: UUID,
    template_id: UUID,
    template_name: str,
    mapping_rules: dict[str, Any],
    created_by_user_id: UUID | None,
) -> None:
    """DRAFT edits in place; a STAGED/ACTIVE head chains a NEW DRAFT version (D17)."""
    draft = next((row for row in locked if row.status == _STATUS_DRAFT), None)
    if draft is not None:
        await conn.execute(
            update(SourceMappingRow)
            .where(SourceMappingRow.mapping_version_id == draft.mapping_version_id)
            .values(mapping_rules=mapping_rules)
        )
        return

    living = [row for row in locked if row.status != _STATUS_DEPRECATED]
    if not living:
        raise MappingStateConflictError(
            f"mapping template {template_id} has only DEPRECATED versions; the "
            "lineage is closed (D17) — create a new template instead",
            template_id=str(template_id),
            tenant_id=str(tenant_id),
            expected="DRAFT, STAGED or ACTIVE",
            actual=_STATUS_DEPRECATED,
        )
    head = living[0]  # rows arrive version desc; the head is the newest living version
    try:
        await conn.execute(
            insert(SourceMappingRow).values(
                tenant_id=tenant_id,
                source_id=head.source_id,
                template_id=template_id,
                template_name=template_name,
                # seq omitted: trigger-assigned (next in this template's lineage).
                status=_STATUS_DRAFT,
                mapping_rules=mapping_rules,
                predecessor_version_id=head.mapping_version_id,
                created_by_user_id=created_by_user_id,
            )
        )
    except IntegrityError as exc:
        if _violates(exc, _SEQ_UNIQUE_CONSTRAINT):
            raise MappingStateConflictError(
                f"concurrent edit of mapping template {template_id} lost the "
                "version-sequence race; retry the edit",
                template_id=str(template_id),
                tenant_id=str(tenant_id),
                expected="exclusive lineage head",
                actual="concurrent writer",
            ) from exc
        raise
