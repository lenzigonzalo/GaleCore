"""Guardrails — post-generation validation rules.

Guardrails run AFTER the model produces output and BEFORE the result
is returned. They enforce invariants like "no invented numbers".

Each guardrail is a callable: (raw_text, facts) → GuardrailResult.
"""

from __future__ import annotations

import json
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
    """Require every evidence path to resolve; numeric claims match that scalar.

    This does not prove the meaning of arbitrary prose or cover uncited claims.
    There is deliberately no textual fallback for invalid structured evidence.
    """
    if not facts:
        return GuardrailResult(
            guardrail_id="facts_match_source",
            passed=False,
            message="No facts provided — cannot ground output",
        )

    try:
        parsed = json.loads(raw_text)
        evidence = parsed.get("evidence") if isinstance(parsed, dict) else None
        if not isinstance(evidence, list) or not evidence:
            raise ValueError("Non-empty structured evidence is required")
        for ev in evidence:
            if not isinstance(ev, dict):
                raise TypeError("Evidence entries must be objects")
            path = ev.get("fact_path")
            claim = ev.get("claim")
            if not isinstance(path, str) or not isinstance(claim, str) or not claim.strip():
                raise ValueError("Evidence requires a fact_path and non-empty claim")
            value = facts
            for part in path.removeprefix("facts.").split("."):
                if not isinstance(value, dict) or part not in value:
                    raise ValueError(f"Unknown fact path: {path}")
                value = value[part]
            if value is None or isinstance(value, (dict, list)):
                raise ValueError(f"Evidence must reference an available scalar fact: {path}")
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                check = validate_no_invented_numbers(claim, {float(value)}, tolerance=0.01)
                if not check.valid:
                    raise ValueError(f"Claim numbers do not match {path}: {'; '.join(check.errors)}")
    except (ValueError, TypeError) as exc:
        return GuardrailResult(
            guardrail_id="facts_match_source", passed=False, message=str(exc),
        )

    return GuardrailResult(
        guardrail_id="facts_match_source", passed=True, message="All evidence paths validated",
    )

def _extract_numbers_from_dict(d: dict, out: set[float]) -> None:
    """Recursively extract numeric values from a dict."""
    for v in d.values():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            out.add(float(v))
        elif isinstance(v, dict):
            _extract_numbers_from_dict(v, out)
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, (int, float)):
                    out.add(float(item))
                elif isinstance(item, dict):
                    _extract_numbers_from_dict(item, out)
