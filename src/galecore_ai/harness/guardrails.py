"""Guardrails — post-generation validation rules.

Guardrails run AFTER the model produces output and BEFORE the result
is returned. They enforce invariants like "no invented numbers".

Each guardrail is a callable: (raw_text, facts) → GuardrailResult.
"""

from __future__ import annotations

from collections.abc import Callable

from pydantic import BaseModel

from galecore_ai.models.validation import validate_no_invented_numbers


class GuardrailResult(BaseModel):
    """Result of a single guardrail check."""

    guardrail_id: str
    passed: bool
    message: str = ""


# Type for guardrail functions: (raw_text, facts) → GuardrailResult
GuardrailFn = Callable[[str, dict], GuardrailResult]


class GuardrailRunner:
    """Runs registered guardrails against model output."""

    def __init__(self) -> None:
        self._guardrails: dict[str, GuardrailFn] = {}
        # Register built-in guardrails
        self._guardrails["no_invented_numbers"] = _guardrail_no_invented_numbers
        self._guardrails["facts_match_source"] = _guardrail_facts_match_source

    def run_all(
        self,
        *,
        guardrail_ids: list[str],
        raw_text: str,
        facts: dict,
    ) -> list[GuardrailResult]:
        """Run the specified guardrails and return results."""
        results: list[GuardrailResult] = []
        for gid in guardrail_ids:
            fn = self._guardrails.get(gid)
            if fn is None:
                # Fail-closed: unregistered guardrail is a FAILURE, not a skip
                results.append(GuardrailResult(
                    guardrail_id=gid,
                    passed=False,
                    message=f"Guardrail '{gid}' not registered — fail-closed",
                ))
                continue
            results.append(fn(raw_text, facts))
        return results


def check_all_passed(results: list[GuardrailResult]) -> bool:
    """Check if all guardrail results passed."""
    return all(r.passed for r in results)


def _guardrail_no_invented_numbers(raw_text: str, facts: dict) -> GuardrailResult:
    """Check that the model output doesn't contain numbers not in the facts."""
    known_values: set[float] = set()
    _extract_numbers_from_dict(facts, known_values)

    result = validate_no_invented_numbers(raw_text, known_values, tolerance=0.01)
    return GuardrailResult(
        guardrail_id="no_invented_numbers",
        passed=result.valid,
        message="; ".join(result.errors) if result.errors else "OK",
    )


def _guardrail_facts_match_source(raw_text: str, facts: dict) -> GuardrailResult:
    """Lightweight check: if facts were provided, output should reference at least one."""
    if not facts:
        return GuardrailResult(
            guardrail_id="facts_match_source",
            passed=True,
            message="No facts provided — nothing to check",
        )

    # Check that at least one fact key or value appears in the output
    raw_lower = raw_text.lower()
    for key in facts:
        if key.lower() in raw_lower:
            return GuardrailResult(
                guardrail_id="facts_match_source",
                passed=True,
                message="OK — output references fact data",
            )

    return GuardrailResult(
        guardrail_id="facts_match_source",
        passed=False,
        message="Output does not appear to reference any provided facts",
    )


def _extract_numbers_from_dict(d: dict, out: set[float]) -> None:
    """Recursively extract numeric values from a dict."""
    for v in d.values():
        if isinstance(v, (int, float)) and v not in (None,):
            out.add(float(v))
        elif isinstance(v, dict):
            _extract_numbers_from_dict(v, out)
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, (int, float)):
                    out.add(float(item))
                elif isinstance(item, dict):
                    _extract_numbers_from_dict(item, out)
