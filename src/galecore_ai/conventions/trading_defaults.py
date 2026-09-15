"""Trading defaults convention set — domain-level conventions for trading analysis.

These are the lowest-precedence conventions. Methodology and user
overrides take precedence.
"""

from __future__ import annotations

from galecore_ai.harness.definitions import (
    ConventionEntry,
    ConventionPrecedence,
    ConventionSet,
)


def build_trading_defaults() -> ConventionSet:
    """Build the default trading conventions."""
    return ConventionSet(
        convention_id="trading_defaults",
        version="1.0.0",
        display_name="Trading Defaults",
        description="Built-in domain conventions for trading analysis and decision support.",
        entries=[
            ConventionEntry(
                key="gex_near_zero_threshold_pct",
                value=10.0,
                precedence=ConventionPrecedence.DOMAIN,
                description="Percentage of max(|call_gex|, |put_gex|) below which net_gex is considered 'near_zero'",
            ),
            ConventionEntry(
                key="analysis_timezone",
                value="America/New_York",
                precedence=ConventionPrecedence.DOMAIN,
                description="Default timezone for market analysis",
            ),
            ConventionEntry(
                key="primary_currency",
                value="USD",
                precedence=ConventionPrecedence.DOMAIN,
                description="Default currency for all monetary values",
            ),
            ConventionEntry(
                key="decimal_precision",
                value=2,
                precedence=ConventionPrecedence.DOMAIN,
                description="Default decimal precision for monetary values",
            ),
        ],
    )
