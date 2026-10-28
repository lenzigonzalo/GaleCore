"""Batería 17/10: the record says the engine and model the Lab launched, not what the model types."""

from galecore_ai.adapters.cli import _declared


def test_the_lab_model_wins_over_the_declared_one(monkeypatch):
    monkeypatch.setenv("GALECORE_HOST_MODEL", "gpt-6.1-sol")
    monkeypatch.setenv("GALECORE_HOST_PROVIDER", "codex")
    assert _declared({"host_model": "gpt-6"}, "host_model") == "gpt-6.1-sol"
    assert _declared({}, "host_provider") == "codex"


def test_without_the_lab_the_declared_one_stays(monkeypatch):
    monkeypatch.delenv("GALECORE_HOST_MODEL", raising=False)
    assert _declared({"host_model": "sonnet"}, "host_model") == "sonnet"
