"""Adversarial acceptance checks for RegimeInterpretation (GC-AI-0002 AC-02).

Every new metric has an exact-value and a unit case; every guardrail has an
EN and an ES adversarial case; the two structural checks (gamma sign, tail
pricing vs GaleCore's semaphore) are contradicted explicitly.
"""

from __future__ import annotations

import pytest

from galecore_ai.application.validate_interpretation import validate_interpretation
from galecore_ai.contracts.regime_analysis import REGIME_METRIC_REGISTRY, RegimeInterpretation
from tests.unit.regime_support import regime_facts, valid_regime_interpretation

FACTS = regime_facts()
GUARDRAILS = ["no_invented_numbers", "facts_match_source"]


def validate(interpretation: dict, facts: dict | None = None):
    return validate_interpretation(
        interpretation=interpretation, facts=facts or FACTS,
        output_schema=RegimeInterpretation, guardrail_ids=GUARDRAILS,
    )


def failed_ids(result) -> set[str]:
    return {c.guardrail_id for c in result.checks if not c.passed}


class TestAccepted:
    def test_valid_interpretation_accepted_and_echoed(self):
        result = validate(valid_regime_interpretation())
        assert result.accepted, result.errors
        assert result.result == valid_regime_interpretation()

    def test_every_check_runs_on_a_valid_payload(self):
        result = validate(valid_regime_interpretation())
        ids = {c.guardrail_id for c in result.checks}
        assert {"no_invented_numbers", "facts_match_source", "no_trading_recommendation",
                "no_numbers_in_prose", "gex_regime_sign", "tail_pricing_level",
                "quantitative_claims_valid"} <= ids

    @pytest.mark.parametrize("metric", [m.value for m in REGIME_METRIC_REGISTRY])
    def test_each_metric_accepts_exact_fact_with_its_unit(self, metric):
        spec = REGIME_METRIC_REGISTRY[metric]
        claim = {"metric": metric, "value": float(FACTS[metric]), "unit": spec.unit.value}
        result = validate(valid_regime_interpretation(quantitative_claims=[claim]))
        assert result.accepted, result.errors


class TestStructuralChecks:
    def test_gamma_sign_contradiction_rejected(self):
        result = validate(valid_regime_interpretation(gamma_regime="positive_gamma"))
        assert not result.accepted and "gex_regime_sign" in failed_ids(result)

    def test_near_zero_always_rejected(self):
        result = validate(valid_regime_interpretation(gamma_regime="near_zero"))
        assert not result.accepted and "gex_regime_sign" in failed_ids(result)

    def test_tail_pricing_contradicts_galecore_semaphore(self):
        result = validate(valid_regime_interpretation(tail_pricing="elevated"))
        assert not result.accepted and "tail_pricing_level" in failed_ids(result)

    def test_tail_pricing_follows_semaphore_when_elevated(self):
        facts = regime_facts(put_skew_level_ok=False)
        assert validate(valid_regime_interpretation(tail_pricing="elevated"), facts).accepted
        assert not validate(valid_regime_interpretation(tail_pricing="calm"), facts).accepted

    def test_missing_semaphore_fails_closed(self):
        facts = regime_facts()
        del facts["put_skew_level_ok"]
        result = validate(valid_regime_interpretation(), facts)
        assert not result.accepted and "tail_pricing_level" in failed_ids(result)

    def test_non_boolean_semaphore_fails_closed(self):
        result = validate(valid_regime_interpretation(), regime_facts(put_skew_level_ok="true"))
        assert not result.accepted and "tail_pricing_level" in failed_ids(result)


class TestQuantitativeClaims:
    @pytest.mark.parametrize("metric,value", [
        ("put_skew_ratio", 1.2), ("atm_iv", 14.35), ("put_wing_iv", 0.17), ("vix", 18.0), ("vvix", 95.0),
    ])
    def test_rounded_or_rescaled_value_rejected(self, metric, value):
        spec = REGIME_METRIC_REGISTRY[metric]
        claim = {"metric": metric, "value": value, "unit": spec.unit.value}
        result = validate(valid_regime_interpretation(quantitative_claims=[claim]))
        assert not result.accepted and "quantitative_claims_valid" in failed_ids(result)

    @pytest.mark.parametrize("metric,unit", [
        ("put_skew_ratio", "iv_decimal"), ("atm_iv", "ratio"), ("vix", "usd"), ("net_gex", "index_points"),
    ])
    def test_wrong_unit_rejected(self, metric, unit):
        claim = {"metric": metric, "value": float(FACTS[metric]), "unit": unit}
        result = validate(valid_regime_interpretation(quantitative_claims=[claim]))
        assert not result.accepted and "quantitative_claims_valid" in failed_ids(result)

    @pytest.mark.parametrize("metric", ["put_skew_25d", "call_gex", "put_skew_level_threshold", "put_skew_dte"])
    def test_metric_outside_registry_rejected_by_schema(self, metric):
        claim = {"metric": metric, "value": 1.0, "unit": "ratio"}
        result = validate(valid_regime_interpretation(quantitative_claims=[claim]))
        assert not result.accepted and not result.checks  # schema rejection, no guardrail ran

    def test_string_value_rejected_by_schema(self):
        claim = {"metric": "vix", "value": "17.71", "unit": "index_points"}
        assert not validate(valid_regime_interpretation(quantitative_claims=[claim])).accepted

    def test_absent_optional_fact_cannot_be_claimed(self):
        facts = regime_facts()
        del facts["zero_gamma_level"]
        claim = {"metric": "zero_gamma_level", "value": 745.0, "unit": "usd"}
        result = validate(valid_regime_interpretation(quantitative_claims=[claim]), facts)
        assert not result.accepted and "quantitative_claims_valid" in failed_ids(result)


