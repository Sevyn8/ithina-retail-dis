"""Unit tests for the internal identifier vocabulary and the D37 name split."""

from __future__ import annotations

from uuid import UUID

from dis_core import identifiers
from dis_core.identity import models as identity_models


def test_internal_identifiers_are_uuid_and_int() -> None:
    assert identifiers.TenantId is UUID
    assert identifiers.StoreId is UUID
    assert identifiers.TraceId is UUID
    assert identifiers.MappingVersionId is int


def test_internal_tenant_id_differs_from_external_contract_alias() -> None:
    # The latent D37 split: identifiers.TenantId (internal UUID key) is NOT the
    # identity contract's external t_* string alias. Same name, different type.
    assert identifiers.TenantId is not identity_models.TenantId
    assert identifiers.StoreId is not identity_models.StoreId
