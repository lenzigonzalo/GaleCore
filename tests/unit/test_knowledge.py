"""Knowledge base, catalog and resumable investigations (GC-AI-0005)."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

from galecore_ai.adapters.cli import _SKILLS
from galecore_ai.adapters.knowledge_base import (
    KNOWLEDGE_DIR_ENV,
    KnowledgeBaseError,
    knowledge_dir,
    parse_ref,
)
from galecore_ai.adapters.record_store import FileRecordStore, default_records_dir
from galecore_ai.adapters.research_store import FileResearchStore, ResearchIntegrityError
from galecore_ai.adapters.snapshot_store import FileSnapshotStore
from galecore_ai.application.knowledge import (
    KnowledgeBase,
    KnowledgeError,
    revise_research,
    save_research,
    search,
    show,
)
from galecore_ai.application.record_regime import record_accepted
from galecore_ai.contracts.regime_record import RecordHost
from galecore_ai.contracts.research import ResearchContent, RevisionReason
from galecore_ai.harness.catalog import describe, load_catalog
from tests.unit.regime_support import regime_snapshot
from tests.unit.test_record_regime import PROMPT, _accepted

HOST = RecordHost(provider="claude-code", model="test-model")
NOW = datetime(2026, 9, 23, 22, 0, tzinfo=UTC)


@pytest.fixture
def kb(tmp_path, monkeypatch) -> KnowledgeBase:
    base = tmp_path / "knowledge"
    base.mkdir()
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "backlog.md").write_text("BL-011: el 0DTE vencido entra en el corte post-cierre\n",
                                                   encoding="utf-8")
    monkeypatch.setenv(KNOWLEDGE_DIR_ENV, str(base))
    monkeypatch.delenv("GALECORE_RECORDS_DIR", raising=False)
    return KnowledgeBase(base=base, records=FileRecordStore(default_records_dir()), research=FileResearchStore(base))


@pytest.fixture
def regime_record(kb, tmp_path) -> str:
    snapshot_store = FileSnapshotStore(base_dir=tmp_path / "snapshots")
    snapshot = regime_snapshot()
    result = _accepted(snapshot_store, snapshot)
    _, path = record_accepted(store=kb.records, snapshot=snapshot, result=result, prompt=PROMPT)
    return f"regime:SPY/{Path(path).stem}"


def content(**overrides) -> ResearchContent:
    data = {
        "title": "0DTE vencido en el GEX post-cierre",
        "question": "¿Cuánto pesa el vencimiento del día en el net GEX leído después del cierre?",
        "status": "test_planned",
        "antecedents": [{"ref": "file:notes/backlog.md", "summary": "BL-011 registra el 0DTE en el corte",
                         "bearing": "Define qué medir: el aporte del vencimiento del día al agregado"}],
        "statements": [
            {"kind": "fact", "text": "El corte incluye el vencimiento del día", "sources": ["file:notes/backlog.md"]},
            {"kind": "hypothesis", "text": "Sin el 0DTE el signo del régimen cambia en algunos días"},
        ],
        "hypothesis": "Excluir el vencimiento del día cambia el signo del net GEX en una parte de los días",
        "test_plan": [{"step": "Recalcular el agregado sin el vencimiento del día",
                       "data_needed": "byExpiry de /App/Gex/Analysis post-cierre",
                       "supports_if": "Algún día cambia de signo", "weakens_if": "Ningún día cambia de signo"}],
        "missing": ["Serie de byExpiry archivada"],
        "next_steps": ["Archivar byExpiry en cada corrida post-cierre"],
        "limitations": ["Tres días no alcanzan para una tasa"],
    }
    data.update(overrides)
    return ResearchContent.model_validate(data)


def save(kb, slug="gex-0dte", **overrides):
    return save_research(kb=kb, slug=slug, prompt="Investigá el 0DTE", host=HOST, content=content(**overrides),
                         now=NOW)


class TestLocation:
    def test_env_override_and_missing_is_an_error(self, tmp_path, monkeypatch):
        monkeypatch.setenv(KNOWLEDGE_DIR_ENV, str(tmp_path / "nope"))
        with pytest.raises(KnowledgeBaseError, match="does not exist"):
            knowledge_dir()
        assert not (tmp_path / "nope").exists()

    def test_regime_records_default_to_the_knowledge_base(self, kb):
        assert default_records_dir() == (kb.base / "regime").resolve()

    def test_records_dir_env_still_overrides(self, kb, tmp_path, monkeypatch):
        monkeypatch.setenv("GALECORE_RECORDS_DIR", str(tmp_path / "elsewhere"))
        assert default_records_dir() == (tmp_path / "elsewhere").resolve()

    def test_workspace_root_is_found_from_a_checkout_or_a_worktree(self, tmp_path):
        from galecore_ai.adapters.knowledge_base import _workspace_root
        (tmp_path / "ENGINEERING.md").write_text("x", encoding="utf-8")
        (tmp_path / "GaleCore-AI" / "src").mkdir(parents=True)
        deep = tmp_path / ".worktrees" / "galecore-ai" / "GC-AI-9999" / "src" / "galecore_ai"
        deep.mkdir(parents=True)
        assert _workspace_root(tmp_path / "GaleCore-AI" / "src") == tmp_path
        assert _workspace_root(deep) == tmp_path
        assert _workspace_root(tmp_path.parent) is None


class TestRefs:
    @pytest.mark.parametrize("text,expected", [
        ("regime:spy/2026-09-23", "regime:SPY/2026-09-23"),
        ("research:2026-09-23-gex-0dte", "research:2026-09-23-gex-0dte"),
        ("file:GaleCore-AI\\docs\\x.md", "file:GaleCore-AI/docs/x.md"),
    ])
    def test_normalised(self, text, expected):
        assert str(parse_ref(text)) == expected

    @pytest.mark.parametrize("text", ["web:x", "file:../x", "file:/etc/x", "file:C:/x", "regime:SPY",
                                      "research:Not_An_Id", "no-colon"])
    def test_rejected(self, text):
        with pytest.raises(KnowledgeBaseError):
            parse_ref(text)


class TestCatalog:
    def test_every_entry_is_available_and_consistent(self):
        entries = describe(load_catalog())
        assert {e["id"] for e in entries} == {"gex_interpretation", "regime_interpretation", "research"}
        assert all(e["available"] for e in entries), entries

    def test_prepare_skills_have_code_behind_them(self):
        declared = {e.prepare_skill for e in load_catalog().entries if e.prepare_skill}
        assert declared == set(_SKILLS)

    def test_regime_skill_hash_is_the_one_in_the_records(self):
        regime = next(e for e in describe(load_catalog()) if e["id"] == "regime_interpretation")
        assert regime["skill_asset"]["content_hash"] == (
            "sha256:c58972b66a14f7ca54b1a2a699f077fceec63ecbb24bb325c1facac9cf641ba5")


class TestSave:
    def test_valid_investigation_is_stored_with_provenance(self, kb):
        document, path = save(kb)
        assert document.id == "2026-09-23-gex-0dte" and path.is_file()
        rev = document.current
        assert rev.revision == 1 and rev.reason == RevisionReason.INITIAL
        assert rev.skill.asset_id == "research" and rev.skill.content_hash.startswith("sha256:")
        assert rev.host.provenance == "HOST_DECLARED"
        assert [r.ref for r in rev.resolved_refs] == ["file:notes/backlog.md"]
        assert kb.research.load(document.id) == document
        body = path.read_text(encoding="utf-8")
        assert "[`file:notes/backlog.md`](../../notes/backlog.md)" in body
        assert "**Efecto:**" in body

    @pytest.mark.parametrize("overrides,problem", [
        ({"antecedents": [{"ref": "file:notes/missing.md", "summary": "s", "bearing": "b"}]}, "no such file"),
        ({"antecedents": [{"ref": "research:2026-01-01-nothing", "summary": "s", "bearing": "b"}]},
         "no such investigation"),
        ({"statements": [{"kind": "fact", "text": "Un hecho sin fuente"}]}, "must cite at least one source"),
        ({"status": "open", "next_steps": []}, "requires at least one next step"),
        ({"hypothesis": None}, "requires a hypothesis and a test plan"),
        ({"limitations": []}, "at least one limitation"),
    ])
    def test_controls_reject(self, kb, overrides, problem):
        with pytest.raises(KnowledgeError, match=problem):
            save(kb, **overrides)
        assert kb.research.ids() == []

    def test_antecedent_without_bearing_is_not_valid_content(self):
        with pytest.raises(ValueError):
            content(antecedents=[{"ref": "file:notes/backlog.md", "summary": "s", "bearing": "  "}])

    def test_regime_record_can_be_cited(self, kb, regime_record):
        document, _ = save(kb, antecedents=[{"ref": regime_record, "summary": "Registro del día",
                                             "bearing": "Da el agregado que se descompone"}])
        assert document.current.resolved_refs[0].ref == regime_record

    def test_file_ref_into_the_knowledge_base_is_refused(self, kb, regime_record):
        # Review R1 MAJOR: file: paths skipped the self-citation and integrity checks.
        day = regime_record.rsplit("/", 1)[1]
        with pytest.raises(KnowledgeError, match="cite it as regime: or research:"):
            save(kb, antecedents=[{"ref": f"file:knowledge/regime/SPY/{day}.md", "summary": "s", "bearing": "b"}])
        first, _ = save(kb)
        with pytest.raises(KnowledgeError, match="cite it as regime: or research:"):
            revise_research(kb=kb, research_id=first.id, reason=RevisionReason.CONTINUATION, note="n",
                            prompt="p", host=HOST,
                            content=content(statements=[{"kind": "fact", "text": "t",
                                                         "sources": [f"file:knowledge/research/{first.id}.md"]}]))

    def test_regime_refs_need_the_records_inside_the_knowledge_base(self, kb, tmp_path):
        moved = KnowledgeBase(base=kb.base, records=FileRecordStore(tmp_path / "elsewhere"), research=kb.research)
        with pytest.raises(KnowledgeError, match="not in the knowledge base"):
            save(moved, antecedents=[{"ref": "regime:SPY/2026-09-20", "summary": "s", "bearing": "b"}])

    def test_id_with_trailing_newline_is_not_a_path(self, kb):
        from galecore_ai.adapters.research_store import ResearchStoreError
        with pytest.raises(ResearchStoreError):
            kb.research.path_for("2026-09-23-abc\n")

    def test_same_id_twice_is_refused(self, kb):
        save(kb)
        with pytest.raises(KnowledgeError, match="already exists"):
            save(kb)


class TestRevise:
    def test_continuation_keeps_earlier_revisions(self, kb):
        first, _ = save(kb)
        doc, _ = revise_research(kb=kb, research_id=first.id, reason=RevisionReason.RESULT,
                                 note="Se archivó un día de byExpiry", prompt="Seguí", host=HOST,
                                 content=content(status="open"), now=NOW)
        assert [r.revision for r in doc.revisions] == [1, 2]
        assert doc.revisions[0] == first.revisions[0]
        assert kb.research.load(first.id).current.reason == RevisionReason.RESULT

    @pytest.mark.parametrize("reason,note,problem", [
        (RevisionReason.INITIAL, "x", "cannot be 'initial'"),
        (RevisionReason.CORRECTION, " ", "needs a note"),
    ])
    def test_bad_revision_is_refused(self, kb, reason, note, problem):
        first, _ = save(kb)
        with pytest.raises(KnowledgeError, match=problem):
            revise_research(kb=kb, research_id=first.id, reason=reason, note=note, prompt="p", host=HOST,
                            content=content())

    def test_self_citation_is_refused(self, kb):
        first, _ = save(kb)
        with pytest.raises(KnowledgeError, match="cannot cite itself"):
            revise_research(kb=kb, research_id=first.id, reason=RevisionReason.CONTINUATION, note="n",
                            prompt="p", host=HOST,
                            content=content(antecedents=[{"ref": f"research:{first.id}", "summary": "s",
                                                          "bearing": "b"}]))

    def test_tampered_earlier_revision_is_integrity_failed(self, kb):
        first, path = save(kb)
        revise_research(kb=kb, research_id=first.id, reason=RevisionReason.CONTINUATION, note="n",
                        prompt="p", host=HOST, content=content(status="open"))
        text = path.read_text(encoding="utf-8")
        path.write_text(text.replace("Tres días no alcanzan para una tasa", "Alcanza", 1), encoding="utf-8")
        with pytest.raises(ResearchIntegrityError, match="content_hash mismatch"):
            kb.research.load(first.id)
        with pytest.raises(KnowledgeError, match="not usable"):
            revise_research(kb=kb, research_id=first.id, reason=RevisionReason.CONTINUATION, note="n",
                            prompt="p", host=HOST, content=content(status="open"))
        assert search(kb, kind="research")["integrity_failed"][0]["ref"] == f"research:{first.id}"


class TestSearchAndShow:
    def test_search_finds_research_and_regime(self, kb, regime_record):
        save(kb)
        found = search(kb, text="0DTE vencido")
        assert found["results"][0]["ref"] == "research:2026-09-23-gex-0dte"
        assert found["results"][0]["next_steps"] == ["Archivar byExpiry en cada corrida post-cierre"]
        regimes = search(kb, text="gamma", kind="regime")
        assert [r["ref"] for r in regimes["results"]] == [regime_record]

    def test_misnamed_file_is_reported_not_skipped(self, kb):
        save(kb)
        (kb.base / "research" / "Notas sueltas.md").write_text("x", encoding="utf-8")
        failed = search(kb)["integrity_failed"]
        assert [f["status"] for f in failed] == ["UNRECOGNISED_NAME"]

    def test_status_filter(self, kb):
        save(kb)
        assert search(kb, status="open")["count"] == 0
        assert search(kb, status="test_planned")["count"] == 1
        # a fresh session looking for pending work must find test_planned too (found in the real demo)
        assert search(kb, status="unfinished")["count"] == 1

    def test_show_gives_pending_work_and_backlinks(self, kb):
        first, _ = save(kb)
        save(kb, slug="followup", antecedents=[{"ref": f"research:{first.id}", "summary": "La original",
                                                "bearing": "Parte de su plan de prueba"}])
        shown = show(kb, f"research:{first.id}")
        assert shown["pending"]["next_steps"] == ["Archivar byExpiry en cada corrida post-cierre"]
        assert shown["cited_by"] == ["research:2026-09-23-followup"]
        assert sorted(show(kb, "file:notes/backlog.md")["cited_by"]) == sorted(
            ["research:2026-09-23-followup", f"research:{first.id}"])


class TestCli:
    def _run(self, *args, stdin=None, env=None):
        import os
        result = subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", *args], input=stdin,
                                capture_output=True, text=True, timeout=60, check=False,
                                env={**os.environ, **(env or {})})
        return result.returncode, json.loads(result.stdout)

    def test_catalog_lists_three_capabilities(self, kb):
        code, data = self._run("catalog", env={KNOWLEDGE_DIR_ENV: str(kb.base)})
        assert code == 0 and data["knowledge_base"]["available"]
        assert [e["id"] for e in data["entries"]] == ["gex_interpretation", "regime_interpretation", "research"]

    def test_save_search_show_revise(self, kb):
        env = {KNOWLEDGE_DIR_ENV: str(kb.base)}
        request = json.dumps({"content": content().model_dump(mode="json"), "host_provider": "claude-code",
                              "host_model": "test"})
        code, saved = self._run("research", "save", "--slug", "gex-0dte", "--prompt", "Investigá", stdin=request,
                                env=env)
        assert code == 0 and saved["status"] == "RECORDED", saved
        code, found = self._run("kb", "search", "--text", "0DTE", "--status", "test_planned", env=env)
        assert code == 0 and found["results"][0]["ref"] == saved["ref"]
        code, shown = self._run("kb", "show", saved["ref"], env=env)
        assert code == 0 and shown["pending"]["missing"] == ["Serie de byExpiry archivada"]
        code, revised = self._run("research", "revise", "--id", saved["ref"].split(":", 1)[1], "--reason",
                                  "continuation", "--note", "sigue", "--prompt", "Retomá", stdin=request, env=env)
        assert code == 0 and revised["revision"] == 2 and revised["previous_revisions"] == 1

    def test_stdin_is_read_as_utf8_whatever_the_console_code_page(self, kb):
        import os
        env = {k: v for k, v in os.environ.items() if k not in ("PYTHONUTF8", "PYTHONIOENCODING")}
        env[KNOWLEDGE_DIR_ENV] = str(kb.base)
        payload = {"content": content(title="Régimen: ¿qué pasó?").model_dump(mode="json")}
        result = subprocess.run([sys.executable, "-B", "-m", "galecore_ai.adapters.cli", "research", "save",
                                 "--slug", "utf8", "--prompt", "p"], input=json.dumps(payload,
                                ensure_ascii=False).encode("utf-8"), capture_output=True, timeout=60, check=False,
                                env=env)
        assert result.returncode == 0, result.stdout
        stored = kb.research.load("2026-09-23-utf8") or kb.research.load(json.loads(result.stdout)["ref"][9:])
        assert stored.current.content.title == "Régimen: ¿qué pasó?"

    def test_stdin_bom_and_accents_are_accepted(self, monkeypatch):
        import io

        from galecore_ai.adapters import cli
        raw = '﻿{"t": "Régimen ¿ñ?"}'.encode()
        monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO(raw), encoding="cp1252"))
        assert json.loads(cli._read_stdin()) == {"t": "Régimen ¿ñ?"}

    def test_rejection_is_json_with_problems(self, kb):
        bad = content().model_dump(mode="json")
        bad["statements"] = [{"kind": "fact", "text": "sin fuente", "sources": []}]
        code, data = self._run("research", "save", "--slug", "x-y", "--prompt", "p",
                               stdin=json.dumps({"content": bad}), env={KNOWLEDGE_DIR_ENV: str(kb.base)})
        assert code == 3 and data["status"] == "REJECTED"
        assert any("must cite" in p for p in data["problems"])

    def test_missing_knowledge_base_fails_closed(self, tmp_path):
        code, data = self._run("kb", "search", env={KNOWLEDGE_DIR_ENV: str(tmp_path / "none")})
        assert code == 1 and "does not exist" in data["error"]
