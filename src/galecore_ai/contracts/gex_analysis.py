"""GEX Analysis output contract — structured output for the GEX interpretation skill.

Rule: facts come from GaleCore deterministic data. interpretation comes from the model.
The model must not recalculate or invent quantitative observations.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class GexFacts(BaseModel):
    """Deterministic facts from GaleCore's compute.gamma_exposure capability."""

    symbol: str
    net_gex: float
    call_gex: float
    put_gex: float
    spot: float
    zero_gamma_level: float | None = None
    call_wall: float | None = None
    put_wall: float | None = None
    expiration: str | None = None
    dte: int | None = None
    market_data_as_of: datetime | None = None


class GexInterpretation(BaseModel):
    """Model-generated interpretation of GEX facts. No invented numbers."""

    regime: str  # e.g. "positive_gamma", "negative_gamma", "near_zero"
    observations: list[str] = Field(default_factory=list)
    implications: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)


class GexAnalysisResult(BaseModel):
    """Complete GEX analysis: facts + interpretation."""

    status: str = "SUCCESS"
    symbol: str
    analysis_type: str = "CURRENT_GEX"
    facts: GexFacts
    interpretation: GexInterpretation
    evidence: list[dict] = Field(default_factory=list)
