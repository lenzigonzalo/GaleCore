"""Guardrails — post-generation validation rules.

Guardrails run AFTER the model produces output and BEFORE the result
is returned. They enforce invariants like "no invented numbers".

Each guardrail is a callable: (raw_text, facts) → GuardrailResult.
"""

from __future__ import annotations

import json
import re
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
        self._guardrails["no_trading_recommendation"] = _guardrail_no_trading_recommendation
        self._guardrails["no_numbers_in_prose"] = _guardrail_no_numbers_in_prose
        # quantitative_claims_valid and gex_regime_sign need the parsed
        # GexInterpretation and run inside validate_interpretation. They are
        # deliberately NOT registered here: a raw-text runner asked for them
        # fails closed instead of reporting a pass it did not perform.

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
    """Check that the model output doesn't contain numbers not in the facts.

    This checks all numbers in the output against all numeric fact values.
    Numbers in free text that happen to match an unrelated fact value are a
    known limitation requiring human review.
    """
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


# Deterministic pattern-match for common trading recommendations.
# Each prose field is scanned on its own (never the serialized JSON), and a
# directive verb must sit within a few words of an instrument/position noun
# in the same sentence. "short gamma", "long gamma", "short vol" and similar
# descriptions of dealer positioning are explicitly not directives.
# Limitations: novel phrasings, euphemisms, or languages other than
# English/Spanish will bypass this check. It is a bounded, documented
# pattern set, not a universal guarantee and not semantic analysis.
_GAP = r"(?:[^.;:!?\n]{0,60}?)"  # a few words, no sentence boundary
_NOT_DESCRIPTIVE_EN = r"(?!\s+(?:gamma|vol|volatility|convexity|dated|the\s+dollar|end))"
_NOT_DESCRIPTIVE_ES = r"(?!\s+(?:gamma|vol|volatilidad|convexidad))"
_INSTR_EN = r"\b(?:shares?|options?|puts?|calls?|contracts?|stock|positions?|exposure|SPY)\b"
_INSTR_ES = r"\b(?:acciones|opciones|puts?|calls?|contratos?|posicion(?:es)?|exposici[oó]n|SPY)\b"

_TRADING_REC_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        # ── English ──────────────────────────────────────────────
        r"\b(?:buy|sell|short|long|purchase|liquidate|exit|hold|accumulate|acquire|add|increase|reduce|trim|"
        r"unload|dump|favou?r|overweight|underweight|rotate\s+into)\b" + _NOT_DESCRIPTIVE_EN + _GAP + _INSTR_EN,
        r"\b(?:consider|recommend|suggest|advise)\b" + _GAP
        + r"\b(?:buying|selling|shorting|longing|entering|exiting|opening|closing|holding|accumulating|acquiring|adding|trimming)\b",
        r"\b(?:go\s+(?:long|short))\b" + _NOT_DESCRIPTIVE_EN,
        r"\b(?:take\s+(?:a\s+)?(?:long|short)\s+position)\b",
        r"\b(?:open|close|enter|exit)\s+(?:a\s+)?(?:trade|position)\b",
        r"\bstop[- ]?loss\s+at\b",
        r"\btake[- ]?profit\s+at\b",
        r"\bprice\s+target\s+(?:of|at|is)\b",
        r"\brisk[/-]reward\s+(?:ratio|of)\b",
        # ── Spanish ──────────────────────────────────────────────
        r"\b(?:comprar|vender|compra|vende|comprá|vendé|adquir(?:ir|í|a)|manten(?:er|é|ga)|acumul(?:ar|á|e)|"
        r"sum(?:ar|á)|agreg(?:ar|á)|aument(?:ar|á)|reduc(?:ir|í)|conviene|convendría|favorec(?:er|é))\b"
        + _NOT_DESCRIPTIVE_ES + _GAP + _INSTR_ES,
        r"\b(?:consider(?:ar|amos|e|á)|recomend(?:ar|amos|o|á)|sugerimos|sugiero|sugerir|aconsej(?:ar|amos|o|á))\b"
        + _GAP + r"\b(?:comprar|vender|abrir|cerrar|entrar|salir|mantener|acumular|sumar|agregar|reducir)\b",
        r"\b(?:ponerse|ir)\s+(?:largo|corto)\b" + _NOT_DESCRIPTIVE_ES,
        r"\b(?:tom(?:ar|a|á|e|en|amos)\s+(?:una?\s+)?posici[oó]n\s+(?:larga|corta))\b",
        r"\b(?:abrir|cerrar|entrar|salir\s+de)\s+(?:una?\s+)?(?:operaci[oó]n|posici[oó]n|trade)\b",
        r"\bstop[- ]?loss\s+en\b",
        r"\btake[- ]?profit\s+en\b",
        r"\bobjetivo\s+de\s+precio\b",
    ]
]


