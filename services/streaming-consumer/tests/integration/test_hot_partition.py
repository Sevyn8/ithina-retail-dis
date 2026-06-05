"""The completeness partition, anchored to the LIVE schema (REVISED D63).

The code constants in ``pipeline/mapping.py`` (``HOT_REQUIRED_FROM_PROJECTION``,
``HOT_CHECK_IMPLICATIONS``) were derived from a plan-time introspection — the
same pass that wrote the classifier. This test re-derives them from the live
``information_schema`` / ``pg_constraint`` at RUN time and asserts exact
agreement, so a hot-schema change (a new NOT NULL column, a dropped pairing
CHECK) cannot silently leave the classifier stale: it fails HERE, loudly.

ERROR-not-skip: the conftest's stack fixtures raise StackRequiredError when the
DB is absent.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text
from streaming_consumer.pipeline.mapping import (
    HOT_CHECK_IMPLICATIONS,
    HOT_REQUIRED_FROM_PROJECTION,
)

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine

pytestmark = pytest.mark.integration

# The consumer-injected side of the partition (the (a) set): id is minted;
# identity + trace ride the envelope; tax_treatment is read from the store row;
# mapping_version_id from the loaded mapping; dis_channel from the bronze row.
_CONSUMER_INJECTED = frozenset(
    {"id", "tenant_id", "store_id", "trace_id", "tax_treatment", "mapping_version_id", "dis_channel"}
)
# The natural key arrives via every routed mapping by construction.
_NATURAL_KEY_UNIVERSAL = frozenset({"sku_id"})


def test_required_from_projection_matches_live_not_null_set(dis_admin: Engine) -> None:
    with dis_admin.begin() as conn:
        live_not_null = {
            row.column_name
            for row in conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema='canonical' AND table_name='store_sku_current_position' "
                    "AND is_nullable='NO' AND column_default IS NULL"
                )
            )
        }
    derived_required = live_not_null - _CONSUMER_INJECTED - _NATURAL_KEY_UNIVERSAL
    assert derived_required == HOT_REQUIRED_FROM_PROJECTION, (
        f"live-derived: {sorted(derived_required)} vs "
        f"code constant: {sorted(HOT_REQUIRED_FROM_PROJECTION)} — the classifier is stale"
    )


def test_check_implications_match_live_pairing_constraints(dis_admin: Engine) -> None:
    with dis_admin.begin() as conn:
        constraint_defs = {
            row.conname: row.definition
            for row in conn.execute(
                text(
                    "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint "
                    "WHERE conrelid = 'canonical.store_sku_current_position'::regclass "
                    "AND contype = 'c'"
                )
            )
        }
    # The two presence-pairing CHECKs the implications encode must exist live
    # with the encoded shape.
    promo = constraint_defs.get("ck_sscp_promo_identifier_requires_price", "")
    assert "promo_identifier IS NULL" in promo and "promo_price IS NOT NULL" in promo
    expiry = constraint_defs.get("ck_sscp_expiry_triple_pairing", "")
    for column in ("expiry_date", "expiry_source", "expiry_confidence"):
        assert column in expiry
    # And the code constant encodes exactly those two implications.
    triggers = {frozenset(t) for t, _c in HOT_CHECK_IMPLICATIONS}
    assert triggers == {
        frozenset({"promo_identifier"}),
        frozenset({"expiry_date", "expiry_source", "expiry_confidence"}),
    }
