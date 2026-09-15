"""Agent run endpoints — POST /api/v1/agent-runs/gex-analysis."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from galecore_ai.contracts.agent_run import AgentRunResult, RunStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/agent-runs")


class GexAnalysisRequest(BaseModel):
    """REST request body for GEX analysis."""

    symbol: str = Field(description="Ticker symbol (e.g. SPY)")


class GexAnalysisResponse(BaseModel):
    """REST response for GEX analysis."""

    run_id: str
    status: RunStatus
    result: dict | None = None
    error_detail: str | None = None
    trace: dict = Field(default_factory=dict)


@router.post("/gex-analysis", response_model=GexAnalysisResponse)
async def run_gex_analysis(
    body: GexAnalysisRequest,
    request: Request,
) -> GexAnalysisResponse:
    """Run a GEX analysis for the given symbol.

    Full vertical: GaleCore REST → facts validation → model → guardrails → trace.
    """
    deps = request.app.state.deps

    result: AgentRunResult = await deps.gex_use_case.run(
        symbol=body.symbol.upper(),
        agent_definition=deps.trading_agent,
    )

    return GexAnalysisResponse(
        run_id=result.run_id,
        status=result.status,
        result=result.result,
        error_detail=result.error_detail,
        trace=result.trace.model_dump(exclude_none=True),
    )
