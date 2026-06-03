"""Unit tests for the consolidated dis-core error hierarchy.

Acceptance: single ``DisError`` root; the six interim exceptions consolidated with
no duplicate definitions; ``errors.py`` is leaf-level (importing it does not pull
in ``dis_core.identity``).
"""

from __future__ import annotations

import subprocess
import sys

from dis_core.errors import (
    DisError,
    IdentityClientError,
    IdentityNotFoundError,
    IdentityServiceUnavailableError,
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


def test_errors_module_is_leaf_level() -> None:
    # In a fresh interpreter, importing dis_core.errors must not import
    # dis_core.identity (errors.py imports nothing first-party).
    code = (
        "import sys, dis_core.errors;"
        "assert 'dis_core.identity' not in sys.modules, sorted(m for m in sys.modules if 'dis_core' in m)"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
