"""Adversarial acceptance checks independent of a provider or HTTP application."""

import pytest

from galecore_ai.application.validate_interpretation import validate_interpretation
from galecore_ai.contracts.gex_analysis import GexInterpretation


def output(**changes):
    return {
        "regime": "positive_gamma",
        "observations": ["Net GEX is positive"],
        "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is 1500"}],
        "limitations": ["Snapshot only"],
        **changes,
    }


def validate(payload):
    return validate_interpretation(
        interpretation=payload, facts={"net_gex": 1500.0, "spot": 450.5},
        output_schema=GexInterpretation, guardrail_ids=[],
    )


@pytest.mark.parametrize("payload", [
    "not json",
    output(regime="negative_gamma"),
    output(evidence=[{"fact_path": "facts.spot", "claim": "Spot is 1500"}]),
    output(evidence=[]),
    output(observations=["Spot is 999"]),
])
def test_rejected_payload_is_never_returned(payload):
    result = validate(payload)
    assert not result.accepted
    assert result.result is None
    assert result.errors


def test_external_interpretation_validated_without_model():
    result = validate(output())
    assert result.accepted
    assert result.result["regime"] == "positive_gamma"
    assert {c.guardrail_id for c in result.checks} == {
        "no_invented_numbers", "facts_match_source", "gex_regime_sign",
    }


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
        _request(), agent_definition=_agent(), facts={"net_gex": 1500.0, "spot": 450.5}, output_schema=GexInterpretation,
    )
    assert result.status.value == "VALIDATION_ERROR"
    assert result.result is None