class TestProseGuardrails:
    @pytest.mark.parametrize("field", ["observations", "implications"])
    @pytest.mark.parametrize("text", [
        "VIX is 17.71 and skew is 1.1951",
        "El VIX está en 17.71 y el skew en 1.1951",
        "The put wing trades at seventeen percent, about 3 points over ATM",
    ])
    def test_digits_in_prose_rejected(self, field, text):
        result = validate(valid_regime_interpretation(**{field: [text]}))
        assert not result.accepted and "no_numbers_in_prose" in failed_ids(result)

    @pytest.mark.parametrize("text", [
        "Buy SPY puts while the skew is calm",
        "Consider selling calls into the wall",
        "Comprá puts de SPY mientras el skew esté calmo",
        "Conviene vender opciones cerca del muro",
        "Tomá posición corta antes de la apertura",
    ])
    def test_trading_directive_rejected_en_es(self, text):
        result = validate(valid_regime_interpretation(implications=[text]))
        assert not result.accepted and "no_trading_recommendation" in failed_ids(result)

    @pytest.mark.parametrize("text", [
        "Dealers are short gamma; the put wing is bid relative to the at-the-money",
        "Los dealers están cortos de gamma; el skew de puts sigue calmo",
    ])
    def test_descriptive_positioning_is_not_a_directive(self, text):
        assert validate(valid_regime_interpretation(observations=[text])).accepted

    def test_unknown_evidence_path_rejected(self):
        ev = [{"fact_path": "facts.vix9d", "claim": "Front-end vol is bid"}]
        result = validate(valid_regime_interpretation(evidence=ev))
        assert not result.accepted and "facts_match_source" in failed_ids(result)

    def test_evidence_may_reference_the_boolean_semaphore(self):
        ev = [{"fact_path": "facts.put_skew_level_ok", "claim": "The semaphore is calm"}]
        assert validate(valid_regime_interpretation(evidence=ev)).accepted

    def test_number_in_limitations_must_match_a_fact(self):
        result = validate(valid_regime_interpretation(limitations=["Coverage is only 42 percent"]))
        assert not result.accepted and "no_invented_numbers" in failed_ids(result)


class TestSchema:
    @pytest.mark.parametrize("field", ["gamma_regime", "tail_pricing", "observations",
                                       "quantitative_claims", "evidence", "limitations"])
    def test_omitted_required_field_rejected(self, field):
        data = valid_regime_interpretation()
        del data[field]
        result = validate(data)
        assert not result.accepted and not result.checks

    def test_extra_field_rejected(self):
        assert not validate(valid_regime_interpretation(recommendation="none")).accepted

    def test_gex_payload_is_not_a_regime_interpretation(self):
        gex = valid_regime_interpretation()
        gex["regime"] = gex.pop("gamma_regime")
        del gex["tail_pricing"]
        assert not validate(gex).accepted


class TestCodexRound1:
    """Codex B2/B3: near values are invented numbers; advisory position statements are directives."""

    @pytest.mark.parametrize("claim", ["VIX at 17.715 is subdued", "VIX near 17.7 is subdued"])
    def test_near_value_in_evidence_claim_rejected(self, claim):
        ev = [{"fact_path": "facts.vix", "claim": claim}]
        result = validate(valid_regime_interpretation(evidence=ev))
        assert not result.accepted
        assert failed_ids(result) & {"facts_match_source", "no_invented_numbers"}

    def test_near_value_in_limitations_rejected(self):
        result = validate(valid_regime_interpretation(limitations=["Coverage near 97.4 percent"]))
        assert not result.accepted and "no_invented_numbers" in failed_ids(result)

    def test_exact_value_in_limitations_still_allowed(self):
        assert validate(valid_regime_interpretation(limitations=["Coverage is 97.5 percent of expirations"])).accepted

    @pytest.mark.parametrize("text", [
        "A bullish position in SPY is warranted",
        "A bearish stance is appropriate here",
        "Una posición alcista en SPY sería apropiada",
        "Una apuesta bajista tiene sentido",
    ])
    def test_advisory_position_statements_rejected(self, text):
        result = validate(valid_regime_interpretation(implications=[text]))
        assert not result.accepted and "no_trading_recommendation" in failed_ids(result)