def _prose_fields(raw_text: str) -> list[tuple[str, str]]:
    """(field, text) pairs for every free-text string in the output.

    Falls back to the raw text as a single field if the output is not a JSON
    object, so a non-structured payload is still scanned.
    """
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        return [("raw", raw_text)]
    if not isinstance(parsed, dict):
        return [("raw", raw_text)]
    out: list[tuple[str, str]] = []
    for field in ("observations", "implications", "limitations"):
        for item in parsed.get(field) or []:
            if isinstance(item, str):
                out.append((field, item))
    for ev in parsed.get("evidence") or []:
        if isinstance(ev, dict) and isinstance(ev.get("claim"), str):
            out.append(("evidence.claim", ev["claim"]))
    return out


def _guardrail_no_trading_recommendation(raw_text: str, facts: dict) -> GuardrailResult:
    """Reject output that contains explicit trading recommendations.

    Deterministic pattern check applied per prose field. It covers the
    documented directive phrasings in English and Spanish; novel phrasings
    and indirect suggestions may pass. Declared as a known limitation.
    """
    for field, text in _prose_fields(raw_text):
        for pattern in _TRADING_REC_PATTERNS:
            match = pattern.search(text)
            if match:
                return GuardrailResult(
                    guardrail_id="no_trading_recommendation",
                    passed=False,
                    message=f"Trading recommendation detected in {field}: '{match.group()}'",
                )
    return GuardrailResult(
        guardrail_id="no_trading_recommendation",
        passed=True,
        message="No explicit trading recommendations detected (pattern-based; novel phrasings may bypass)",
    )


# Pattern for detecting numbers in prose fields.
# Matches: integers, decimals, negatives, explicit positives, percentages,
# scientific notation, any Unicode decimal digit (\d), and the common
# non-decimal numerics (superscripts, vulgar fractions, subscripts).
# Does NOT match: numbers spelled as words ("seven hundred fifty"), roman
# numerals. Those bypass this check — documented limitation.
_PROSE_NUM_PATTERN = re.compile(
    r"[-+]?\d+\.?\d*(?:[eE][-+]?\d+)?%?"
    r"|[\u00b2\u00b3\u00b9\u00bc-\u00be\u2070-\u2079\u2080-\u2089\u2150-\u218f]"
)


def _guardrail_no_numbers_in_prose(raw_text: str, facts: dict) -> GuardrailResult:
    """Reject output where observations or implications contain numbers.

    Interpretive numbers belong in quantitative_claims, not in these prose
    fields. Scope is exactly observations and implications: evidence claims
    are checked by facts_match_source against their referenced fact, and
    limitations are only subject to no_invented_numbers.
    This is a deterministic regex check. Known limitations:
    - Numbers written as words ("seven hundred") and roman numerals bypass it.
    - Semantic entailment of qualitative prose is not verified.
    - Causal qualitative claims are not checked.
    """
    try:
        parsed = json.loads(raw_text)
        if not isinstance(parsed, dict):
            raise TypeError("Output is not a JSON object")

        obs = parsed.get("observations", [])
        impl = parsed.get("implications", [])
        if not isinstance(obs, list):
            obs = []
        if not isinstance(impl, list):
            impl = []

        errors: list[str] = []
        for text in [*obs, *impl]:
            if not isinstance(text, str):
                continue
            found = _PROSE_NUM_PATTERN.findall(text)
            if found:
                errors.append(
                    f"Number(s) {found} found in prose: '{text[:80]}'"
                )

        if errors:
            return GuardrailResult(
                guardrail_id="no_numbers_in_prose",
                passed=False,
                message="; ".join(errors),
            )

    except (json.JSONDecodeError, TypeError) as exc:
        return GuardrailResult(
            guardrail_id="no_numbers_in_prose",
            passed=False,
            message=f"Cannot verify prose: {exc}",
        )

    return GuardrailResult(
        guardrail_id="no_numbers_in_prose",
        passed=True,
        message="No numbers in observations/implications (pattern-based; spelled-out numbers may bypass)",
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
