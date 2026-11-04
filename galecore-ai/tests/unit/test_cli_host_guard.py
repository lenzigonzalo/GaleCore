"""BF-0002: el CLI sólo habla con localhost o con el host exacto que el Lab declara."""

import pytest

from galecore_ai.adapters import cli

PROD = "https://vps-6285555-x.dattaweb.com"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.delenv("LOCAL_VALIDATION", raising=False)
    monkeypatch.delenv("GALECORE_ALLOWED_BASE_URL", raising=False)


def test_localhost_passes(monkeypatch):
    monkeypatch.setenv("GALECORE_BASE_URL", "http://localhost:7001")
    assert cli._build_dispatcher() is not None


def test_declared_production_host_passes(monkeypatch):
    monkeypatch.setenv("GALECORE_BASE_URL", PROD)
    monkeypatch.setenv("GALECORE_ALLOWED_BASE_URL", PROD)
    assert cli._build_dispatcher() is not None


@pytest.mark.parametrize("allowed", [None, "https://otro-host.example.com"])
def test_other_host_is_blocked(monkeypatch, capsys, allowed):
    monkeypatch.setenv("GALECORE_BASE_URL", PROD)
    if allowed:
        monkeypatch.setenv("GALECORE_ALLOWED_BASE_URL", allowed)
    with pytest.raises(SystemExit):
        cli._build_dispatcher()
    assert "but host is 'vps-6285555-x.dattaweb.com'" in capsys.readouterr().out
