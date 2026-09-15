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
    """Structural grounding check: output must reference facts.

    Two-layer check:
    1. Structural: if the output is JSON with an "evidence" array containing
       "fact_path" entries, validate they reference real fact keys.
    2. Textual fallback: at least one fact key or known fact value must appear
       in the output text. This is lenient — "Net GEX" matches "net_gex",
       "spot" matches "spot", etc.
    """
    if not facts:
        return GuardrailResult(
            guardrail_id="facts_match_source",
            passed=True,
            message="No facts provided — nothing to check",
        )

    # Layer 1: Structural evidence check via JSON
    import json

    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict) and "evidence" in parsed:
            evidence_list = parsed["evidence"]
            if isinstance(evidence_list, list) and len(evidence_list) > 0:
                valid_paths = _build_valid_fact_paths(facts)
                for ev in evidence_list:
                    if isinstance(ev, dict):
                        fp = ev.get("fact_path", "")
                        # Normalize: strip "facts." prefix
                        normalized = fp.replace("facts.", "") if fp.startswith("facts.") else fp
                        if normalized in valid_paths:
                            return GuardrailResult(
                                guardrail_id="facts_match_source",
                                passed=True,
                                message=f"OK — evidence references valid fact: {fp}",
                            )
    except (json.JSONDecodeError, TypeError):
        pass  # Not JSON or malformed — fall through to textual check

    # Layer 2: Textual fallback — lenient matching
    raw_lower = raw_text.lower()

    # Check fact keys (with underscore-to-space normalization)
    for key in facts:
        key_lower = key.lower()
        # Match exact key name or human-readable form
        if key_lower in raw_lower or key_lower.replace("_", " ") in raw_lower:
            return GuardrailResult(
                guardrail_id="facts_match_source",
                passed=True,
                message="OK — output references fact data",
            )

    # Check if any significant fact value appears as text
    for key, val in facts.items():
        if isinstance(val, (int, float)) and val not in (0, 0.0, 1, 1.0):
            val_str = str(val)
            if val_str in raw_text:
                return GuardrailResult(
                    guardrail_id="facts_match_source",
                    passed=True,
                    message=f"OK — output contains fact value {val_str}",
                )

    return GuardrailResult(
        guardrail_id="facts_match_source",
        passed=False,
        message="Output does not appear to reference any provided facts",
    )


def _build_valid_fact_paths(facts: dict, prefix: str = "") -> set[str]:
    """Build set of valid dot-notation paths from a facts dict."""
    paths: set[str] = set()
    for key, val in facts.items():
        full = f"{prefix}{key}" if not prefix else f"{prefix}.{key}"
        paths.add(full)
        # Also add without prefix for flexibility
        paths.add(key)
        if isinstance(val, dict):
            paths.update(_build_valid_fact_paths(val, full))
    return paths


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
