"""Skill folders (WS-0073): loader, `skill run` and the catalog check."""

import json
import os
import shutil
from pathlib import Path

import pytest

from galecore_ai.application.skill_run import SkillRunError, run_script, script_path, skill_dir
from galecore_ai.harness import assets
from galecore_ai.harness.assets import definition_hash, load_asset, skill_files, skill_md
from galecore_ai.harness.definitions import SkillDefinition

DEMO = Path(__file__).resolve().parents[1] / "fixtures" / "skills" / "demo-folder"


def test_a_skill_with_folders_lists_its_files_and_tells_the_model(monkeypatch):
    monkeypatch.setattr(assets, "asset_root", lambda: DEMO.parent)
    skill = load_asset("demo-folder/SKILL.md", SkillDefinition)
    assert skill.files["references"] == ["references/reglas.md"]
    assert "scripts/calc.py" in skill.files["scripts"] and skill.files["assets"] == ["assets/plantilla.md"]
    assert "skill run" in skill.system_prompt and "`calc.py`" in skill.system_prompt
    assert skill.allowed_tools == ["Read", "Bash"] and skill.model == "sonnet"
    assert skill.answer == "Tabla."


def test_a_single_file_skill_loads_as_before():
    text = (DEMO / "SKILL.md").read_text(encoding="utf-8")
    plain = SkillDefinition.model_validate(skill_md(text))
    assert plain.files == {} and "Archivos de la skill" not in plain.system_prompt
    base = {"skill_id": "x", "version": "1.0.0", "display_name": "x", "output_contract": "a.B"}
    with_defaults = SkillDefinition.model_validate(base).model_dump(mode="json")
    assert definition_hash(SkillDefinition.model_validate(base)) == definition_hash(
        SkillDefinition.model_validate({**base, "files": {}, "allowed_tools": [], "model": None}))
    assert {"files", "allowed_tools", "model"} <= set(with_defaults)  # still fields; absent from the hash


def test_skill_files_only_lists_folders_that_exist(tmp_path):
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "a.py").write_text("", encoding="utf-8")
    assert skill_files(tmp_path) == {"scripts": ["scripts/a.py"]}


def test_a_script_runs_and_its_json_is_parsed():
    r = run_script(DEMO, "calc.py", ["2", "3"])
    assert r["ok"] and r["exit_code"] == 0 and r["result"]["suma"] == 5 and r["result"]["cwd"] == "demo-folder"
    assert r["skill"] == "demo-folder" and r["script"] == "calc.py" and r["duration_ms"] >= 0


def test_stdout_that_is_not_json_is_returned_as_text():
    r = run_script(DEMO, "texto.py", [])
    assert r["ok"] and "result" not in r and r["stdout"].startswith("hola")


def test_a_failing_script_reports_its_exit_code_and_stderr():
    r = run_script(DEMO, "falla.py", [])
    assert not r["ok"] and r["exit_code"] == 3 and "salió mal" in r["stderr"]


def test_a_script_over_the_time_cap_is_stopped():
    r = run_script(DEMO, "lento.py", [], timeout_s=0.5)
    assert not r["ok"] and r["exit_code"] is None and "timeout" in r["error"]


@pytest.mark.parametrize("script", ["../SKILL.md", "..", "scripts/calc.py", "/etc/passwd", "C:\\x.py",
                                    "nope.py", "", "calc.sh", "..\\calc.py"])
def test_scripts_outside_scripts_or_missing_are_refused(script):
    with pytest.raises(SkillRunError):
        script_path(DEMO, script)


def test_a_symlink_leaving_scripts_is_refused(tmp_path):
    folder = tmp_path / "skill"
    (folder / "scripts").mkdir(parents=True)
    outside = tmp_path / "fuera.py"
    outside.write_text("print(1)", encoding="utf-8")
    try:
        os.symlink(outside, folder / "scripts" / "link.py")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not available")
    with pytest.raises(SkillRunError):
        script_path(folder, "link.py")


def test_skill_dir_resolves_a_catalog_skill_by_id_or_name():
    by_id = skill_dir("capital_risk")
    assert by_id == skill_dir("capital-risk") and (by_id / "SKILL.md").is_file()
    with pytest.raises(SkillRunError):
        skill_dir("no-existe")


def test_the_real_skills_have_no_folder_problems():
    from galecore_ai.application.catalog_check import _folder_problems
    from galecore_ai.harness.catalog import load_catalog
    assert [p for e in load_catalog().entries for p in _folder_problems(e)] == []


def test_the_folder_check_flags_a_missing_reference_and_an_unsupported_script(tmp_path, monkeypatch):
    from galecore_ai.application import catalog_check
    from galecore_ai.harness.catalog import load_catalog
    folder = tmp_path / "skills" / "demo"
    shutil.copytree(DEMO, folder)
    (folder / "scripts" / "run.sh").write_text("echo", encoding="utf-8")
    (folder / "SKILL.md").write_text(
        (folder / "SKILL.md").read_text(encoding="utf-8") + "\nVer `references/falta.md`.\n", encoding="utf-8")
    monkeypatch.setattr(catalog_check, "asset_root", lambda: tmp_path)
    entry = load_catalog().entries[0].model_copy(update={"skill": "skills/demo/SKILL.md"})
    problems = catalog_check._folder_problems(entry)
    assert any("run.sh" in p for p in problems) and any("references/falta.md" in p for p in problems)
    assert not any("reglas.md" in p for p in problems)


def test_the_cli_runs_a_script_and_exits_nonzero_on_failure(monkeypatch, capsys, tmp_path):
    from galecore_ai.adapters import cli
    from galecore_ai.adapters.knowledge_base import KNOWLEDGE_DIR_ENV
    monkeypatch.setenv(KNOWLEDGE_DIR_ENV, str(tmp_path))   # the run record goes to a temp knowledge base, never the real one
    monkeypatch.setattr("galecore_ai.application.skill_run.skill_dir", lambda ref: DEMO)
    args = cli.build_parser().parse_args(["skill", "run", "--timeout", "30", "demo", "calc.py", "4", "5"])
    with pytest.raises(SystemExit) as ok:
        cli._cmd_skill(args)
    assert ok.value.code == 0 and json.loads(capsys.readouterr().out)["result"]["suma"] == 9
    bad = cli.build_parser().parse_args(["skill", "run", "demo", "../x.py"])
    with pytest.raises(SystemExit) as no:
        cli._cmd_skill(bad)
    assert no.value.code == 3 and json.loads(capsys.readouterr().out)["ok"] is False
