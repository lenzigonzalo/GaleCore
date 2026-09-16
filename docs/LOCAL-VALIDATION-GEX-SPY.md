# Local Validation: GEX-SPY Autonomous Runtime Adapter

> **Status under architecture v5:** This guide validates the existing FastAPI + `ModelProvider` + `CognitiveRuntime` path. That path is preserved as an optional autonomous runtime adapter and is currently frozen. It is useful implementation evidence, but it is not the current Phase 3 interactive-host Definition of Done.

The interactive-host E2E guide must be defined only after the repository-alignment checkpoint and explicit approval of the host adapter. Do not use this document to infer that Phase 3 is complete.

## Prerequisites

1. **GaleCore** (.NET) running on `http://localhost:5000` with Tastytrade session active
2. **GaleCore-AI** (Python) dependencies installed
3. (Optional) `ANTHROPIC_API_KEY` for real model provider

## Quick Start — FakeProvider (Deterministic)

```powershell
cd GaleCore-AI

# Install dependencies
pip install -e ".[dev]"

# Run tests (221 tests, all deterministic)
python -m pytest tests/ -v

# Start API with FakeProvider
$env:PROVIDER_MODE = "fake"
$env:LOCAL_VALIDATION = "true"
$env:GALECORE_BASE_URL = "http://localhost:5000"
python -m uvicorn galecore_ai.api.app:create_app --factory --port 8100
```

## Test Endpoints

```powershell
# Health check
Invoke-RestMethod -Uri http://localhost:8100/health

# GEX Analysis (requires GaleCore running)
Invoke-RestMethod -Uri http://localhost:8100/api/v1/agent-runs/gex-analysis `
    -Method POST `
    -ContentType "application/json" `
    -Body '{"symbol": "SPY"}'
```

## Full Vertical — Real Provider

```powershell
# Start GaleCore first (separate terminal)
cd GaleCore/source/galecore-datafeed/DataFeed.Api
$env:ASPNETCORE_ENVIRONMENT = "Development"
dotnet run

# Start GaleCore-AI with Anthropic
$env:PROVIDER_MODE = "anthropic"
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:ANTHROPIC_MODEL = "claude-sonnet-4-6"
$env:LOCAL_VALIDATION = "true"
$env:GALECORE_BASE_URL = "http://localhost:5000"
$env:GALECORE_API_KEY = "<your GaleCore ApiKey from user-secrets>"
$env:MAX_STALENESS_SECONDS = "600"
python -m uvicorn galecore_ai.api.app:create_app --factory --port 8100

# Run analysis
Invoke-RestMethod -Uri http://localhost:8100/api/v1/agent-runs/gex-analysis `
    -Method POST `
    -ContentType "application/json" `
    -Body '{"symbol": "SPY"}'
