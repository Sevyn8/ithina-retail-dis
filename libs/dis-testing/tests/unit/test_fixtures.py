"""Sanity checks on the single source of fixture truth (identity-corrected, Slice 9a)."""

from __future__ import annotations

import re

import pytest
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey, RSAPublicKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key, load_pem_public_key

from dis_testing import fixtures as fx
from dis_testing.errors import FixtureError

# The retired invented identity form (D52). Lookbehind so legitimate us_*/ec_*
# forms never false-positive (e.g. 's_...' inside 'us_...').
_RETIRED_FORM = re.compile(r"(?<![a-z0-9_])[ts]_[a-z0-9]{12}")


def test_no_fixture_code_carries_the_retired_form() -> None:
    for t in fx.TENANTS:
        assert not _RETIRED_FORM.search(t.display_code), t.display_code
    for s in fx.STORES:
        if s.store_code is not None:
            assert not _RETIRED_FORM.search(s.store_code), s.store_code


def test_uuids_are_unique_across_tenants_and_stores() -> None:
    uuids = [t.uuid for t in fx.TENANTS] + [s.uuid for s in fx.STORES]
    assert len(uuids) == len(set(uuids))


def test_codes_are_unique() -> None:
    # Load-bearing: the fakes resolve a claim code to exactly one entity. A
    # duplicate would have made a fixture silently unreachable via dict overwrite;
    # the index builder raises at import, and this pins the property in CI.
    tenant_codes = [t.display_code for t in fx.TENANTS]
    assert len(set(tenant_codes)) == len(fx.TENANTS)
    store_codes = [s.store_code for s in fx.STORES if s.store_code is not None]
    assert len(set(store_codes)) == len(store_codes)


def test_default_set_shape() -> None:
    # 2 tenants, 2 stores each, one ACTIVE + one INACTIVE per tenant.
    assert len(fx.TENANTS) == 2
    for t in fx.TENANTS:
        stores = fx.stores_for_tenant(t.display_code)
        assert len(stores) == 2
        statuses = {s.status for s in stores}
        assert statuses == {"ACTIVE", "INACTIVE"}


def test_exactly_one_store_has_no_code_and_it_is_inactive_non_primary() -> None:
    # D55: store_code is nullable at source; one fixture exercises that path.
    uncoded = [s for s in fx.STORES if s.store_code is None]
    assert len(uncoded) == 1
    assert uncoded[0].status == "INACTIVE"
    assert uncoded[0] is not fx.PRIMARY_STORE


def test_stores_for_tenant_includes_none_coded_store() -> None:
    # Named check (Slice 9a): the code-less store stays reachable via the
    # non-code lookup — it must never be silently unreachable.
    uncoded = next(s for s in fx.STORES if s.store_code is None)
    assert uncoded in fx.stores_for_tenant(uncoded.tenant_display_code)


def test_primary_uses_contract_example_codes() -> None:
    assert fx.PRIMARY_TENANT.display_code == "acme-retail"
    assert fx.PRIMARY_STORE.store_code == "AC-001"
    assert fx.PRIMARY_STORE.tenant_display_code == fx.PRIMARY_TENANT.display_code


def test_every_store_references_a_known_tenant() -> None:
    known = {t.display_code for t in fx.TENANTS}
    for s in fx.STORES:
        assert s.tenant_display_code in known


def test_bridge_round_trips() -> None:
    assert fx.tenant_uuid_for("acme-retail") == fx.PRIMARY_TENANT.uuid
    assert fx.store_uuid_for("AC-001") == fx.PRIMARY_STORE.uuid


def test_bridge_raises_on_unknown_code() -> None:
    with pytest.raises(FixtureError):
        fx.tenant_uuid_for("no-such-tenant")
    with pytest.raises(FixtureError):
        fx.store_uuid_for("XX-999")


def test_default_source_mapping_targets_primary_tenant() -> None:
    assert fx.DEFAULT_SOURCE_MAPPING["tenant_display_code"] == fx.PRIMARY_TENANT.display_code
    assert fx.DEFAULT_SOURCE_MAPPING["status"] == "ACTIVE"
    assert fx.DEFAULT_SOURCE_MAPPING["source_id"] == fx.DEFAULT_SOURCE_ID


def test_committed_test_keypair_is_a_valid_matching_pair() -> None:
    priv = load_pem_private_key(fx.TEST_RSA_PRIVATE_KEY_PEM.encode(), password=None)
    pub = load_pem_public_key(fx.TEST_RSA_PUBLIC_KEY_PEM.encode())
    # Narrow the broad load_pem_* unions: the committed pair is RSA by construction,
    # and asserting it here is itself part of the test's claim.
    assert isinstance(priv, RSAPrivateKey)
    assert isinstance(pub, RSAPublicKey)
    # Public numbers must match — confirms the committed pair is internally consistent.
    assert priv.public_key().public_numbers() == pub.public_numbers()


def test_build_claims_carries_codes_never_uuids() -> None:
    claims = fx.build_claims(fx.PRIMARY_TENANT, fx.PRIMARY_STORE, issued_at=1000, expires_at=2000)
    assert claims["tenant_id"] == "acme-retail"
    assert claims["store_id"] == "AC-001"
    # The JWT is external-facing: internal UUIDs never appear in claim values.
    assert str(fx.PRIMARY_TENANT.uuid) not in {str(v) for v in claims.values()}
    assert claims["iss"] == fx.TEST_JWT_ISSUER
    assert claims["aud"] == fx.TEST_JWT_AUDIENCE
    assert claims["roles"] == ["dis:upload"]


def test_build_claims_for_code_less_store_yields_null_store_claim() -> None:
    uncoded = next(s for s in fx.STORES if s.store_code is None)
    tenant = fx.tenant_by_display_code(uncoded.tenant_display_code)
    claims = fx.build_claims(tenant, uncoded, issued_at=1000, expires_at=2000)
    assert claims["store_id"] is None
