"""P1-08: the knowledge cycle — mark what no longer holds, and one case is not a rule."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import timedelta

import pytest

from galecore_ai.application.knowledge import (
    KnowledgeError,
    check_content,
    check_feedback_citations,
    feedback_status,
    save_mark,
    search,
    show,
)
from galecore_ai.contracts.feedback import FeedbackKind
from galecore_ai.contracts.mark import MarkKind
from tests.unit.test_feedback import comment
from tests.unit.test_knowledge import HOST, NOW, content, kb, save  # noqa: F401  (kb is a fixture)

BACKLOG = "file:notes/backlog.md"
RESEARCH = "research:2026-09-23-gex-0dte"
OTHER = "research:2026-09-23-otro"


def mark(kb, ref=BACKLOG, kind=MarkKind.RETIRED, *, by="", slug="ya-no-vale", reason="BL-011 se resolvió en P1-D1"):  # noqa: F811
    return save_mark(kb=kb, slug=slug, ref=ref, mark=kind, reason=reason, by=by, prompt="esto ya no vale",
                     host=HOST, now=NOW + timedelta(days=1))


class TestMark:
    def test_a_marked_item_is_kept_but_left_out_of_search_and_shown_with_its_mark(self, kb):  # noqa: F811
        save(kb)
        save(kb, slug="otro")
        doc, path = mark(kb, OTHER, MarkKind.SUPERSEDED, by=RESEARCH)
        assert path == kb.base / "marks" / "2026-09-24-ya-no-vale.json"
        assert doc.ref == OTHER and doc.by == RESEARCH and doc.ref_hash.startswith("sha256:")
        found = search(kb, kind="research")
        assert [r["ref"] for r in found["results"]] == [RESEARCH] and found["marked_left_out"] == 1
        everything = search(kb, kind="research", include_marked=True)
        flagged = next(r for r in everything["results"] if r["ref"] == OTHER)
        assert flagged["marked"]["mark"] == "superseded" and flagged["marked"]["by"] == RESEARCH
        shown = show(kb, OTHER)
        assert shown["marked"]["reason"] == "BL-011 se resolvió en P1-D1" and shown["current"]["revision"] == 1
        assert show(kb, RESEARCH)["marked"] is None

    def test_a_new_investigation_cannot_cite_a_marked_item(self, kb):  # noqa: F811
        save(kb)
        mark(kb)
        _, problems = check_content(content(), kb)
        assert any(f"{BACKLOG} is retired" in p and "BL-011 se resolvió" in p for p in problems)
        with pytest.raises(KnowledgeError, match="is retired"):
            save(kb, slug="nuevo")

    @pytest.mark.parametrize(("kind", "by", "expected"), [
        (MarkKind.SUPERSEDED, "", "must say what replaces it"),
        (MarkKind.CORRECTED, "", "must say what replaces it"),
        (MarkKind.RETIRED, RESEARCH, "has no replacement"),
        (MarkKind.SUPERSEDED, BACKLOG, "cannot replace itself"),
        (MarkKind.SUPERSEDED, "research:2026-01-01-no-existe", "no such investigation"),
    ])
    def test_replacement_rules(self, kb, kind, by, expected):  # noqa: F811
        save(kb)
        with pytest.raises(KnowledgeError, match=expected):
            mark(kb, BACKLOG, kind, by=by)
        assert not (kb.base / "marks").exists()

    def test_an_unknown_item_twice_marked_or_replaced_by_a_marked_one_is_refused(self, kb):  # noqa: F811
        save(kb)
        save(kb, slug="otro")
        with pytest.raises(KnowledgeError, match="no such investigation"):
            mark(kb, "research:2026-01-01-no-existe")
        mark(kb, OTHER)
        with pytest.raises(KnowledgeError, match="already marked"):
            mark(kb, OTHER, slug="de-nuevo")
        with pytest.raises(KnowledgeError, match="is retired"):
            mark(kb, RESEARCH, MarkKind.SUPERSEDED, by=OTHER, slug="por-otro")

    def test_an_edited_mark_is_reported_never_ignored(self, kb):  # noqa: F811
        save(kb)
        _, path = mark(kb)
        path.write_text(path.read_text(encoding="utf-8").replace("P1-D1", "P1-D2"), encoding="utf-8")
        assert search(kb)["integrity_failed"][0]["ref"] == "mark:2026-09-24-ya-no-vale"
        _, problems = check_content(content(), kb)
        assert any("marks: mark:2026-09-24-ya-no-vale is not usable" in p for p in problems)

    def test_a_marked_feedback_is_no_longer_pending(self, kb):  # noqa: F811
        save(kb)
        fb, _ = comment(kb)
        mark(kb, fb.ref)
        item = feedback_status(kb)["feedback"][0]
        assert item["status"] == "retired" and feedback_status(kb)["pending"] == 0

    def test_since_keeps_recent_items(self, kb):  # noqa: F811
        save(kb)
        assert [r["ref"] for r in search(kb, kind="research", since="2026-09-23")["results"]] == [RESEARCH]
        assert search(kb, kind="research", since="2026-09-24")["count"] == 0


class TestOneCaseIsNotARule:
    def test_one_result_needs_the_owners_decision(self, kb):  # noqa: F811
        doc, _ = save(kb)
        fb, _ = comment(kb)
        skill = doc.current.skill
        problems = check_feedback_citations(kb, [fb.ref], kind=FeedbackKind.METHOD, skill_id=skill.asset_id,
                                            applied_version="9.9.9")
        assert problems and "one case is not a rule" in problems[0]
        assert check_feedback_citations(kb, [fb.ref], kind=FeedbackKind.METHOD, skill_id=skill.asset_id,
                                        applied_version="9.9.9", owner_decision="sí, que lo haga siempre") == []

    def test_two_comments_on_the_same_result_are_still_one_case(self, kb):  # noqa: F811
        doc, _ = save(kb)
        a, _ = comment(kb, slug="a")
        b, _ = comment(kb, slug="b", words="otra vez lo mismo")
        problems = check_feedback_citations(kb, [a.ref, b.ref], kind=FeedbackKind.METHOD,
                                            skill_id=doc.current.skill.asset_id, applied_version="9.9.9")
        assert any("one case is not a rule" in p for p in problems)

    def test_repetition_on_different_results_is_enough_and_is_listed(self, kb):  # noqa: F811
        doc, _ = save(kb)
        save(kb, slug="otro")
        a, _ = comment(kb, slug="a")
        b, _ = comment(kb, slug="b", research=OTHER, words="de nuevo faltó la macro")
        assert check_feedback_citations(kb, [a.ref, b.ref], kind=FeedbackKind.METHOD,
                                        skill_id=doc.current.skill.asset_id, applied_version="9.9.9") == []
        items = {i["ref"]: i for i in feedback_status(kb)["feedback"]}
        assert items[a.ref]["same_skill_pending"] == [b.ref] and items[b.ref]["same_skill_pending"] == [a.ref]

    def test_preference_and_case_are_not_affected(self, kb):  # noqa: F811
        save(kb)
        fb, _ = comment(kb, kind=FeedbackKind.PREFERENCE)
        assert check_feedback_citations(kb, [fb.ref], kind=FeedbackKind.PREFERENCE) == []

    def test_the_catalog_history_in_force_passes(self):
        from galecore_ai.application.catalog_check import _history_problems
        from galecore_ai.harness.catalog import load_catalog
        entry = next(e for e in load_catalog().entries if e.id == "daily_attention")
        seen = []
        _history_problems(entry, {"skill_asset": {}}, lambda refs, sid, ver, decision: seen.append(decision) or [])
        assert seen and all(d.strip() for d in seen)  # every method change there carries the owner's decision


def test_cli_kb_mark_then_search_leaves_it_out(kb):  # noqa: F811
    save(kb)
    save(kb, slug="otro")
    cli = [sys.executable, "-B", "-m", "galecore_ai.adapters.cli"]
    marked = subprocess.run([*cli, "kb", "mark", OTHER, "--as", "superseded", "--by", RESEARCH,
                             "--reason", "la otra lo cubre", "--slug", "otro", "--prompt", "esto ya no vale"],
                            capture_output=True, text=True, encoding="utf-8", check=False)
    assert marked.returncode == 0, marked.stdout
    assert json.loads(marked.stdout)["status"] == "MARKED"
    found = subprocess.run([*cli, "kb", "search", "--kind", "research"], capture_output=True, text=True,
                           encoding="utf-8", check=False)
    result = json.loads(found.stdout)
    assert [r["ref"] for r in result["results"]] == [RESEARCH] and result["marked_left_out"] == 1
    refused = subprocess.run([*cli, "kb", "mark", OTHER, "--as", "retired", "--reason", "x", "--slug", "otra-vez",
                              "--prompt", "y"], capture_output=True, text=True, encoding="utf-8", check=False)
    assert refused.returncode == 3 and "already marked" in refused.stdout
