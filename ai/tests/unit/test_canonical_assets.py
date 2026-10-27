"""Ensure edits to versioned assets reach their consumers and change trace identity."""

from galecore_ai.harness import assets
from galecore_ai.skills.gex_analysis.skill import build_gex_interpretation_skill


def test_factory_consumes_changed_asset_and_hash_tracks_content(tmp_path, monkeypatch):
    relative = "skills/gex-analysis/SKILL.md"
    original = (assets.asset_root() / relative).read_text(encoding="utf-8")
    target = tmp_path / relative
    target.parent.mkdir(parents=True)
    target.write_text(original, encoding="utf-8")
    monkeypatch.setattr(assets, "asset_root", lambda: tmp_path)
    before = build_gex_interpretation_skill()
    target.write_text(original.replace("Sos un analista de exposición gamma.", "Changed methodology."),
                      encoding="utf-8")
    after = build_gex_interpretation_skill()
    assert before.version == after.version
    assert "Changed methodology." in after.system_prompt
    assert assets.definition_hash(before) != assets.definition_hash(after)


def test_missing_canonical_asset_does_not_fall_back_to_python_copy(tmp_path, monkeypatch):
    import pytest

    monkeypatch.setattr(assets, "asset_root", lambda: tmp_path)
    with pytest.raises(FileNotFoundError):
        build_gex_interpretation_skill()
