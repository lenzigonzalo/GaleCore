"""A research belongs to a Lab project when its slug ends in the project name (WS-0029 H8)."""

from galecore_ai.application.knowledge import _research_project


def test_research_slug_ending_in_project_name_is_that_projects():
    projects = ["reversion_gex_spy", "spy"]
    assert _research_project("research:2026-10-13-hipotesis-reversion-gex-spy", projects) == "reversion_gex_spy"
    assert _research_project("research:2026-10-13-reversion-gex-spy", projects) == "reversion_gex_spy"


def test_research_of_no_project_is_none():
    assert _research_project("research:2026-10-13-consulta-inicial", ["reversion_gex_spy"]) is None
