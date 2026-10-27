"""WS-0066: an investigation saved from a Lab project records that project in its header."""

from __future__ import annotations

from galecore_ai.adapters.cli import _current_project
from galecore_ai.application.knowledge import _research_project, revise_research, save_research
from galecore_ai.contracts.research import RevisionReason
from tests.unit import test_knowledge
from tests.unit.test_knowledge import HOST, NOW, content

kb = test_knowledge.kb   # the same fixture


def test_research_slug_ending_in_project_name_is_that_projects():
    projects = ["reversion_gex_spy", "spy"]
    assert _research_project("research:2026-10-13-hipotesis-reversion-gex-spy", projects) == "reversion_gex_spy"
    assert _research_project("research:2026-10-13-reversion-gex-spy", projects) == "reversion_gex_spy"


def test_research_of_no_project_is_none():
    assert _research_project("research:2026-10-13-consulta-inicial", ["reversion_gex_spy"]) is None


def _save(kb, project=None, slug="tema"):
    return save_research(kb=kb, slug=slug, prompt="p", host=HOST, content=content(), now=NOW, project=project)


def _revise(kb, doc, project=None):
    return revise_research(kb=kb, research_id=doc.id, reason=RevisionReason.CONTINUATION, note="n", prompt="p",
                           host=HOST, content=content(), project=project)


def test_save_from_a_project_annotates_it_and_reloads(kb):
    doc, path = _save(kb, "empresas")
    assert doc.project == "empresas"
    assert "project: empresas" in path.read_text(encoding="utf-8")
    assert kb.research.load(doc.id).project == "empresas"


def test_save_outside_a_project_writes_no_project(kb):
    doc, path = _save(kb)
    assert doc.project is None
    assert "project" not in path.read_text(encoding="utf-8").split("---")[1]


def test_a_revision_from_another_project_keeps_the_first(kb):
    doc, _ = _save(kb, "empresas")
    updated, _ = _revise(kb, doc, "portfolio")
    assert updated.project == "empresas"
    assert kb.research.load(doc.id).project == "empresas"


def test_a_revision_annotates_an_unannotated_investigation(kb):
    doc, _ = _save(kb)
    assert _revise(kb, doc, "portfolio")[0].project == "portfolio"


def test_current_project_reads_the_cwd(kb, monkeypatch):
    proj = kb.base / "workspaces" / "empresas"
    (proj / "memory").mkdir(parents=True)
    (proj / "workspace.json").write_text("{}", encoding="utf-8")
    monkeypatch.chdir(proj / "memory")
    assert _current_project() == "empresas"
    monkeypatch.chdir(kb.base)
    assert _current_project() is None
    (kb.base / "workspaces" / "otro").mkdir()
    monkeypatch.chdir(kb.base / "workspaces" / "otro")
    assert _current_project() is None   # sin workspace.json no es un proyecto
