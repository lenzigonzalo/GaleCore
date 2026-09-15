"""Facts Discipline protocol — enforces the separation of facts and interpretation.

This is the foundational protocol: the model must not invent quantitative data.
Facts come from GaleCore; interpretation comes from the model.
"""

from __future__ import annotations

from galecore_ai.harness.definitions import ProtocolDefinition, ProtocolStep


def build_facts_discipline_protocol() -> ProtocolDefinition:
    """Build the facts discipline protocol."""
    return ProtocolDefinition(
        protocol_id="facts_discipline",
        version="1.0.0",
        display_name="Facts Discipline",
        description=(
            "Enforces strict separation between deterministic facts from GaleCore "
            "and model-generated interpretation. The model must never invent, "
            "recalculate, or estimate quantitative values."
        ),
        trigger="always",  # applies to every agent run
        steps=[
            ProtocolStep(
                step_id="identify_facts",
                description="Identify all quantitative values provided as deterministic facts from GaleCore",
                required=True,
            ),
            ProtocolStep(
                step_id="no_invention",
                description="Verify that your output does not contain any numbers not present in the provided facts",
                required=True,
            ),
            ProtocolStep(
                step_id="cite_source",
                description="When referencing a specific value, ensure it matches exactly what was provided in facts",
                required=True,
            ),
            ProtocolStep(
                step_id="state_caveats",
                description="Acknowledge limitations of the data and conditions under which the analysis might not hold",
                required=True,
            ),
        ],
        guardrails=["no_invented_numbers", "facts_match_source"],
    )
