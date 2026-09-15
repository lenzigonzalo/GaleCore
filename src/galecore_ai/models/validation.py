"""Output validation — ensures model outputs conform to contracts.

facts = deterministic data from GaleCore. The model must NOT invent facts.
interpretation = model-generated analysis. Must reference only provided facts.

This module validates structured outputs after parsing.
"""

from __future__ import annotations

from pydantic import BaseModel, ValidationError


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str] = []


def validate_output(data: dict, schema: type[BaseModel]) -> ValidationResult:
    """Validate a dict against a Pydantic schema. Returns structured result."""
    try:
        schema.model_validate(data)
        return ValidationResult(valid=True)
    except ValidationError as exc:
        return ValidationResult(
            valid=False,
            errors=[str(e) for e in exc.errors()],
        )


def validate_no_invented_numbers(
    interpretation_text: str,
    known_values: set[float],
    tolerance: float = 0.01,
) -> ValidationResult:
    """Check that numeric values in interpretation text are from known facts.

    Extracts numbers from the text and verifies each one appears in known_values
    (within tolerance). This enforces the rule: interpretation must not invent
    quantitative observations.
    """
    import re

    errors: list[str] = []
    # Match numbers like 1234.56, -0.16, 50%, $5
    pattern = r"[-+]?\d+\.?\d*"
    found = re.findall(pattern, interpretation_text)

    for num_str in found:
        try:
            num = float(num_str)
        except ValueError:
            continue

        # Skip trivially common numbers (0, 1, 100)
        if num in (0.0, 1.0, 100.0):
            continue

        if not any(abs(num - known) <= tolerance for known in known_values):
            errors.append(
                f"Number {num} in interpretation not found in known facts"
            )

    return ValidationResult(valid=len(errors) == 0, errors=errors)
