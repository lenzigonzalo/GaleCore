"""WS-0099: skills with code kept in the space (save, pull, run, context). No network, no real knowledge/cache."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from galecore_ai.application import skill_run, skill_space, space
from galecore_ai.application.skill_run import SkillRunError


class FakeClient:
    user = "demo"

    def __init__(self):
        self.own: dict[str, dict] = {}
        self.shared: dict[str, dict] = {}
        self.puts: list[dict] = []

    def put(self, kind, key, *, title, content, fmt="markdown", visibility="private"):
        row = {"kind": kind, "key": key, "title": title, "content": content, "format": fmt,
               "visibility": visibility, "owner": "demo"}
        self.own[key] = row
        self.puts.append(row)
        return {"kind": kind, "key": key, "version": 1}

    def items(self, kind=None):
        return {"items": list(self.own.values()), "shared": list(self.shared.values())}


SKILL_MD = "---\nname: Mi Calculo\ndescription: Calcula algo útil\n---\n# Mi cálculo\n"
SCRIPT = 'import json\nprint(json.dumps({"x": 1}))\n'


@pytest.fixture
def folder(tmp_path):
    d = tmp_path / "src-skill"
    (d / "scripts").mkdir(parents=True)
    (d / "references").mkdir()
    (d / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")
    (d / "scripts" / "calc.py").write_text(SCRIPT, encoding="utf-8")
    (d / "references" / "nota.md").write_text("nota", encoding="utf-8")
    return d


@pytest.fixture(autouse=True)
def cache(tmp_path, monkeypatch):
    monkeypatch.setenv(skill_space.CACHE_ENV, str(tmp_path / "cache"))
    monkeypatch.delenv("GALECORE_API_KEY", raising=False)


def saved(client, folder, key="mi-calculo", **kw):
    skill_space.save(client, folder, key=key, **kw)
    return client


def test_save_uploads_a_private_skill_folder(folder):
    client = FakeClient()
    out = skill_space.save(client, folder)
    assert out["key"] == "mi-calculo" and out["visibility"] == "private"
    assert out["files"] == ["SKILL.md", "references/nota.md", "scripts/calc.py"]
    row = client.puts[0]
    data = json.loads(row["content"])
    assert row["format"] == "json" and data["format"] == "skill-folder/1" and data["name"] == "Mi Calculo"
    assert data["version"] == out["version"] == skill_space.version_of(data["files"])
    again = skill_space.save(FakeClient(), folder, key="otra", shared=True)
    assert again["version"] == out["version"] and again["visibility"] == "shared" and again["key"] == "otra"


@pytest.mark.parametrize("rel", ["notas.txt", "scripts/sub/a.py", "scripts/run.sh", "otra/a.md"])
def test_save_refuses_other_paths(folder, rel):
    target = folder / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("x", encoding="utf-8")
    client = FakeClient()
    with pytest.raises(SkillRunError, match="ruta no permitida"):
        skill_space.save(client, folder)
    assert client.puts == []


def test_save_refuses_binary_oversize_and_missing_frontmatter(folder):
    (folder / "assets").mkdir()
    (folder / "assets" / "x.bin").write_bytes(b"\xff\xfe\x00\x01")
    with pytest.raises(SkillRunError, match="binario"):
        skill_space.save(FakeClient(), folder)
    (folder / "assets" / "x.bin").unlink()
    (folder / "references" / "grande.md").write_text("a" * 191_000, encoding="utf-8")
    with pytest.raises(SkillRunError, match="máximo"):
        skill_space.save(FakeClient(), folder)
    (folder / "references" / "grande.md").unlink()
    (folder / "SKILL.md").write_text("sin frontmatter", encoding="utf-8")
    with pytest.raises(SkillRunError, match="frontmatter"):
        skill_space.save(FakeClient(), folder)


@pytest.mark.parametrize("text", [
    'k = "sk-abcdefghijklmnopqrstuv"', 'h = "Bearer abcdefghijklmnop1234"', 'api_key = "abcdefgh12345"',
    "x = 'gca_abc123def'"])
def test_save_refuses_things_that_look_like_keys(folder, text):
    (folder / "scripts" / "calc.py").write_text(SCRIPT + text + "\n", encoding="utf-8")
    client = FakeClient()
    with pytest.raises(SkillRunError, match="clave"):
        skill_space.save(client, folder)
    assert client.puts == []


def test_save_refuses_the_current_api_key_and_allows_reading_the_environment(folder, monkeypatch):
    monkeypatch.setenv("GALECORE_API_KEY", "valor-secreto-123")
    (folder / "references" / "nota.md").write_text("la clave es valor-secreto-123", encoding="utf-8")
    with pytest.raises(SkillRunError, match="clave"):
        skill_space.save(FakeClient(), folder)
    (folder / "references" / "nota.md").write_text("nota", encoding="utf-8")
    (folder / "scripts" / "calc.py").write_text(
        SCRIPT + 'import os\napi_key = os.environ.get("GALECORE_API_KEY")\n', encoding="utf-8")
    assert skill_space.save(FakeClient(), folder)["status"] == "SAVED"


def test_a_failing_test_does_not_upload(folder):
    (folder / "scripts" / "mala.py").write_text("import sys\nsys.exit(3)\n", encoding="utf-8")
    (folder / "scripts" / "texto.py").write_text('print("no es json")\n', encoding="utf-8")
    client = FakeClient()
    for spec in ("mala.py", "texto.py"):
        with pytest.raises(SkillRunError, match="no se sube"):
            skill_space.save(client, folder, test=spec)
    assert client.puts == []
    ok = skill_space.save(client, folder, test="calc.py --a 1")
    assert ok["tested"] and len(client.puts) == 1


def test_run_from_the_space_caches_by_version_and_own_wins(folder, tmp_path):
    client = saved(FakeClient(), folder)
    other = tmp_path / "other"
    (other / "scripts").mkdir(parents=True)
    (other / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")
    (other / "scripts" / "calc.py").write_text('import json\nprint(json.dumps({"x": 2}))\n', encoding="utf-8")
    shared_client = saved(FakeClient(), other, shared=True)
    client.shared["mi-calculo"] = {**shared_client.own["mi-calculo"], "owner": "otro", "visibility": "shared"}
    path, version = skill_space.materialize(client, "mi-calculo")
    result = skill_run.run_script(path, "calc.py", [])
    assert result["result"] == {"x": 1}                      # the own one wins
    assert path == tmp_path / "cache" / "mi-calculo" / version
    marker = path / "scripts" / "calc.py"
    marker.write_text(marker.read_text(encoding="utf-8") + "# tocado\n", encoding="utf-8")
    again, v2 = skill_space.materialize(client, "mi-calculo")
    assert again == path and v2 == version and "# tocado" in marker.read_text(encoding="utf-8")   # reused
    del client.own["mi-calculo"]
    path2, _ = skill_space.materialize(client, "mi-calculo")   # only the shared one is left
    assert skill_run.run_script(path2, "calc.py", [])["result"] == {"x": 2}
    assert path2 != path


def test_a_markdown_space_skill_has_no_scripts_and_a_missing_one_says_so():
    client = FakeClient()
    client.own["vieja"] = {"kind": "skill", "key": "vieja", "title": "V", "content": "texto", "format": "markdown",
                           "visibility": "private"}
    with pytest.raises(SkillRunError, match="esa skill no tiene scripts"):
        skill_space.materialize(client, "vieja")
    with pytest.raises(SkillRunError, match="No skill"):
        skill_space.materialize(client, "nada")


def test_the_run_record_tells_source_and_version(tmp_path):
    base = tmp_path / "kb"
    row = skill_run.record_run(base, {"skill": "mi", "script": "a.py", "ok": True, "source": "space",
                                      "version": "abc123"}, [], by="chat")
    assert row["source"] == "space" and row["version"] == "abc123"
    line = json.loads((base / "skill_runs.jsonl").read_text(encoding="utf-8"))
    assert line["source"] == "space" and line["version"] == "abc123"


def test_the_catalog_still_goes_first():
    from galecore_ai.harness.catalog import load_catalog
    entry = load_catalog().entries[0]
    name = Path(entry.skill).parent.name
    found = skill_run.find_skill_dir(name)
    assert found is not None and (found / "SKILL.md").is_file()
    assert skill_run.find_skill_dir("no-existe-en-el-catalogo") is None


def test_pull_reproduces_the_files(folder, tmp_path):
    client = saved(FakeClient(), folder)
    out = skill_space.pull(client, "mi-calculo", tmp_path / "bajada")
    assert out["files"] == ["SKILL.md", "references/nota.md", "scripts/calc.py"]
    for rel in out["files"]:
        assert (tmp_path / "bajada" / rel).read_text(encoding="utf-8") == (folder / rel).read_text(encoding="utf-8")
    assert skill_space.save(FakeClient(), tmp_path / "bajada")["version"] == out["version"]


def test_the_context_names_skills_with_code_by_description(folder):
    client = saved(FakeClient(), folder)
    client.own["md"] = {"kind": "skill", "key": "md", "title": "Vieja", "content": "Primera línea.\nOtra",
                        "format": "markdown", "visibility": "private"}
    client.shared["ajena"] = {**client.own["mi-calculo"], "key": "ajena", "owner": "otro", "visibility": "shared"}
    text = space.context(client)
    assert "skill propia «Mi Calculo» (con scripts: `skill run mi-calculo <calc.py>`): Calcula algo útil" in text
    assert "skill compartida de otro «Mi Calculo» (con scripts: `skill run ajena <calc.py>`)" in text
    assert "skill propia «Vieja» (`space show skill/md`): Primera línea." in text
    assert "skill-folder" not in text and '"files"' not in text


def test_data_helper_is_importable_from_a_script_subprocess(folder, monkeypatch):
    src = Path(__file__).resolve().parents[2] / "src"
    monkeypatch.setenv("PYTHONPATH", str(src))
    (folder / "scripts" / "d.py").write_text(
        'import json\nfrom galecore_ai import data\nprint(json.dumps({"has_get": callable(data.get), '
        '"caps": len(data.list()) > 0}))\n', encoding="utf-8")
    result = skill_run.run_script(folder, "d.py", [])
    assert result["ok"] and result["result"] == {"has_get": True, "caps": True}


def test_the_cli_runs_a_space_skill_and_records_it(folder, tmp_path, monkeypatch, capsys):
    import argparse

    from galecore_ai.adapters import cli, galecore_space
    client = saved(FakeClient(), folder)
    monkeypatch.setattr(galecore_space, "SpaceClient", lambda: client)
    monkeypatch.setattr(cli, "knowledge_dir", lambda: tmp_path / "kb")
    args = argparse.Namespace(skill_command="run", skill="mi-calculo", script="calc.py", script_args=[], timeout=30)
    with pytest.raises(SystemExit) as stop:
        cli._cmd_skill(args)
    out = json.loads(capsys.readouterr().out)
    assert stop.value.code == 0 and out["result"] == {"x": 1} and out["source"] == "space" and out["skill"] == "mi-calculo"
    row = json.loads((tmp_path / "kb" / "skill_runs.jsonl").read_text(encoding="utf-8"))
    assert row["source"] == "space" and row["version"] == out["version"] and row["skill"] == "mi-calculo"
