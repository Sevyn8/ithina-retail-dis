"""Unit tests for the consolidated dis-core error hierarchy.

Acceptance: single ``DisError`` root; the six interim exceptions consolidated with
no duplicate definitions; ``errors.py`` is leaf-level (importing it does not pull
in ``dis_core.identity``).
"""

from __future__ import annotations

import subprocess
import sys

from dis_core.errors import (
    AuthTokenError,
    CsvIngestError,
    CustomerMasterReadError,
    DisError,
    EventContractError,
    EventPathMismatchError,
    FieldCatalogDriftError,
    IdentityClientError,
    IdentityNotFoundError,
    IdentityServiceUnavailableError,
    MappingConfigError,
    MappingError,
    MappingInputError,
    MappingStateConflictError,
    MappingTemplateNameConflictError,
    MirrorSyncError,
    OpsRoleRequiredError,
    PreflightFailedError,
    ResourceNotFoundError,
    SuiteDefinitionError,
    SuiteDriftError,
    TenantScopeError,
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


def test_csv_ingest_errors_root_at_dis_error() -> None:
    # Slice 9b: the worker raises only DisError-rooted errors (code convention).
    assert issubclass(CsvIngestError, DisError)
    assert issubclass(EventContractError, CsvIngestError)
    assert issubclass(EventPathMismatchError, CsvIngestError)
    assert issubclass(PreflightFailedError, CsvIngestError)


def test_event_contract_error_preserves_context() -> None:
    err = EventContractError(
        "upload_session_id missing", field="upload_session_id", tenant_id="ten", trace_id="tr"
    )
    assert err.field == "upload_session_id"
    assert err.tenant_id == "ten"
    assert err.trace_id == "tr"


def test_event_path_mismatch_error_preserves_both_values() -> None:
    # The cross-check error must carry both observed values (identifiers only) so a
    # malformed producer is diagnosable from the error alone (code-quality rule 5).
    err = EventPathMismatchError(
        "tenant segment disagrees",
        field="tenant_id",
        event_value="019e5e3c-b5d3-705f-9002-2451c4ca2626",
        path_value="019e89f9-dbd5-7703-8221-ae6b811599bb",
        tenant_id="019e5e3c-b5d3-705f-9002-2451c4ca2626",
        trace_id="tr",
    )
    assert err.field == "tenant_id"
    assert err.event_value != err.path_value
    assert err.trace_id == "tr"


def test_preflight_failed_error_preserves_reason_and_detail() -> None:
    err = PreflightFailedError(
        "object does not parse as CSV",
        reason="not_csv",
        detail="duckdb sniff failed at byte 0",
        tenant_id="ten",
        trace_id="tr",
    )
    assert err.reason == "not_csv"
    assert err.detail == "duckdb sniff failed at byte 0"
    assert err.tenant_id == "ten"


def test_auth_seam_errors_root_at_dis_error() -> None:
    # Slice 13a: the dis-ui-server auth seam raises only DisError-rooted errors,
    # mapped to 401/403 by the service's exception handlers (contract §2.3).
    assert issubclass(AuthTokenError, DisError)
    assert issubclass(TenantScopeError, DisError)
    assert issubclass(OpsRoleRequiredError, DisError)


def test_auth_token_error_preserves_reason() -> None:
    err = AuthTokenError("token expired", reason="expired")
    assert err.reason == "expired"
    assert err.message == "token expired"


def test_tenant_scope_error_preserves_tenant_id() -> None:
    # A platform user (tenant_id None) hitting a tenant endpoint is the canonical
    # raiser; the field stays None then, and carries the tenant where one exists.
    assert TenantScopeError("token carries no tenant_id").tenant_id is None
    err = TenantScopeError(
        "resource belongs to another tenant",
        tenant_id="019e89f9-dbd5-7703-8221-ae6b811599bb",
    )
    assert err.tenant_id == "019e89f9-dbd5-7703-8221-ae6b811599bb"


def test_ops_role_required_error_message() -> None:
    err = OpsRoleRequiredError("dis:ops role required")
    assert err.message == "dis:ops role required"


def test_data_endpoint_errors_root_at_dis_error() -> None:
    # Slice 14b: the dis-ui-server data endpoints' error family (contract §7.4),
    # mapped to 404/409 (and a startup abort) by the service's handlers.
    assert issubclass(ResourceNotFoundError, DisError)
    assert issubclass(MappingTemplateNameConflictError, DisError)
    assert issubclass(MappingStateConflictError, DisError)
    assert issubclass(FieldCatalogDriftError, DisError)


def test_resource_not_found_error_preserves_context() -> None:
    err = ResourceNotFoundError(
        "mapping template x not found",
        resource="mapping_template",
        identifier="019e9804-12ce-7f57-b9c0-eb3c7d0e8609",
        tenant_id="ten",
    )
    assert err.resource == "mapping_template"
    assert err.identifier == "019e9804-12ce-7f57-b9c0-eb3c7d0e8609"
    assert err.tenant_id == "ten"


def test_template_name_conflict_error_preserves_context() -> None:
    err = MappingTemplateNameConflictError(
        "name taken", tenant_id="ten", source_id="manual_csv_upload", template_name="sales"
    )
    assert err.source_id == "manual_csv_upload"
    assert err.template_name == "sales"
    assert err.tenant_id == "ten"


def test_mapping_state_conflict_error_preserves_context() -> None:
    err = MappingStateConflictError(
        "lineage closed",
        template_id="tpl",
        tenant_id="ten",
        expected="DRAFT, STAGED or ACTIVE",
        actual="DEPRECATED",
    )
    assert err.template_id == "tpl"
    assert err.expected == "DRAFT, STAGED or ACTIVE"
    assert err.actual == "DEPRECATED"


def test_field_catalog_drift_error_preserves_column_names() -> None:
    err = FieldCatalogDriftError("labels drifted", missing=("quantity",), stale=("ghost",))
    assert err.missing == ("quantity",)
    assert err.stale == ("ghost",)


def test_errors_module_is_leaf_level() -> None:
    # In a fresh interpreter, importing dis_core.errors must not import
    # dis_core.identity (errors.py imports nothing first-party).
    code = (
        "import sys, dis_core.errors;"
        "assert 'dis_core.identity' not in sys.modules, sorted(m for m in sys.modules if 'dis_core' in m)"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
