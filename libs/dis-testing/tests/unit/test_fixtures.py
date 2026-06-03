"""Sanity checks on the single source of fixture truth."""

from __future__ import annotations

import re

import pytest
from cryptography.hazmat.primitives.serialization import load_pem_private_key, load_pem_public_key

from dis_testing import fixtures as fx
from dis_testing.errors import FixtureError

TENANT_RE = re.compile(r"^t_[a-z0-9]{12}$")
STORE_RE = re.compile(r"^s_[a-z0-9]{12}$")


def test_external_ids_match_contract_patterns() -> None:
    for t in fx.TENANTS:
        assert TENANT_RE.match(t.external_id), t.external_id
    for s in fx.STORES:
        assert STORE_RE.match(s.external_id), s.external_id


def test_uuids_are_unique_across_tenants_and_stores() -> None:
    uuids = [t.uuid for t in fx.TENANTS] + [s.uuid for s in fx.STORES]
    assert len(uuids) == len(set(uuids))


def test_default_set_shape() -> None:
    # 2 tenants, 2 stores each, one ACTIVE + one INACTIVE per tenant.
    assert len(fx.TENANTS) == 2
    for t in fx.TENANTS:
        stores = fx.stores_for_tenant(t.external_id)
        assert len(stores) == 2
        statuses = {s.status for s in stores}
        assert statuses == {"ACTIVE", "INACTIVE"}


def test_primary_uses_openapi_example_ids() -> None:
    assert fx.PRIMARY_TENANT.external_id == "t_acme9k2l1mn4"
    assert fx.PRIMARY_STORE.external_id == "s_acme0001a4b7"
    assert fx.PRIMARY_STORE.tenant_external_id == fx.PRIMARY_TENANT.external_id


def test_every_store_references_a_known_tenant() -> None:
    known = {t.external_id for t in fx.TENANTS}
    for s in fx.STORES:
        assert s.tenant_external_id in known


def test_bridge_round_trips() -> None:
    assert fx.tenant_uuid_for("t_acme9k2l1mn4") == fx.PRIMARY_TENANT.uuid
    assert fx.store_uuid_for("s_acme0001a4b7") == fx.PRIMARY_STORE.uuid


def test_bridge_raises_on_unknown_id() -> None:
    with pytest.raises(FixtureError):
        fx.tenant_uuid_for("t_unknown00000")
    with pytest.raises(FixtureError):
        fx.store_uuid_for("s_unknown00000")


def test_default_source_mapping_targets_primary_tenant() -> None:
    assert fx.DEFAULT_SOURCE_MAPPING["tenant_external_id"] == fx.PRIMARY_TENANT.external_id
    assert fx.DEFAULT_SOURCE_MAPPING["status"] == "ACTIVE"
    assert fx.DEFAULT_SOURCE_MAPPING["source_id"] == fx.DEFAULT_SOURCE_ID


def test_committed_test_keypair_is_a_valid_matching_pair() -> None:
    priv = load_pem_private_key(fx.TEST_RSA_PRIVATE_KEY_PEM.encode(), password=None)
    pub = load_pem_public_key(fx.TEST_RSA_PUBLIC_KEY_PEM.encode())
    # Public numbers must match — confirms the committed pair is internally consistent.
    assert priv.public_key().public_numbers() == pub.public_numbers()


def test_build_claims_carries_external_ids_only() -> None:
    claims = fx.build_claims(fx.PRIMARY_TENANT, fx.PRIMARY_STORE, issued_at=1000, expires_at=2000)
    assert claims["tenant_id"] == "t_acme9k2l1mn4"
    assert claims["store_id"] == "s_acme0001a4b7"
    assert claims["iss"] == fx.TEST_JWT_ISSUER
    assert claims["aud"] == fx.TEST_JWT_AUDIENCE
    assert claims["roles"] == ["dis:upload"]
