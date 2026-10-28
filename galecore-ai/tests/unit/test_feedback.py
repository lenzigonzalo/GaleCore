"""GC-AI-0016: the user's comment tied to the exact result and to the version that applies it."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date, timedelta

import pytest

from galecore_ai.adapters.knowledge_base import parse_ref
from galecore_ai.application import knowledge
from galecore_ai.application.catalog_check import _history_problems
from galecore_ai.application.knowledge import (
    KnowledgeError,
    check_feedback_citations,
    feedback_status,
    revise_research,
    save_feedback,
    search,
    show,
)
from galecore_ai.application.profile import set_profile
from galecore_ai.contracts.feedback import FeedbackKind
from galecore_ai.contracts.research import RevisionReason
from galecore_ai.harness.catalog import load_catalog
from galecore_ai.harness.skill_history import SkillHistory, SkillHistoryError, load_skill_history
from tests.unit.test_knowledge import HOST, NOW, content, kb, save  # noqa: F401  (kb is a fixture)

WORDS = "quiero que me diga qué evento macro viene y cómo afecta mis posiciones"
RESEARCH = "research:2026-09-23-gex-0dte"


def comment(kb, *, slug="macro-y-posiciones", kind=FeedbackKind.METHOD, research=RESEARCH, revision=1,  # noqa: F811
            words=WORDS, **kw):
    return save_feedback(kb=kb, slug=slug, words=words, classification=kind, research=research, revision=revision,
                         prompt="Si tomalo como comentario", host=HOST, now=NOW + timedelta(hours=1), **kw)


def revise_citing(kb, ref: str, research_id="2026-09-23-gex-0dte"):  # noqa: F811
    body = content()
    body.antecedents.append(body.antecedents[0].model_copy(update={"ref": ref, "summary": "comentario del usuario",
                                                                  "bearing": "corrige la lectura"}))
    return revise_research(kb=kb, research_id=research_id, reason=RevisionReason.CORRECTION, note="aplica el comentario",
                           prompt="Corregilo", host=HOST, content=body, now=NOW + timedelta(hours=2))


class TestRecord:
    def test_target_skill_and_version_come_from_the_stored_revision(self, kb):  # noqa: F811
        doc, _ = save(kb)
        fb, path = comment(kb, formulation="qué macro viene y cómo afecta")
        rev = doc.current
        assert path == kb.base / "feedback" / "2026-09-23-macro-y-posiciones.json"
        assert fb.target.research == RESEARCH and fb.target.revision == 1
        assert fb.target.revision_hash == rev.content_hash
        assert fb.target.skill == rev.skill
        assert fb.words == WORDS and fb.classification == FeedbackKind.METHOD

    @pytest.mark.parametrize(("research", "revision", "expected"), [
        ("research:2026-09-23-no-existe", 1, "no such investigation"),
        (RESEARCH, 2, "has no revision 2"),
        ("evidence:2026-09-23-x", 1, "stored result"),
        ("research:mal", 1, "Malformed"),
    ])
    def test_a_missing_result_or_revision_is_refused(self, kb, research, revision, expected):  # noqa: F811
        save(kb)
        with pytest.raises(KnowledgeError, match=expected):
            comment(kb, research=research, revision=revision)
        assert not (kb.base / "feedback").exists()

    def test_written_once_and_an_edit_is_integrity_failed(self, kb):  # noqa: F811
        save(kb)
        _, path = comment(kb)
        with pytest.raises(KnowledgeError, match="already exists"):
            comment(kb)
        path.write_text(path.read_text(encoding="utf-8").replace("macro", "MACRO"), encoding="utf-8")
        with pytest.raises(KnowledgeError, match="INTEGRITY_FAILED"):
            show(kb, "feedback:2026-09-23-macro-y-posiciones")
        assert feedback_status(kb)["integrity_failed"][0]["ref"] == "feedback:2026-09-23-macro-y-posiciones"

    @pytest.mark.parametrize("words", ["", "   ", "mi api_key=abcdef1234567890"])
    def test_blank_words_or_a_credential_are_refused_without_echo(self, kb, words):  # noqa: F811
        save(kb)
        with pytest.raises(KnowledgeError) as exc:
            comment(kb, words=words)
        assert "abcdef1234567890" not in str(exc.value)

    def test_search_and_show_find_it(self, kb):  # noqa: F811
        save(kb)
        comment(kb)
        found = search(kb, text="macro posiciones", kind="feedback")
        assert [r["ref"] for r in found["results"]] == ["feedback:2026-09-23-macro-y-posiciones"]
        shown = show(kb, "feedback:2026-09-23-macro-y-posiciones")
        assert shown["words"] == WORDS and shown["status"] == "pending"

    def test_ref_parses(self):
        assert str(parse_ref("feedback:2026-09-30-x")) == "feedback:2026-09-30-x"
        with pytest.raises(Exception, match="Malformed feedback"):
            parse_ref("feedback:x")


class TestApplied:
    def test_case_is_applied_by_a_revision_of_the_same_result(self, kb):  # noqa: F811
        save(kb)
        comment(kb, kind=FeedbackKind.CASE)
        assert feedback_status(kb)["pending"] == 1
        revise_citing(kb, "feedback:2026-09-23-macro-y-posiciones")
        item = feedback_status(kb)["feedback"][0]
        assert item["status"] == "applied"
        assert item["applied_in"] == [{"where": "research", "ref": RESEARCH, "revision": 2,
                                       "note": "aplica el comentario"}]
        assert show(kb, RESEARCH)["current"]["resolved_refs"][-1]["ref"] == "feedback:2026-09-23-macro-y-posiciones"

    def test_a_method_comment_cited_by_a_revision_is_still_pending(self, kb):  # noqa: F811
        save(kb)
        comment(kb, kind=FeedbackKind.METHOD)
        revise_citing(kb, "feedback:2026-09-23-macro-y-posiciones")
        item = feedback_status(kb)["feedback"][0]
        assert item["status"] == "pending" and item["cited_elsewhere"][0]["where"] == "research"

    def test_a_revision_cannot_cite_a_missing_feedback(self, kb):  # noqa: F811
        save(kb)
        with pytest.raises(KnowledgeError, match="no such feedback"):
            revise_citing(kb, "feedback:2026-09-23-no-existe")

    def test_preference_is_applied_by_a_profile_version(self, kb):  # noqa: F811
        save(kb)
        fb, _ = comment(kb, kind=FeedbackKind.PREFERENCE)
        assert check_feedback_citations(kb, [fb.ref], kind=FeedbackKind.PREFERENCE) == []
        pv, _ = set_profile(kb.profile, changes={"delivery_format": ["tablas primero"]}, note="formato",
                            prompt="así", host=HOST, now=NOW + timedelta(hours=2), feedback=[fb.ref])
        assert kb.profile.load("v1").feedback == [fb.ref]  # hash round-trips with the field
        item = feedback_status(kb)["feedback"][0]
        assert item["status"] == "applied" and item["applied_in"][0] == {"where": "profile", "ref": pv.ref,
                                                                         "note": "formato"}

    def test_a_profile_without_feedback_keeps_the_old_hash_shape(self, kb):  # noqa: F811
        pv, _ = set_profile(kb.profile, changes={"delivery_format": ["tablas"]}, note="n", prompt="p", host=HOST,
                               now=NOW)
        assert "feedback" not in pv.hashable_content()
        assert kb.profile.load("v1") == pv

    def test_wrong_kind_or_skill_or_same_version_is_refused_where_applied(self, kb):  # noqa: F811
        doc, _ = save(kb)
        method, _ = comment(kb, kind=FeedbackKind.METHOD)
        assert "applied in skill" in check_feedback_citations(kb, [method.ref], kind=FeedbackKind.PREFERENCE)[0]
        skill = doc.current.skill
        assert "not daily_attention" in check_feedback_citations(
            kb, [method.ref], kind=FeedbackKind.METHOD, skill_id="daily_attention")[0]
        assert "version" in check_feedback_citations(
            kb, [method.ref], kind=FeedbackKind.METHOD, skill_id=skill.asset_id, applied_version=skill.version)[0]
        assert check_feedback_citations(kb, [method.ref], kind=FeedbackKind.METHOD, skill_id=skill.asset_id,
                                        applied_version="9.9.9", owner_decision="sí, siempre") == []
        assert "no such feedback" in check_feedback_citations(kb, ["feedback:2026-01-01-x"],
                                                              kind=FeedbackKind.METHOD)[0]

    def test_method_is_applied_by_the_skill_history(self, kb, monkeypatch):  # noqa: F811
        doc, _ = save(kb)
        fb, _ = comment(kb, kind=FeedbackKind.METHOD)
        skill = doc.current.skill
        history = SkillHistory(skill_id=skill.asset_id, versions=[
            {"version": "9.9.9", "date": date(2026, 9, 30), "changes": "dice qué macro viene", "feedback": [fb.ref]}])
        real = knowledge.load_skill_history
        monkeypatch.setattr(knowledge, "load_skill_history",
                            lambda path: history if path == "skills/research/SKILL.md" else real(path))
        item = feedback_status(kb)["feedback"][0]
        assert item["status"] == "applied"
        assert item["applied_in"] == [{"where": "skill", "skill": skill.asset_id, "version": "9.9.9",
                                       "changes": "dice qué macro viene"}]


class TestSkillHistory:
    def test_every_catalog_skill_has_a_history_for_its_version_in_force(self):
        for entry in load_catalog().entries:
            assert load_skill_history(entry.skill).skill_id == entry.id

    def test_missing_history_is_an_error(self):
        with pytest.raises(SkillHistoryError, match="no history.yaml"):
            load_skill_history("skills/no-existe/skill.yaml")

    def _entry(self):
        return load_catalog().get("research")

    def test_catalog_check_requires_the_version_in_force(self):
        assert _history_problems(self._entry(), {"skill_asset": {"version": "1.3.0"}}, None) == []
        assert "no entry for the version in force 7.0.0" in _history_problems(
            self._entry(), {"skill_asset": {"version": "7.0.0"}}, None)[0]

    def test_catalog_check_verifies_cited_feedback(self, monkeypatch):
        from galecore_ai.application import catalog_check
        history = SkillHistory(skill_id="research", versions=[
            {"version": "1.3.0", "date": date(2026, 9, 30), "changes": "x", "feedback": ["feedback:2026-09-30-a"]},
            {"version": "1.3.0", "date": date(2026, 9, 29), "changes": "y"}])
        monkeypatch.setattr(catalog_check, "load_skill_history", lambda path: history)
        found = _history_problems(self._entry(), {"skill_asset": {"version": "1.3.0"}}, None)
        assert any("more than once" in p for p in found)
        assert any("knowledge base is not available" in p for p in found)
        calls = []
        found = _history_problems(self._entry(), {"skill_asset": {"version": "1.3.0"}},
                                  lambda refs, sid, ver, decision: calls.append((refs, sid, ver, decision)) or ["mal"])
        assert calls == [(["feedback:2026-09-30-a"], "research", "1.3.0", "")] and "history 1.3.0: mal" in found


def test_cli_feedback_add_and_list(kb):  # noqa: F811
    save(kb)
    cli = [sys.executable, "-B", "-m", "galecore_ai.adapters.cli"]
    request = json.dumps({"words": WORDS, "host_provider": "claude-code", "host_model": "test"})
    added = subprocess.run([*cli, "feedback", "add", "--research", RESEARCH, "--revision", "1",
                            "--classification", "method", "--slug", "macro", "--prompt", "tomalo"],
                           input=request, capture_output=True, text=True, encoding="utf-8", check=False)
    assert added.returncode == 0, added.stdout
    ref = json.loads(added.stdout)["ref"]
    listed = subprocess.run([*cli, "feedback", "list", "--status", "pending"], capture_output=True, text=True,
                            encoding="utf-8", check=False)
    assert [i["ref"] for i in json.loads(listed.stdout)["feedback"]] == [ref]
    refused = subprocess.run([*cli, "feedback", "add", "--research", RESEARCH, "--revision", "5",
                              "--classification", "case", "--slug", "otro", "--prompt", "p"],
                             input=request, capture_output=True, text=True, encoding="utf-8", check=False)
    assert refused.returncode == 3 and "no revision 5" in refused.stdout


class TestReviewR1:
    """Internal review R1 of GC-AI-0016."""

    def test_only_a_later_version_can_apply_a_method_comment(self, kb, monkeypatch):  # noqa: F811
        doc, _ = save(kb)
        fb, _ = comment(kb, kind=FeedbackKind.METHOD)
        skill = doc.current.skill
        older = "0.0.1"
        assert "only a later version" in check_feedback_citations(
            kb, [fb.ref], kind=FeedbackKind.METHOD, skill_id=skill.asset_id, applied_version=older)[0]
        history = SkillHistory(skill_id=skill.asset_id, versions=[
            {"version": older, "date": date(2026, 9, 30), "changes": "x", "feedback": [fb.ref]}])
        real = knowledge.load_skill_history
        monkeypatch.setattr(knowledge, "load_skill_history",
                            lambda path: history if path == "skills/research/SKILL.md" else real(path))
        item = feedback_status(kb)["feedback"][0]
        assert item["status"] == "pending" and item["cited_elsewhere"][0]["version"] == older

    def test_a_broken_history_is_reported_not_hidden(self, kb, monkeypatch):  # noqa: F811
        def broken(path):
            raise SkillHistoryError(f"{path}: roto")
        monkeypatch.setattr(knowledge, "load_skill_history", broken)
        failed = feedback_status(kb)["integrity_failed"]
        assert failed and all(f["status"] == "UNUSABLE" for f in failed)

    def test_a_preference_already_in_force_still_gets_a_version_citing_it(self, kb):  # noqa: F811
        save(kb)
        fb, _ = comment(kb, kind=FeedbackKind.PREFERENCE)
        set_profile(kb.profile, changes={"delivery_format": ["tablas"]}, note="n", prompt="p", host=HOST, now=NOW)
        pv, path = set_profile(kb.profile, changes={"delivery_format": ["tablas"]}, note="aplica", prompt="p",
                               host=HOST, now=NOW + timedelta(hours=3), feedback=[fb.ref])
        assert path is not None and pv.version == 2 and pv.feedback == [fb.ref]
        assert feedback_status(kb)["feedback"][0]["status"] == "applied"


def test_a_profile_version_without_feedback_is_written_without_the_field(kb):  # noqa: F811
    # Found 30/09: main (before GC-AI-0016) forbids the field and could not read a version written with "feedback": [].
    _, path = set_profile(kb.profile, changes={"delivery_format": ["tablas"]}, note="n", prompt="p", host=HOST, now=NOW)
    assert "feedback" not in json.loads(path.read_text(encoding="utf-8"))
    assert kb.profile.load("v1").feedback == []
