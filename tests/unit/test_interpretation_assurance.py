"""Adversarial acceptance checks independent of a provider or HTTP application.

Covers the Increment 4 boundary invariants: near_zero is always rejected,
interpretive numbers live in quantitative_claims (no digits in observations or
implications), claims are validated against the authoritative fact through a closed
metric/unit contract.
"""

import math

import pytest

from galecore_ai.application.validate_interpretation import validate_interpretation
from galecore_ai.contracts.gex_analysis import GexInterpretation

FACTS = {
    "net_gex": 1500.0,
    "call_gex": 2000000.0,
    "put_gex": -500000.0,
    "spot": 450.5,
    "zero_gamma_level": 445.0,
    "call_wall": 460.0,
    "put_wall": 440.0,
}


def claim(metric="net_gex", value=1500.0, unit="billion_usd"):
    return {"metric": metric, "value": value, "unit": unit}


def output(**changes):
    return {
        "regime": "positive_gamma",
        "observations": ["Net GEX is positive, dealers are long gamma"],
        "implications": ["Mean reversion expected"],
        "quantitative_claims": [claim()],
        "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is positive"}],
        "limitations": ["Snapshot only"],
        **changes,
    }


def validate(payload, facts=None):
    return validate_interpretation(
        interpretation=payload, facts=FACTS if facts is None else facts,
        output_schema=GexInterpretation, guardrail_ids=[],
    )


def assert_rejected(result, *needles):
    assert not result.accepted
    assert result.result is None, "rejected output must never cross the boundary"
    assert result.errors
    for needle in needles:
        assert any(needle in e for e in result.errors), f"{needle!r} not in {result.errors}"


# ── Regressions: the boundary never returns a rejected payload ─────────


@pytest.mark.parametrize("payload", [
    "not json",
    output(regime="negative_gamma"),
    output(evidence=[{"fact_path": "facts.nonexistent", "claim": "Value is positive"}]),
    output(evidence=[]),
    output(observations=["Spot is 999"]),
    output(quantitative_claims=[claim(value=999.0)]),
])
def test_rejected_payload_is_never_returned(payload):
    assert_rejected(validate(payload))


def test_external_interpretation_validated_without_model():
    result = validate(output())
    assert result.accepted
    assert result.result["regime"] == "positive_gamma"
    assert {c.guardrail_id for c in result.checks} == {
        "no_invented_numbers", "facts_match_source", "no_trading_recommendation",
        "no_numbers_in_prose", "gex_regime_sign", "quantitative_claims_valid",
    }
    assert all(c.passed for c in result.checks)


def test_protocol_cannot_disable_required_checks():
    """Omitting every guardrail ID still runs the mandatory GEX checks."""
    result = validate(output(observations=["Spot is 450.5"]))
    assert_rejected(result, "no_numbers_in_prose")


def test_structural_checks_are_not_delegated_to_raw_text_runner():
    """Listing the structural IDs in the protocol must not produce a fake pass."""
    result = validate_interpretation(
        interpretation=output(quantitative_claims=[claim(value=999.0)]),
        facts=FACTS, output_schema=GexInterpretation,
        guardrail_ids=["quantitative_claims_valid", "gex_regime_sign"],
    )
    ids = [c.guardrail_id for c in result.checks]
    assert ids.count("quantitative_claims_valid") == 1
    assert ids.count("gex_regime_sign") == 1
    assert_rejected(result, "quantitative_claims_valid")


@pytest.mark.parametrize("text", [
    "Recomendamos comprar calls de SPY",
    "Hold SPY shares through the event",
    "Accumulate SPY calls into weakness",
    "Consider holding your positions",
    "Mantener las posiciones en SPY",
    "Acumular puts mientras dure el régimen",
    "Sugerimos mantener la posición",
    "Increase your SPY position ahead of the print",
    "Add SPY shares on weakness",
    "Favor SPY puts here",
    "Conviene adquirir puts de SPY",
    "Aumentar la exposición a SPY",
])
def test_trading_directive_rejected(text):
    result = validate(output(implications=[text]))
    assert_rejected(result, "no_trading_recommendation")


