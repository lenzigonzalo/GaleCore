"""GC-AI-0015: the capability template's validation rejects incomplete capabilities."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from galecore_ai.adapters.cli import build_parser
from galecore_ai.adapters.knowledge_base import _workspace_root
from galecore_ai.adapters.source_registry_store import load_source_registry
from galecore_ai.adapters.source_status_store import FileSourceStatusStore
from galecore_ai.application.catalog_check import check_catalog, cli_commands
from galecore_ai.harness.catalog import Catalog, CatalogEntry, load_catalog

WORKSPACE = Path(__file__).resolve().parents[2]  # the checkout root; only used for `python <script>` lines


def entry(**overrides) -> CatalogEntry:
    data = {
        "id": "research", "kind": "investigation", "serves": "Investigar una idea.",
        "skill": "skills/research/skill.yaml", "output_contract": "galecore_ai.contracts.research.ResearchContent",
        "data_needs": [{"need": "curva de tasas"}],
        "flow": ["kb search --text x", "research save --slug s --prompt p"],
        "stored_as": "research", "controls": ["Not checked - whether the reasoning is right"],
    }
    data.update(overrides)
    return CatalogEntry.model_validate(data)


def run(*entries: CatalogEntry, tmp_path) -> dict:
    return check_catalog(Catalog(catalog_version="1", entries=list(entries)),
                         commands=cli_commands(build_parser()), workspace=WORKSPACE,
                         registry=load_source_registry(), status_store=FileSourceStatusStore(tmp_path / "sources"))


def problems(result: dict) -> list[str]:
    return result["entries"][0]["problems"]


def test_the_real_catalog_is_complete(tmp_path):
    # Cited feedback lives in the knowledge base (absent in CI); its resolution is tested in test_feedback.py.
    result = check_catalog(load_catalog(), commands=cli_commands(build_parser()), workspace=_workspace_root(WORKSPACE),
                           registry=load_source_registry(), status_store=FileSourceStatusStore(tmp_path / "s"),
                           feedback_check=lambda refs, skill_id, version: [])
    assert result["complete"], [e for e in result["entries"] if not e["complete"]]


def test_a_complete_entry_passes(tmp_path):
    assert run(entry(), tmp_path=tmp_path)["complete"]


def test_data_needs_must_be_declared():
    data = entry().model_dump()
    del data["data_needs"]
    with pytest.raises(ValidationError, match="data_needs"):
        CatalogEntry.model_validate(data)


@pytest.mark.parametrize("overrides, expected", [
    ({"flow": ["nonexistent run"]}, "'nonexistent' is not a command of this CLI"),
    ({"flow": ["research publish --id x"]}, "'research publish' is not a command of this CLI"),
    ({"flow": ["python tools/no_such_script.py"]}, "script not found"),
    ({"data_needs": [{"need": "precio del cafe colombiano"}]}, "no source in the registry covers it"),
    ({"data_needs": [{"need": "curva de tasas", "missing": "sin fuente"}]}, "declared missing but the registry covers it"),
    ({"controls": ["Numbers match the facts"]}, "none says what is NOT checked"),
    ({"skill": "skills/nope/skill.yaml"}, "skill or contract"),
    ({"flow": []}, "flow: empty"),
    ({"flow": ["python ENGINEERING.md"]}, "script not found"),
    ({"controls": ["Not checked"]}, "none says what is NOT checked"),
    ({"controls": ["Not checked -  "]}, "none says what is NOT checked"),
])
def test_an_incomplete_entry_is_rejected_with_the_reason(tmp_path, overrides, expected):
    result = run(entry(**overrides), tmp_path=tmp_path)
    assert not result["complete"]
    assert any(expected in p for p in problems(result)), problems(result)


def test_a_need_without_source_passes_when_its_absence_is_declared(tmp_path):
    ok = entry(data_needs=[{"need": "griegas de posiciones SHADOW", "missing": "ninguna fuente registrada las sirve"}])
    assert run(ok, tmp_path=tmp_path)["complete"]


def test_cli_commands_know_nested_subcommands():
    commands = cli_commands(build_parser())
    assert "save" in commands["research"] and "check" in commands["sources"]
    assert commands["catalog"] == set()


def test_a_blank_missing_reason_is_refused():
    with pytest.raises(ValidationError, match="must not be blank"):
        entry(data_needs=[{"need": "griegas de posiciones SHADOW", "missing": "  "}])


# ── GC-AI-0017: schedulable capabilities ─────────────────────────


def scheduled(**overrides) -> CatalogEntry:
    base = {"id": "daily_attention", "skill": "skills/daily-attention/skill.yaml", "data_needs": [],
            "flow": ["profile show", "kb search --kind strategy", "followup run --strategy x --prompt p",
                     "python GaleCore-AI/tools/fed_calendar.py <dir>", "evidence add --slug s --prompt p",
                     "research save --capability daily_attention --slug s --prompt p"],
            "schedulable": {"runs": "model", "max_turns": 30}}
    base.update(overrides)
    return entry(**base)


def schedule_problems(e: CatalogEntry, tmp_path) -> list[str]:
    return [p for p in problems(run(e, tmp_path=tmp_path)) if p.startswith("schedulable")]


def test_a_read_only_schedulable_entry_passes(tmp_path):
    assert schedule_problems(scheduled(), tmp_path) == []


@pytest.mark.parametrize("line", [
    "strategy save --spec f --prompt p", "strategy approve --ref r --spec-hash h --owner-words w --host-model m",
    "profile set --note n --prompt p --host-model m", "sources declare --source fred --state down --note n",
    "sources check", "feedback add --research r --revision 1 --classification case --slug s --prompt p",
    "task pause x --prompt p", "accept --record --prompt p",
    "python GaleCore/dev/galecore_dev.py deploy --spec x --approval a",
])
def test_a_schedulable_entry_that_writes_elsewhere_is_refused(tmp_path, line):
    e = scheduled(flow=[*scheduled().flow, line])
    assert schedule_problems(e, tmp_path), line


def test_a_scheduled_research_save_must_be_its_own(tmp_path):
    e = scheduled(flow=["research save --slug s --prompt p"])
    assert any("--capability daily_attention" in p for p in schedule_problems(e, tmp_path))


def test_schedulable_shape():
    with pytest.raises(ValidationError, match="max_turns"):
        scheduled(schedulable={"runs": "model"})
    with pytest.raises(ValidationError, match="runs is one of"):
        scheduled(schedulable={"runs": "cron"})
    with pytest.raises(ValidationError, match="no max_turns"):
        scheduled(schedulable={"runs": "code", "max_turns": 3})


def test_code_runs_exist_only_for_the_followup(tmp_path):
    assert any("no code runner" in p for p in schedule_problems(scheduled(schedulable={"runs": "code"}), tmp_path))
    assert any("stored_as must be research" in p
               for p in schedule_problems(scheduled(stored_as="none"), tmp_path))


def test_the_real_catalog_declares_the_briefing_and_the_followup_schedulable():
    declared = {e.id: e.schedulable.runs for e in load_catalog().entries if e.schedulable}
    assert declared == {"strategy_followup": "code", "daily_attention": "model", "market_watch": "model"}



def test_the_own_capability_is_an_exact_argument(tmp_path):
    e = scheduled(flow=["research save --capability daily_attention_evil --slug s --prompt p"])
    assert any("--capability daily_attention" in p for p in schedule_problems(e, tmp_path))
