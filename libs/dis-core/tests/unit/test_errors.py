"""Unit tests for the consolidated dis-core error hierarchy.

Acceptance: single ``DisError`` root; the six interim exceptions consolidated with
no duplicate definitions; ``errors.py`` is leaf-level (importing it does not pull
in ``dis_core.identity``).
"""

from __future__ import annotations

import subprocess
import sys

from dis_core.errors import (
    CustomerMasterReadError,
    DisError,
    IdentityClientError,
    IdentityNotFoundError,
    IdentityServiceUnavailableError,
    MappingConfigError,
    MappingError,
    MappingInputError,
    MirrorSyncError,
    SuiteDefinitionError,
    SuiteDriftError,
    ValidationSuiteError,
)


def test_identity_errors_root_at_dis_error() -> None:
    assert issubclass(IdentityClientError, DisError)
    assert issubclass(IdentityNotFoundError, IdentityClientError)
    assert issubclass(IdentityServiceUnavailableError, IdentityClientError)


def test_test_infra_error_reparented_onto_dis_error() -> None:
    # dis-testing's base reparents onto DisError (single-rooted tree) without
    # dis-core importing dis-testing.
    from dis_testing.errors import FixtureError, SeedError, TestInfraError

    assert issubclass(TestInfraError, DisError)
    assert issubclass(FixtureError, TestInfraError)
    assert issubclass(SeedError, TestInfraError)


def test_identity_errors_re_exported_from_identity_package() -> None:
    # Backward-compat: existing imports keep working after the move to errors.py.
    from dis_core.identity import IdentityNotFoundError as FromIdentity

    assert FromIdentity is IdentityNotFoundError


def test_unavailable_error_preserves_retry_after() -> None:
    err = IdentityServiceUnavailableError(
        "circuit open", status_code=503, error_code="circuit_open", trace_id="abc", retry_after=30
    )
    assert err.retry_after == 30
    assert err.status_code == 503
    assert err.error_code == "circuit_open"
    assert err.trace_id == "abc"


def test_mirror_sync_errors_root_at_dis_error() -> None:
    assert issubclass(MirrorSyncError, DisError)
    assert issubclass(CustomerMasterReadError, MirrorSyncError)


def test_customer_master_read_error_preserves_context() -> None:
    err = CustomerMasterReadError(
        "platform context not applied",
        database="ithina_platform_db",
        role="dis_mirror_reader",
        user_type=None,
        trace_id="trace-1",
    )
    assert err.database == "ithina_platform_db"
    assert err.role == "dis_mirror_reader"
    assert err.user_type is None
    assert err.trace_id == "trace-1"
    # MirrorSyncError base carries trace_id/tenant_id.
    assert MirrorSyncError("x", trace_id="t", tenant_id="ten").tenant_id == "ten"


def test_pipeline_mechanics_errors_root_at_dis_error() -> None:
    # Slice 5: dis-mapping / dis-validation config-layer errors (per-cell and
    # per-row data failures are typed result objects, never exceptions).
    assert issubclass(MappingError, DisError)
    assert issubclass(MappingConfigError, MappingError)
    assert issubclass(MappingInputError, MappingError)
    assert issubclass(ValidationSuiteError, DisError)
    assert issubclass(SuiteDefinitionError, ValidationSuiteError)
    assert issubclass(SuiteDriftError, ValidationSuiteError)


def test_mapping_error_preserves_context() -> None:
    err = MappingConfigError(
        "parse_decimal requires decimal_separator", column="unit_cost", tenant_id="ten", trace_id="tr"
    )
    assert err.column == "unit_cost"
    assert err.tenant_id == "ten"
    assert err.trace_id == "tr"
    assert err.message.startswith("parse_decimal")


def test_validation_suite_error_preserves_context() -> None:
    err = SuiteDriftError(
        "unclassified columns", model="StoreSkuSaleEvent", column="new_col", tenant_id=None, trace_id=None
    )
    assert err.model == "StoreSkuSaleEvent"
    assert err.column == "new_col"


def test_errors_module_is_leaf_level() -> None:
    # In a fresh interpreter, importing dis_core.errors must not import
    # dis_core.identity (errors.py imports nothing first-party).
    code = (
        "import sys, dis_core.errors;"
        "assert 'dis_core.identity' not in sys.modules, sorted(m for m in sys.modules if 'dis_core' in m)"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