@pytest.mark.parametrize("text", [
    "Dealers are net short gamma across the chain, so their hedging follows price",
    "Dealers are long gamma and their hedging positions dampen moves",
    "Spot is sitting on the put wall while the call wall caps a rebound",
    "Heavy downside protection is held by end clients in puts",
    "Los dealers están cortos de gamma y las posiciones de puts dominan",
])
def test_descriptive_positioning_prose_accepted(text):
    """F-10: describing dealer positioning is not a directive."""
    payload = output(observations=[text], implications=["Moves may be amplified while this regime persists"])
    result = validate(payload)
    assert result.accepted, result.errors


@pytest.mark.parametrize("text", [
    "Short SPY puts into the event",
    "Go short here",
    "Sell puts while the wall holds",
    "Vender puts de SPY",
    "Tomar una posición larga en SPY",
    "Tomá posición corta hasta el vencimiento",
    "Take a long position here",
    "Ponerse largo en el put wall",
    "Abrir una operación en SPY",
    "Objetivo de precio en el call wall",
])
def test_directive_near_instrument_still_rejected(text):
    assert_rejected(validate(output(implications=[text])), "no_trading_recommendation")


@pytest.mark.parametrize("field", ["quantitative_claims", "limitations", "evidence", "observations"])
def test_omitted_mandatory_field_rejected_by_schema(field):
    """Codex BLOCKER: Pydantic skips default validation, so a defaulted list with
    min_length=1 let an omitted field through. Mandatory lists are now required."""
    payload = output()
    del payload[field]
    result = validate(payload)
    assert_rejected(result)
    assert not result.checks


# ── near_zero: always rejected (incompatible scales) ───────────────────


class TestNearZeroFailClosed:
    def _near_zero(self, **changes):
        return output(regime="near_zero", **changes)

    @pytest.mark.parametrize("facts", [
        {**FACTS, "net_gex": 0.0},
        {**FACTS, "net_gex": 1e-9},
        {**FACTS, "net_gex": 50.0, "call_gex": 1000000.0, "put_gex": -1000000.0},
        {**FACTS, "net_gex": -50.0},
        {**FACTS, "net_gex": 1500.0},
    ])
    def test_near_zero_rejected_for_any_facts(self, facts):
        payload = self._near_zero(quantitative_claims=[claim(value=facts["net_gex"])])
        assert_rejected(validate(payload, facts), "near_zero validation unavailable")

    def test_near_zero_rejected_even_when_threshold_convention_exists(self):
        """The validator takes no threshold; a caller cannot re-enable near_zero."""
        with pytest.raises(TypeError):
            validate_interpretation(
                interpretation=self._near_zero(), facts=FACTS,
                output_schema=GexInterpretation, guardrail_ids=[],
                near_zero_threshold_pct=5.0,
            )
        assert_rejected(validate(self._near_zero()), "incompatible scales")

    def test_near_zero_rejected_without_call_or_put_gex(self):
        facts = {"net_gex": 100.0, "spot": 450.5}
        payload = self._near_zero(quantitative_claims=[claim(value=100.0)])
        assert_rejected(validate(payload, facts), "near_zero validation unavailable")

    def test_dimensional_case_from_review(self):
        """call_gex=2_000_000, put_gex=-1_800_000, net_gex=200: the old formula
        would have called this 5.3% and near-zero-ish; it must be rejected."""
        facts = {**FACTS, "call_gex": 2_000_000.0, "put_gex": -1_800_000.0, "net_gex": 200.0}
        payload = self._near_zero(quantitative_claims=[claim(value=200.0)])
        result = validate(payload, facts)
        assert_rejected(result, "gex_regime_sign")
        assert result.result is None

    def test_positive_gamma_accepted_by_sign(self):
        assert validate(output()).accepted

    def test_negative_gamma_accepted_by_sign(self):
        facts = {**FACTS, "net_gex": -1500.0}
        payload = output(
            regime="negative_gamma",
            observations=["Net GEX is negative, dealers are short gamma"],
            quantitative_claims=[claim(value=-1500.0)],
        )
        assert validate(payload, facts).accepted

    def test_sign_contradiction_rejected(self):
        assert_rejected(validate(output(regime="negative_gamma")), "gex_regime_sign")


