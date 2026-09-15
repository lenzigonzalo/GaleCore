"""Unit tests for guardrails."""

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
            raw_text="The net_gex value indicates positive gamma",
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
        assert results[0].passed  # nothing to check

    def test_unknown_guardrail_skipped(self):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["nonexistent_guardrail"],
            raw_text="test",
            facts={},
        )
        assert len(results) == 1
        assert results[0].passed  # skipped = pass

    def test_multiple_guardrails(self):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["no_invented_numbers", "facts_match_source"],
            raw_text="The net_gex is 1500000 indicating positive gamma",
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
