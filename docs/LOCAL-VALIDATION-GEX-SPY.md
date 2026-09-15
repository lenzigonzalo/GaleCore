# Local Validation: GEX-SPY Cognitive Vertical

## Prerequisites

1. **GaleCore** (.NET) running on `http://localhost:5000` with Tastytrade session active
2. **GaleCore-AI** (Python) dependencies installed
3. (Optional) `ANTHROPIC_API_KEY` for real model provider

## Quick Start — FakeProvider (Deterministic)

```powershell
cd GaleCore-AI

# Install dependencies
pip install -e ".[dev]"

# Run tests (172 tests, all deterministic)
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
cd GaleCore/DataFeed.Api
dotnet run

# Start GaleCore-AI with Anthropic
$env:PROVIDER_MODE = "anthropic"
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:ANTHROPIC_MODEL = "claude-sonnet-4-6"
$env:LOCAL_VALIDATION = "true"
$env:GALECORE_BASE_URL = "http://localhost:5000"
python -m uvicorn galecore_ai.api.app:create_app --factory --port 8100

# Run analysis
Invoke-RestMethod -Uri http://localhost:8100/api/v1/agent-runs/gex-analysis `
    -Method POST `
    -ContentType "application/json" `
    -Body '{"symbol": "SPY"}'
```

## Expected Results

### SUCCESS case
```json
{
  "run_id": "...",
  "status": "SUCCESS",
  "result": {
    "regime": "positive_gamma",
    "observations": ["Net GEX is positive..."],
    "implications": ["Mean reversion expected..."],
    "caveats": ["Based on current snapshot..."]
  },
  "trace": {
    "provider": "anthropic",
    "skills_used": ["gex_interpretation"],
    "protocols_used": ["facts_discipline"],
    "capabilities_invoked": [{"capability_id": "compute.gamma_exposure", "ok": true}],
    "input_tokens": 1234,
    "output_tokens": 567
  }
}
```

### INSUFFICIENT_DATA case (GaleCore not running)
```json
{
  "run_id": "...",
  "status": "INSUFFICIENT_DATA",
  "result": null,
  "error_detail": "Capability fetch failed: HTTP error calling compute.gamma_exposure: ...",
  "trace": {
    "capabilities_invoked": [{"capability_id": "compute.gamma_exposure", "ok": false}]
  }
}
```

## Security: LOCAL_VALIDATION mode

When `LOCAL_VALIDATION=true` (default), the `GALECORE_BASE_URL` is restricted to localhost only. Any attempt to point to a remote URL will fail at startup:

```
ValueError: LOCAL_VALIDATION=true but GALECORE_BASE_URL points to 'api.example.com'.
Only localhost is allowed in local validation mode.
```

## Test Levels

| Level | Command | What it tests |
|-------|---------|---------------|
| Unit | `pytest tests/unit/` | All components in isolation |
| Contract | `pytest tests/contract/` | Pydantic roundtrip serialization |
| Integration | `pytest tests/integration/` | Full vertical with mock GaleCore |
| Local real | Start both services + curl | Real GaleCore + real/fake provider |