# ── Quantitative claims: closed metric/unit contract ───────────────────


class TestQuantitativeClaims:
    def test_correct_claim_accepted(self):
        assert validate(output(quantitative_claims=[claim()])).accepted

    def test_wrong_value_rejected(self):
        assert_rejected(validate(output(quantitative_claims=[claim(value=1499.99)])),
                        "does not match fact")

    def test_rescaled_value_rejected(self):
        """net_gex=1500 must be claimed as 1500.0, never normalized to 1.5."""
        assert_rejected(validate(output(quantitative_claims=[claim(value=1.5)])),
                        "does not match fact")

    def test_wrong_unit_rejected(self):
        assert_rejected(validate(output(quantitative_claims=[claim(unit="usd")])),
                        "requires unit 'billion_usd'")

    def test_unknown_metric_rejected_by_schema(self):
        result = validate(output(quantitative_claims=[claim(metric="call_gex", value=2000000.0)]))
        assert_rejected(result)
        assert not result.checks, "schema rejection happens before any guardrail runs"

    def test_unknown_unit_rejected_by_schema(self):
        result = validate(output(quantitative_claims=[claim(unit="million_usd")]))
        assert_rejected(result)
        assert not result.checks

    def test_fact_absent_rejected(self):
        facts = {k: v for k, v in FACTS.items() if k != "call_wall"}
        payload = output(quantitative_claims=[claim(), claim("call_wall", 460.0, "usd")])
        assert_rejected(validate(payload, facts), "absent or null")

    def test_fact_null_rejected(self):
        facts = {**FACTS, "call_wall": None}
        payload = output(quantitative_claims=[claim(), claim("call_wall", 460.0, "usd")])
        assert_rejected(validate(payload, facts), "absent or null")

    @pytest.mark.parametrize("bad", [{"v": 460.0}, [460.0]])
    def test_fact_not_scalar_rejected(self, bad):
        facts = {**FACTS, "call_wall": bad}
        payload = output(quantitative_claims=[claim(), claim("call_wall", 460.0, "usd")])
        assert_rejected(validate(payload, facts), "not a scalar")

    @pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
    def test_non_finite_value_rejected(self, value):
        result = validate(output(quantitative_claims=[claim(value=value)]))
        assert_rejected(result)

    @pytest.mark.parametrize("value", ["1500", "1.5e3", True])
    def test_non_numeric_value_rejected_by_schema(self, value):
        result = validate(output(quantitative_claims=[claim(value=value)]))
        assert_rejected(result)
        assert not result.checks

    def test_float_noise_rejected(self):
        """Equality is exact: 1500.000000001 is not 1500.0."""
        assert_rejected(validate(output(quantitative_claims=[claim(value=1500.000000001)])),
                        "does not match fact")

    def test_int_and_float_forms_of_same_fact_accepted(self):
        assert validate(output(quantitative_claims=[claim(value=1500)])).accepted

    def test_non_finite_fact_rejected(self):
        facts = {**FACTS, "net_gex": math.inf}
        assert_rejected(validate(output(quantitative_claims=[claim(value=1500.0)]), facts))

    def test_multiple_correct_claims_accepted(self):
        payload = output(quantitative_claims=[
            claim(), claim("spot", 450.5, "usd"), claim("zero_gamma_level", 445.0, "usd"),
            claim("call_wall", 460.0, "usd"), claim("put_wall", 440.0, "usd"),
        ])
        result = validate(payload)
        assert result.accepted
        assert sum(c.guardrail_id == "quantitative_claims_valid" for c in result.checks) == 5

    def test_one_wrong_claim_rejects_everything(self):
        payload = output(quantitative_claims=[claim(), claim("spot", 450.5, "usd"), claim("put_wall", 441.0, "usd")])
        result = validate(payload)
        assert_rejected(result, "Claim[2]")
        assert result.result is None

    def test_metric_with_another_facts_value_rejected(self):
        """metric=net_gex carrying the put_wall value: the validator derives the
        path from the metric, so the misattribution is caught."""
        assert_rejected(validate(output(quantitative_claims=[claim(value=440.0)])),
                        "'net_gex' value 440.0 does not match fact 1500.0")

    def test_host_supplied_fact_path_rejected_by_schema(self):
        payload = output(quantitative_claims=[{**claim(), "fact_path": "facts.put_wall"}])
        result = validate(payload)
        assert_rejected(result)
        assert not result.checks

    def test_empty_quantitative_claims_rejected(self):
        result = validate(output(quantitative_claims=[]))
        assert_rejected(result)
        assert not result.checks


