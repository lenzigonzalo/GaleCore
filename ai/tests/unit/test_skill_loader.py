"""Unit tests for SkillLoader."""

import json
import tempfile
from pathlib import Path

from galecore_ai.harness.definitions import SkillDefinition
from galecore_ai.harness.skill_loader import SkillLoader


class TestSkillLoader:
    def test_register_and_get(self):
        loader = SkillLoader()
        skill = SkillDefinition(
            skill_id="test", version="1.0", display_name="Test",
            output_contract="test.Output",
        )
        loader.register(skill)
        assert loader.get("test") is skill
        assert loader.get("nonexistent") is None

    def test_load_from_dict(self):
        loader = SkillLoader()
        skill = loader.load_from_dict({
            "skill_id": "from_dict",
            "version": "1.0",
            "display_name": "From Dict",
            "output_contract": "test.Output",
        })
        assert skill.skill_id == "from_dict"
        assert loader.get("from_dict") is skill

    def test_load_from_json_file(self):
        loader = SkillLoader()
        data = {
            "skill_id": "from_file",
            "version": "1.0",
            "display_name": "From File",
            "output_contract": "test.Output",
            "system_prompt": "You are a test.",
        }
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False, encoding="utf-8") as f:
            json.dump(data, f)
            f.flush()
            path = Path(f.name)

        skill = loader.load_from_file(path)
        assert skill.skill_id == "from_file"
        assert skill.system_prompt == "You are a test."
        path.unlink()

    def test_load_directory(self):
        loader = SkillLoader()
        with tempfile.TemporaryDirectory() as tmpdir:
            d = Path(tmpdir)
            for i in range(3):
                data = {
                    "skill_id": f"skill_{i}",
                    "version": "1.0",
                    "display_name": f"Skill {i}",
                    "output_contract": "test.Output",
                }
                (d / f"skill_{i}.json").write_text(json.dumps(data), encoding="utf-8")

            loaded = loader.load_directory(d)
            assert len(loaded) == 3
            assert len(loader.skills) == 3

    def test_load_nonexistent_directory(self):
        loader = SkillLoader()
        loaded = loader.load_directory(Path("/nonexistent/path"))
        assert loaded == []

    def test_clear(self):
        loader = SkillLoader()
        loader.load_from_dict({
            "skill_id": "x", "version": "1.0", "display_name": "X",
            "output_contract": "test.Out",
        })
        assert len(loader.skills) == 1
        loader.clear()
        assert len(loader.skills) == 0

    def test_overwrite_warning(self):
        loader = SkillLoader()
        loader.load_from_dict({
            "skill_id": "dup", "version": "1.0", "display_name": "V1",
            "output_contract": "test.Out",
        })
        loader.load_from_dict({
            "skill_id": "dup", "version": "2.0", "display_name": "V2",
            "output_contract": "test.Out",
        })
        assert loader.get("dup").version == "2.0"
