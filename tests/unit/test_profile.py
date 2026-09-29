"""GC-AI-0013: user profile — versioned, partial changes, citable as profile:v<N>."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from galecore_ai.adapters.knowledge_base import KNOWLEDGE_DIR_ENV, KnowledgeBaseError, parse_ref
from galecore_ai.adapters.profile_store import (
    FileProfileStore,
    ProfileIntegrityError,
    ProfileStoreError,
)
from galecore_ai.adapters.record_store import FileRecordStore, default_records_dir
from galecore_ai.adapters.research_store import FileResearchStore
from galecore_ai.application.knowledge import (
    KnowledgeBase,
    KnowledgeError,
    resolve_ref,
    save_research,
)
from galecore_ai.application.knowledge import search as kb_search
from galecore_ai.application.knowledge import show as kb_show
from galecore_ai.application.profile import ProfileError, history, set_profile, show
from galecore_ai.contracts.profile import ProfileContent
from galecore_ai.contracts.regime_record import RecordHost
from galecore_ai.contracts.research import ResearchContent

HOST = RecordHost(provider="claude-code", model="test-model")
NOW = datetime(2026, 9, 29, 18, 0, tzinfo=UTC)


@pytest.fixture
def kb(tmp_path, monkeypatch) -> KnowledgeBase:
    base = tmp_path / "knowledge"
    base.mkdir()
    monkeypatch.setenv(KNOWLEDGE_DIR_ENV, str(base))
    monkeypatch.delenv("GALECORE_RECORDS_DIR", raising=False)
    return KnowledgeBase(base=base, records=FileRecordStore(default_records_dir()), research=FileResearchStore(base))


def put(store: FileProfileStore, changes: dict, *, at: datetime = NOW, note: str = "cambio"):
    return set_profile(store, changes=changes, note=note, prompt="Mi capital de referencia es 10.000 USD",
                       host=HOST, now=at)


SEED = {"reference_capital": {"amount": 10000, "currency": "USD"},
        "delivery_format": ["tablas y gráficos primero, texto mínimo"], "language": "español",
        "preferred_sources": ["galecore", "fred"]}


class TestContent:
    def test_empty_profile_declares_every_field_missing(self):
        assert ProfileContent().missing() == list(ProfileContent.model_fields)

    @pytest.mark.parametrize("bad", [{"horizon": "  "}, {"objectives": [""]},
                                     {"reference_capital": {"amount": 0, "currency": "USD"}},
                                     {"reference_capital": {"amount": 10, "currency": "usd"}},
                                     {"unknown": 1}])
    def test_invalid_content_is_refused(self, bad):
        with pytest.raises(ValidationError):
            ProfileContent.model_validate(bad)


class TestSetAndShow:
    def test_no_profile_yet_says_everything_is_missing(self, kb):
        view = show(kb.profile)
        assert view["ref"] is None and "reference_capital" in view["missing"]

    def test_first_set_creates_v1_and_declares_what_is_missing(self, kb):
        doc, path = put(kb.profile, SEED)
        assert doc.ref == "profile:v1" and path.name == "v1.json"
        view = show(kb.profile)
        assert view["ref"] == "profile:v1"
        assert set(view["missing"]) == {"objectives", "max_drawdown", "horizon", "risk_limits"}

    def test_partial_change_keeps_the_rest_and_makes_a_new_version(self, kb):
        put(kb.profile, SEED)
        doc, _ = put(kb.profile, {"max_drawdown": "15 % del capital"}, at=NOW + timedelta(hours=1))
        assert doc.version == 2
        assert doc.content.max_drawdown == "15 % del capital"
        assert doc.content.reference_capital.amount == 10000
        assert kb.profile.load("v1").content.max_drawdown is None  # v1 untouched

    def test_null_clears_a_field_back_to_missing(self, kb):
        put(kb.profile, SEED)
        doc, _ = put(kb.profile, {"language": None})
        assert "language" in doc.content.missing()

    def test_no_real_change_creates_no_version(self, kb):
        put(kb.profile, SEED)
        doc, path = put(kb.profile, {"language": "español"})
        assert path is None and doc.version == 1
        assert kb.profile.versions() == ["v1"]

    def test_unknown_field_and_unknown_source_are_refused(self, kb):
        with pytest.raises(ProfileError, match="unknown fields"):
            put(kb.profile, {"capital": 5})
        with pytest.raises(ProfileError, match="not in config/sources.yaml"):
            put(kb.profile, {"preferred_sources": ["bloomberg"]})
        assert kb.profile.versions() == []

    def test_credentials_are_refused_without_echoing_them(self, kb):
        with pytest.raises(ProfileError) as exc:
            put(kb.profile, {"risk_limits": ["api_key=SYNTHETIC_SECRET_123456"]})
        assert "SYNTHETIC_SECRET_123456" not in str(exc.value)

    def test_history_is_newest_first(self, kb):
        put(kb.profile, SEED, note="inicial")
        put(kb.profile, {"horizon": "30 a 45 días"}, note="horizonte")
        assert [v["ref"] for v in history(kb.profile)] == ["profile:v2", "profile:v1"]


class TestStore:
    def test_a_version_is_never_overwritten(self, kb):
        doc, _ = put(kb.profile, SEED)
        with pytest.raises(ProfileStoreError, match="already exists"):
            kb.profile.create(doc)

    def test_edited_file_is_integrity_failed_and_blocks_changes(self, kb):
        _, path = put(kb.profile, SEED)
        path.write_text(path.read_text(encoding="utf-8").replace("10000", "99999"), encoding="utf-8")
        with pytest.raises(ProfileIntegrityError):
            kb.profile.load("v1")
        with pytest.raises(ProfileError, match="not usable"):
            show(kb.profile)
        with pytest.raises(ProfileError, match="not usable"):
            put(kb.profile, {"horizon": "30 días"})


class TestCitable:
    def test_profile_ref_parses_and_rejects_malformed(self):
        assert str(parse_ref("profile:v3")) == "profile:v3"
        for bad in ("profile:3", "profile:v0", "profile:latest"):
            with pytest.raises(KnowledgeBaseError):
                parse_ref(bad)

    def test_resolve_show_and_search(self, kb):
        put(kb.profile, SEED)
        resolved = resolve_ref("profile:v1", kb)
        assert resolved.path.endswith("profile/v1.json") and resolved.content_hash.startswith("sha256:")
        with pytest.raises(KnowledgeError, match="no such profile version"):
            resolve_ref("profile:v2", kb)
        assert kb_show(kb, "profile:v1")["content"]["reference_capital"]["amount"] == 10000
        assert [r["ref"] for r in kb_search(kb, text="perfil", kind="profile")["results"]] == ["profile:v1"]

    def test_an_investigation_records_the_profile_version_it_used(self, kb):
        put(kb.profile, SEED)
        content = ResearchContent.model_validate({
            "title": "Contexto", "question": "¿Qué importa hoy?", "status": "concluded",
            "antecedents": [{"ref": "profile:v1", "summary": "capital 10.000 USD; tablas primero",
                             "bearing": "tamaño de referencia y formato de la entrega"}],
            "limitations": ["objetivos no declarados en el perfil"],
        })
        doc, _ = save_research(kb=kb, slug="contexto", prompt="¿Qué importa hoy?", host=HOST, content=content, now=NOW)
        assert [r.ref for r in doc.current.resolved_refs] == ["profile:v1"]
        assert kb_show(kb, "profile:v1")["cited_by"] == [f"research:{doc.id}"]


def _cli(*args, kb_dir, stdin=None):
    import os

    env = {**os.environ, KNOWLEDGE_DIR_ENV: str(kb_dir)}
    return subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", *args], input=stdin,
                          capture_output=True, text=True, encoding="utf-8", check=False, env=env)


def test_cli_profile_set_show_history(tmp_path):
    kb_dir = tmp_path / "knowledge"
    kb_dir.mkdir()
    set_args = ("profile", "set", "--note", "inicial", "--prompt", "Mi capital es 10.000 USD", "--host-model", "m")
    out = _cli(*set_args, kb_dir=kb_dir, stdin=json.dumps({"changes": SEED}))
    assert out.returncode == 0, out.stdout + out.stderr
    assert json.loads(out.stdout)["ref"] == "profile:v1"
    again = _cli(*set_args, kb_dir=kb_dir, stdin=json.dumps({"changes": {"language": "español"}}))
    assert json.loads(again.stdout)["status"] == "UNCHANGED"
    shown = json.loads(_cli("profile", "show", kb_dir=kb_dir).stdout)
    assert shown["ref"] == "profile:v1" and "objectives" in shown["missing"]
    assert len(json.loads(_cli("profile", "history", kb_dir=kb_dir).stdout)["versions"]) == 1
    bad = _cli(*set_args, kb_dir=kb_dir, stdin=json.dumps({"changes": {}}))
    assert bad.returncode != 0