# ── No numbers in interpretive prose ───────────────────────────────────


class TestNoNumbersInProse:
    @pytest.mark.parametrize("text", [
        "Net GEX is 1500",
        "Net GEX is 1500.0",
        "Spot sits at +450.5",
        "Coverage near 85%",
        "Net GEX around 1.5e3",
        "Total gamma near 1,500 billion",
        "Net GEX is \u0663 times bigger",
        "Net GEX is \u00b2 big",
        "About \u00bd of prior exposure",
        "Level \u2075 of the ladder",
    ])
    def test_number_in_observation_rejected(self, text):
        assert_rejected(validate(output(observations=[text])), "no_numbers_in_prose")

    @pytest.mark.parametrize("text", [
        "Put GEX is -500000",
        "Expect a move of about 2%",
        "Drift of -0.5 per session",
    ])
    def test_number_in_implication_rejected(self, text):
        assert_rejected(validate(output(implications=[text])), "no_numbers_in_prose")

    def test_qualitative_prose_accepted(self):
        payload = output(
            observations=["Net GEX is positive and spot sits above the zero-gamma level"],
            implications=["Dealers dampen moves; expect mean reversion inside the walls"],
        )
        assert validate(payload).accepted

    def test_numbers_only_in_claims_accepted(self):
        payload = output(quantitative_claims=[claim(), claim("spot", 450.5, "usd")])
        result = validate(payload)
        assert result.accepted
        assert result.result["quantitative_claims"][1]["value"] == 450.5

    def test_scope_is_observations_and_implications_only(self):
        """Documented limit: a fact-matching digit in limitations is not caught by
        no_numbers_in_prose (only by no_invented_numbers)."""
        facts = {**FACTS, "expirations_included": 3}
        result = validate(output(limitations=["Only 3 expirations included"]), facts)
        assert result.accepted
        assert_rejected(validate(output(limitations=["Could fall 7 percent"]), facts), "no_invented_numbers")

    def test_fact_value_in_prose_is_still_rejected(self):
        """Even a correct number is prose is rejected: numbers belong in claims."""
        assert_rejected(validate(output(observations=["Net GEX is 1500.0"])), "no_numbers_in_prose")


# ── Evidence: path resolution only ─────────────────────────────────────


class TestEvidence:
    def test_nonexistent_fact_path_rejected(self):
        payload = output(evidence=[{"fact_path": "facts.nonexistent", "claim": "Value is positive"}])
        assert_rejected(validate(payload), "facts_match_source")

    def test_number_in_evidence_claim_must_match_path(self):
        payload = output(evidence=[{"fact_path": "facts.net_gex", "claim": "Net GEX is 750.0"}])
        assert_rejected(validate(payload), "facts_match_source")

    def test_qualitative_evidence_accepted_without_semantic_check(self):
        """Documented limit: a wrong-but-numberless claim on a valid path passes."""
        payload = output(evidence=[{"fact_path": "facts.net_gex", "claim": "Dealers are short gamma"}])
        assert validate(payload).accepted


@pytest.mark.asyncio
async def test_runtime_validates_returned_value_not_different_raw_text():
    from galecore_ai.models.provider import ModelResult
    from tests.unit.test_runtime import _agent, _build_runtime, _request

    class MismatchedProvider:
        provider_name = "test"
        model_id = "test"

        async def generate_structured(self, request, schema):
            return ModelResult(
                value=GexInterpretation.model_validate(output(observations=["Target 999"])),
                raw_text=GexInterpretation.model_validate(output()).model_dump_json(),
            )

    result = await _build_runtime(provider=MismatchedProvider()).execute(
        _request(), agent_definition=_agent(), facts=FACTS, output_schema=GexInterpretation,
    )
    assert result.status.value == "VALIDATION_ERROR"
    assert result.result is None
