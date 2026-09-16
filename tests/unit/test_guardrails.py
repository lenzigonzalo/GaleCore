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


class TestNoTradingRecommendation:
    """Tests for the no_trading_recommendation guardrail.

    This is a pattern-based heuristic. It catches common explicit phrasings
    but not novel, indirect, or non-English recommendations. Those remain
    a known limitation requiring human review.
    """

    @pytest.mark.parametrize("text", [
        # English
        "Consider buying puts on SPY",
        "Sell shares of SPY at open",
        "Go long SPY",
        "Take a short position",
        "Open a trade at 450",
        "Recommend selling calls",
        "Exit position before expiry",
        "Stop-loss at 440",
        "Take profit at 460",
        "Price target of 480",
        "Risk/reward ratio of 3:1",
        # Spanish (F-02)
        "Comprar puts de SPY",
        "Vender acciones de SPY",
        "Ponerse largo en el mercado",
        "Abrir una posición larga",
        "Cerrar posición antes del vencimiento",
        "Stop-loss en 440",
        "Take-profit en 460",
        "Objetivo de precio alcista",
        "Considerar comprar calls",
        "Recomendamos vender opciones",
    ])
    def test_explicit_recommendation_rejected(self, text):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["no_trading_recommendation"],
            raw_text=text,
            facts={"net_gex": 1500},
        )
        assert not results[0].passed, f"Should have rejected: {text}"

    @pytest.mark.parametrize("text", [
        "Dealers are long gamma and will hedge by selling into rallies",
        "Mean-reverting price action is expected within the call wall / put wall range",
        "Net GEX is positive at 1500, indicating dampened volatility",
        "Spot is below the zero-gamma level",
        "Point-in-time snapshot based on current open interest",
        "Dealer hedging activity may amplify price moves",
    ])
    def test_analytical_observation_accepted(self, text):
        runner = GuardrailRunner()
        results = runner.run_all(
            guardrail_ids=["no_trading_recommendation"],
            raw_text=text,
            facts={"net_gex": 1500},
        )
        assert results[0].passed, f"Should have accepted: {text}"


class TestTradingRecInAcceptance:
    """Integration: trading rec in an otherwise valid interpretation → VALIDATION_ERROR."""

    def test_trading_recommendation_in_interpretation_rejected(self):
        from galecore_ai.application.validate_interpretation import validate_interpretation
        from galecore_ai.contracts.gex_analysis import GexInterpretation

        interp = {
            "regime": "positive_gamma",
            "observations": ["Net GEX is positive"],
            "implications": ["Consider buying calls on SPY for the upside"],
            "quantitative_claims": [{"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"}],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
            "limitations": ["Snapshot only"],
        }
        result = validate_interpretation(
            interpretation=interp,
            facts={"net_gex": 1500.0, "call_gex": 2000000.0, "put_gex": -500000.0, "spot": 450.5},
            output_schema=GexInterpretation,
            guardrail_ids=["no_invented_numbers", "facts_match_source"],
        )
        assert not result.accepted
        assert any("trading" in e.lower() or "Trading" in e for e in result.errors)


class TestMisattribution:
    """F-04: Evidence-cited numeric claims must match their specific fact path.

    facts_match_source validates per-path: if evidence says fact_path=facts.net_gex
    and the claim says 750, but net_gex=1500, the guardrail rejects.
    no_invented_numbers remains a global check (any number vs all facts).
    """

    def test_evidence_misattribution_rejected_by_facts_match(self):
        """'Net GEX is 750' with evidence citing facts.net_gex fails
        because facts_match_source checks the claim against net_gex specifically."""
        runner = GuardrailRunner()
        interp = json.dumps({
            "regime": "positive_gamma",
            "observations": ["Net GEX is 750.0"],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is 750.0"}],
            "limitations": ["Snapshot"],
        })
        results = runner.run_all(
            guardrail_ids=["facts_match_source"],
            raw_text=interp,
            facts={"net_gex": 1500.0, "spot": 450.5, "put_wall": 750.0},
        )
        assert not results[0].passed, "Misattributed claim should be rejected by facts_match_source"

    def test_correctly_attributed_evidence_accepted(self):
        """Both facts cited correctly in evidence → accepted."""
        runner = GuardrailRunner()
        interp = json.dumps({
            "regime": "positive_gamma",
            "observations": ["Put wall at 750.0, net GEX is 1500.0"],
            "evidence": [
                {"fact_path": "facts.net_gex", "claim": "Net GEX is 1500.0"},
                {"fact_path": "facts.put_wall", "claim": "Put wall at 750.0"},
            ],
            "limitations": ["Snapshot"],
        })
        results = runner.run_all(
            guardrail_ids=["facts_match_source"],
            raw_text=interp,
            facts={"net_gex": 1500.0, "spot": 450.5, "put_wall": 750.0},
        )
        assert results[0].passed

    def test_spot_misattributed_as_net_gex_rejected(self):
        """450.5 cited as facts.net_gex fails (450.5 is spot, net_gex is 1500)."""
        runner = GuardrailRunner()
        interp = json.dumps({
            "regime": "positive_gamma",
            "observations": ["Net GEX is 450.5"],
            "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is 450.5"}],
            "limitations": ["Snapshot"],
        })
        results = runner.run_all(
            guardrail_ids=["facts_match_source"],
            raw_text=interp,
            facts={"net_gex": 1500.0, "spot": 450.5},
        )
        assert not results[0].passed


def test_nested_path_must_resolve_without_leaf_alias():
    results = GuardrailRunner().run_all(
        guardrail_ids=["facts_match_source"],
        raw_text=json.dumps({"evidence": [{"fact_path": "facts.spot", "claim": "Spot exists"}]}),
        facts={"other": {"spot": 450.5}},
    )
    assert not check_all_passed(results)
