"""Config resolution: required values raise, never default (code-quality rule 4)."""

from __future__ import annotations

import pytest

from dis_core.errors import DisError
from dis_ui_server.config import API_PREFIX, SERVICE_NAME, UiServerConfig


def test_missing_postgres_url_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    # Fail-fast at startup is the crashloop signal for MISCONFIGURATION — kept
    # strictly separate from the present-but-unreachable case (test_health.py),
    # which must NOT crash startup.
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    with pytest.raises(DisError, match="POSTGRES_URL"):
        UiServerConfig.from_env()


def test_present_postgres_url_resolves(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POSTGRES_URL", "postgresql+psycopg://u:p@localhost:5433/ithina_dis_db")
    config = UiServerConfig.from_env()
    assert config.postgres_url.endswith("/ithina_dis_db")


def test_service_constants_frozen() -> None:
    assert SERVICE_NAME == "dis-ui-server"
    assert API_PREFIX == "/api/v1"