```

## Expected Results

> Illustrative shapes for the autonomous (FastAPI/CognitiveRuntime) path, which is frozen in Phase 3. Values are examples, not a captured run; the verified, reproducible evidence for the current contract is the interactive path in `docs/evidence/increment4-e2e/`. The output contract is the same `GexInterpretation` (Increment 4: `quantitative_claims` required, no digits in observations/implications, `near_zero` always rejected).

### SUCCESS case
```json
{
  "run_id": "...",
  "status": "SUCCESS",
  "result": {
    "regime": "positive_gamma",
    "observations": ["Net GEX is positive: dealers are long gamma"],
    "implications": ["Dealer hedging is expected to dampen moves while this regime persists"],
    "quantitative_claims": [
      {"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"},
      {"metric": "spot", "value": 450.5, "unit": "usd"}
    ],
    "evidence": [
      {"fact_path": "facts.net_gex", "claim": "Net GEX sign defines the regime"}
    ],
    "limitations": ["Based on current open interest snapshot"]
  },
  "error_detail": null,
  "trace": {
    "provider": "anthropic",
    "model": "claude-opus-5",
    "validator_called_model": true,
    "skills": [{"skill_id": "gex_interpretation", "version": "1.3.0"}],
    "protocols": [{"protocol_id": "facts_discipline", "version": "1.2.0"}],
    "capabilities_invoked": [
      {"capability_id": "compute.gex_analysis", "endpoint": "/App/Gex/Analysis", "outcome": "ok"}
    ],
    "guardrails_executed": [
      {"guardrail_id": "no_invented_numbers", "passed": true},
      {"guardrail_id": "facts_match_source", "passed": true},
      {"guardrail_id": "no_trading_recommendation", "passed": true},
      {"guardrail_id": "no_numbers_in_prose", "passed": true},
      {"guardrail_id": "gex_regime_sign", "passed": true},
      {"guardrail_id": "quantitative_claims_valid", "passed": true}
    ],
    "freshness": {
      "freshness_status": "VALID",
      "market_data_as_of": "2026-09-15T14:30:00Z"
    },
    "input_tokens": 1234,
    "output_tokens": 567,
    "latency_ms": 2100
  }
}
```

### INSUFFICIENT_DATA case (GaleCore not running)
```json
{
  "run_id": "...",
  "status": "INSUFFICIENT_DATA",
  "result": null,
  "error_detail": "Capability fetch failed: HTTP error calling compute.gex_analysis: ...",
  "trace": {
    "validator_called_model": false,
    "capabilities_invoked": [
      {"capability_id": "compute.gex_analysis", "outcome": "error"}
    ]
  }
}
```

### VALIDATION_ERROR case (guardrail failure)
```json
{
  "run_id": "...",
  "status": "VALIDATION_ERROR",
  "result": null,
  "error_detail": "Guardrail failure: no_invented_numbers: Number 999.99 ...",
  "trace": {
    "validator_called_model": true,
    "guardrails_executed": [
      {"guardrail_id": "no_invented_numbers", "passed": false, "message": "..."}
    ]
  }
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PROVIDER_MODE` | `fake` | `fake` or `anthropic` |
| `ANTHROPIC_API_KEY` | — | Required when `PROVIDER_MODE=anthropic` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Model to use |
| `GALECORE_BASE_URL` | `http://localhost:5000` | GaleCore API URL |
| `GALECORE_API_KEY` | — | API key for GaleCore (match user-secrets `ApiKey`) |
| `LOCAL_VALIDATION` | `true` | Restrict to localhost only |
| `MAX_STALENESS_SECONDS` | `300` | Max age for GaleCore data before rejection |

## Security: LOCAL_VALIDATION mode

When `LOCAL_VALIDATION=true` (default), the `GALECORE_BASE_URL` is restricted to localhost only. Any attempt to point to a remote URL will fail at startup:

```
ValueError: LOCAL_VALIDATION=true but GALECORE_BASE_URL points to 'api.example.com'.
Only localhost is allowed in local validation mode.
```

## Test Levels

| Level | Command | What it tests | Count |
|-------|---------|---------------|-------|
| Unit | `pytest tests/unit/` | All components in isolation | ~130 |
| Contract | `pytest tests/contract/` | Pydantic roundtrip serialization | ~20 |
| Integration | `pytest tests/integration/` | Full vertical with mock GaleCore | ~30 |
| Evals | `pytest tests/evals/` | 10 golden cases, all three paths | 10 |
| Local real | Start both services + curl | Real GaleCore + real/fake provider | — |

## Three Paths Exercised by the Autonomous Adapter

| Path | Status | Result | Model Called | Evidence |
|------|--------|--------|-------------|----------|
| SUCCESS | `SUCCESS` | non-null | true | `trace.guardrails_executed` all passed |
| INSUFFICIENT_DATA | `INSUFFICIENT_DATA` | null | false | `trace.error` explains why |
| VALIDATION_ERROR | `VALIDATION_ERROR` | null | true | `trace.guardrails_executed` shows failure |
