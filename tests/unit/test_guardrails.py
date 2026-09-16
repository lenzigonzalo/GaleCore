"""Unit tests for guardrails."""

import json

import pytest

from galecore_ai.harness.guardrails import GuardrailRunner, check_all_passed


class TestGuardrailRunner:
    def test_no_invented_numbers_passes(self):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["no_invented_numbers"],
            raw_text="Net GEX is 1500000 with spot at 450.5",
            facts={"net_gex": 1500000, "spot": 450.5},
        )
        assert len(results) == 1
        assert results[0].passed
        assert check_all_passed(results)

    def test_no_invented_numbers_fails(self):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["no_invented_numbers"],
            raw_text="Net GEX is 1500000, target price 475.0",
            facts={"net_gex": 1500000, "spot": 450.5},
        )
        assert len(results) == 1
        assert not results[0].passed
        assert not check_all_passed(results)

    def test_facts_match_source_passes(self):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["facts_match_source"],
            raw_text=json.dumps({"evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}]}),
            facts={"net_gex": 1500000},
        )
        assert results[0].passed

    def test_facts_match_source_fails(self):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["facts_match_source"],
            raw_text="The market looks bullish today",
            facts={"net_gex": 1500000},
        )
        assert not results[0].passed

    def test_facts_match_source_no_facts(self):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["facts_match_source"],
            raw_text="anything",
            facts={},
        )
        assert not results[0].passed  # absent facts cannot support acceptance

    def test_unknown_guardrail_fails_closed(self):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["nonexistent_guardrail"],
            raw_text="test",
            facts={},
        )
        assert len(results) == 1
        assert not results[0].passed  # fail-closed: unregistered = failure
        assert "not registered" in results[0].message

    def test_multiple_guardrails(self):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["no_invented_numbers", "facts_match_source"],
            raw_text=json.dumps({"evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is 1500000"}]}),
            facts={"net_gex": 1500000},
        )
        assert len(results) == 2
        assert check_all_passed(results)

    def test_nested_facts_extraction(self):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["no_invented_numbers"],
            raw_text="Call GEX is 2000000 and put GEX is 500000",
            facts={"gex": {"call_gex": 2000000, "put_gex": 500000}},
        )
        assert check_all_passed(results)


@pytest.mark.parametrize("evidence", [
    [{"fact_path": "facts.net_gex", "claim": "Positive"},
     {"fact_path": "facts.missing", "claim": "Unsupported"}],
    [{"fact_path": "facts.missing", "claim": "spot is 450.5"}],
    [{"fact_path": "facts.spot", "claim": "Spot is 1500"}],
    [{"fact_path": "facts.wall", "claim": "Wall exists"}],
    [{"fact_path": "facts.spot", "claim": ""}],
    [],
])
def test_invalid_evidence_never_rescued_by_text(evidence):
    results = GuardrailRunner().run_all(
        guardrail_ids=["facts_match_source"],
        raw_text=json.dumps({"observations": ["spot 450.5 net_gex 1500"], "evidence": evidence}),
        facts={"net_gex": 1500.0, "spot": 450.5, "wall": None},
    )
    assert not check_all_passed(results)


def test_nested_path_must_resolve_without_leaf_alias():
    results = GuardrailRunner().run_all(
        guardrail_ids=["facts_match_source"],
        raw_text=json.dumps({"evidence": [{"fact_path": "facts.spot", "claim": "Spot exists"}]}),
        facts={"other": {"spot": 450.5}},
    )
    assert not check_all_passed(results)
