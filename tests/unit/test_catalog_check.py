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
    result = check_catalog(load_catalog(), commands=cli_commands(build_parser()), workspace=_workspace_root(WORKSPACE),
                           registry=load_source_registry(), status_store=FileSourceStatusStore(tmp_path / "s"))
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
])
def test_an_incomplete_entry_is_rejected_with_the_reason(tmp_path, overrides, expected):
    result = run(entry(**overrides), tmp_path=tmp_path)
    assert not result["complete"]
    assert any(expected in p for p in problems(result)), problems(result)


def test_a_need_without_source_passes_when_its_absence_is_declared(tmp_path):
    ok = entry(data_needs=[{"need": "fecha del FOMC", "missing": "economics-calendar de FMP denegado por plan"}])
    assert run(ok, tmp_path=tmp_path)["complete"]


def test_cli_commands_know_nested_subcommands():
    commands = cli_commands(build_parser())
    assert "save" in commands["research"] and "check" in commands["sources"]
    assert commands["catalog"] == set()
