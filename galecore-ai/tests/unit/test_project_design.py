"""The design reader verifies saved files without traversing the knowledge graph or APIs."""
import json

from galecore_ai.application import project
from tests.unit.test_knowledge import kb  # noqa: F401
from tests.unit.test_strategy import KEY, NAME, research_ref, stored  # noqa: F401


def test_design_is_full_local_content_without_research_scan(kb, research_ref, monkeypatch):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    def forbidden(*args, **kwargs):
        raise AssertionError("design must not scan research, feedback or followup")
    for name in ("_related_research", "_followup_view", "feedback_status", "resolve_ref"):
        monkeypatch.setattr(project, name, forbidden)
    view = project.strategy_design_view(kb, NAME)
    current = view["current"]
    assert current["ref"] == f"strategy:{KEY}"
    assert current["parameters"] == [p.model_dump(mode="json") for p in doc.content.parameters]
    assert current["management"] == [s.model_dump(mode="json") for s in doc.content.management]
    assert current["evaluation_plan"] == doc.content.evaluation_plan.model_dump(mode="json")
    assert current["critique"] and current["controls"]
    assert current["runtime_sources"] and all(s["source"] == "GaleCore" for s in current["runtime_sources"])
    assert "research" not in view and "last_followup" not in view
    assert view["integrity_failed"] == []


def test_design_empty_project_and_damaged_version_are_distinct(kb, research_ref):  # noqa: F811
    view = project.strategy_design_view(kb, NAME)
    assert view["current"] is None and view["integrity_failed"] == []
    stored(kb, research_ref)
    path = kb.strategies.path_for(KEY)
    data = json.loads(path.read_text(encoding="utf-8"))
    data["content"]["purpose"] = "edited without a new version"
    path.write_text(json.dumps(data), encoding="utf-8")
    view = project.strategy_design_view(kb, NAME)
    assert view["current"] is None and view["integrity_failed"]


def test_damaged_critique_or_project_log_is_declared(kb, research_ref):  # noqa: F811
    stored(kb, research_ref)
    path = kb.strategies.path_for(KEY, "critique")
    data = json.loads(path.read_text(encoding="utf-8"))
    data["content"]["alternative_explanation"] = "edited"
    path.write_text(json.dumps(data), encoding="utf-8")
    assert project.strategy_design_view(kb, NAME)["integrity_failed"]
