"""Unit tests for the GEX interpretation skill definition."""

from galecore_ai.skills.gex_analysis.skill import build_gex_interpretation_skill


class TestGexInterpretationSkill:
    def test_skill_id(self):
        skill = build_gex_interpretation_skill()
        assert skill.skill_id == "gex_interpretation"

    def test_requires_gex_analysis(self):
        skill = build_gex_interpretation_skill()
        assert "compute.gex_analysis" in skill.required_capabilities

    def test_output_contract(self):
        skill = build_gex_interpretation_skill()
        assert "GexInterpretation" in skill.output_contract

    def test_has_system_prompt(self):
        skill = build_gex_interpretation_skill()
        assert "NUNCA inventar" in skill.system_prompt
        assert "positive_gamma" in skill.system_prompt

    def test_has_examples(self):
        skill = build_gex_interpretation_skill()
        assert len(skill.examples) >= 1
        ex = skill.examples[0]
        assert "regime" in ex.expected_output
        assert ex.expected_output["regime"] == "positive_gamma"
