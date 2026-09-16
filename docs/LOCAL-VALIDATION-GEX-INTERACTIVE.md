# Local Validation: GEX-SPY Interactive Host E2E

> **Phase 3 Definition of Done evidence.** Real interactive host (Claude Code) → real GaleCore GEX-SPY → versioned assets → structured interpretation → deterministic assurance → SUCCESS + fail-closed negatives.

## Prerequisites

1. **GaleCore** (.NET) running on `http://localhost:5000` with Tastytrade session active
2. **GaleCore-AI** (Python) dependencies installed: `pip install -e ".[dev]"`
3. An interactive host capable of reading facts and producing a `GexInterpretation` JSON (Claude Code, Claude Work, or equivalent)

## Step 1 — Prepare snapshot

Fetch live GEX data from GaleCore and produce an immutable identified snapshot:

```powershell
$env:GALECORE_BASE_URL = "http://localhost:5000"
$env:GALECORE_API_KEY = "dev-local-key"
$env:ALLOW_UNKNOWN_FRESHNESS = "true"
$env:MAX_STALENESS_SECONDS = "600"
python -B -m galecore_ai.adapters.cli prepare --symbol SPY
```

Output: `PreparedSnapshot` JSON with `run_id`, `facts`, `facts_hash`, timestamps, `capability_trace`, and `effective_assets` (hashes of loaded YAML definitions).

### Example output (2026-09-16 real GaleCore)

```json
{
  "run_id": "01a0a7bc-0fc3-7a41-9fcf-73ec491249c3",
  "symbol": "SPY",
  "facts": {
    "symbol": "SPY",
    "net_gex": -1802.1,
    "call_gex": 1074352.7153,
    "put_gex": -2876437.9608,
    "spot": 758.22,
    "zero_gamma_level": 764.86,
    "call_wall": 765.0,
    "put_wall": 758.0,
    "expirations_included": 16,
    "expirations_requested": 16,
    "coverage_pct": 100.0,
    "market_data_as_of": "2026-09-16T01:01:54.878982Z",
    "freshness_status": "VALID",
    "from_cache": false
  },
  "facts_hash": "sha256:d864b84fb8514f2c14e5512579ac8faf808b1a00f2defb199ce62931c794b599",
  "freshness_status": "VALID",
  "freshness_max_age_seconds": 600.0,
  "effective_assets": {
    "agent_hash": "sha256:df497bd...",
    "skill_hashes": { "gex_interpretation": "sha256:2827b87..." },
    "protocol_hashes": { "facts_discipline": "sha256:2d71a5a..." },
    "convention_hashes": { "trading_defaults": "sha256:ab93620..." }
  }
}
```

## Step 2 — Host generates interpretation

The host (Claude Code in this case) reads the snapshot facts and produces a structured `GexInterpretation`:

```json
{
  "regime": "negative_gamma",
  "observations": [
    "Net GEX is -1802.1, indicating dealers are net short gamma",
    "Spot at 758.22 is below the zero-gamma level of 764.86"
  ],
  "implications": [
    "Dealer hedging activity is expected to amplify price moves"
  ],
  "evidence": [
    {"fact_path": "facts.net_gex", "claim": "Net GEX is -1802.1"},
    {"fact_path": "facts.spot", "claim": "Spot at 758.22"},
    {"fact_path": "facts.zero_gamma_level", "claim": "Zero-gamma level of 764.86"}
  ],
  "limitations": [
    "Point-in-time snapshot of open interest"
  ]
}
```

**Rules:** every number must come from facts; every evidence path must resolve to a scalar; regime sign must match net_gex sign.

## Step 3 — Accept interpretation

Pipe the snapshot and interpretation into the accept command:

```powershell
@"
{
  "snapshot": <paste snapshot JSON>,
  "interpretation": <paste interpretation JSON>,
  "host_provider": "claude-code",
  "host_model": "claude-opus-4-6"
}
"@ | python -B -m galecore_ai.adapters.cli accept
```

Or programmatically:

```python
from galecore_ai.application.accept_interpretation import accept_gex_interpretation
from galecore_ai.contracts.prepared_analysis import AcceptanceRequest, PreparedSnapshot

snapshot = PreparedSnapshot.model_validate_json(snapshot_json)
request = AcceptanceRequest(
    run_id=snapshot.run_id,
    interpretation=interpretation_dict,
    host_provider="claude-code",
    host_model="claude-opus-4-6",
)
result = accept_gex_interpretation(
    snapshot=snapshot,
    request=request,
    allow_unknown_freshness=True,
)
```

## Step 4 — Verify

### SUCCESS case

```json
{
  "status": "SUCCESS",
  "result": { "regime": "negative_gamma", ... },
  "trace": {
    "provider": "HOST_DECLARED:claude-code",
    "model": "HOST_DECLARED:claude-opus-4-6",
    "model_called": true,
    "guardrails_executed": [
      {"guardrail_id": "no_invented_numbers", "passed": true},
      {"guardrail_id": "facts_match_source", "passed": true},
      {"guardrail_id": "gex_regime_sign", "passed": true}
    ],
    "freshness": { "freshness_status": "VALID" }
  }
}
```

### Negative cases (all result=null)

| Scenario | Expected status | Guardrail / check |
|---|---|---|
| Number not in facts (e.g. 999.99) | `VALIDATION_ERROR` | `no_invented_numbers` |
| Invalid evidence path (e.g. `facts.nonexistent`) | `VALIDATION_ERROR` | `facts_match_source` |
| Sign contradiction (positive_gamma + negative net_gex) | `VALIDATION_ERROR` | `gex_regime_sign` |
| Missing evidence array | `VALIDATION_ERROR` | `facts_match_source` |
| run_id mismatch | `VALIDATION_ERROR` | pre-guardrail |
| Tampered facts_hash | `VALIDATION_ERROR` | pre-guardrail |
| Stale snapshot (expired by acceptance time) | `INSUFFICIENT_DATA` | freshness re-check |

All seven negatives were verified on 2026-09-16 against real GaleCore data.

## What this proves and what it does not

**Proves:**
- The prepare/accept boundary works with real GaleCore data
- Deterministic assurance catches invented numbers, ungrounded evidence, sign contradictions, malformed output, integrity violations, and freshness expiration
- The host is Claude Code (no Anthropic API key needed)
- Cognitive assets (agent, skill, protocol, conventions) are loaded from canonical YAML with content hashes in the snapshot

**Does not prove:**
- Model quality or specialization (the host generated a manual interpretation, not a model call)
- That the host obeys the cognitive assets (hash proves what was loaded, not compliance)
- Semantic entailment of free-text prose
- Near-zero magnitude validation (methodology unresolved)
- Persistent trace storage
- That `from_cache: false` means data is live (GaleCore internal caching is opaque)

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GALECORE_BASE_URL` | `http://localhost:5000` | GaleCore API URL |
| `GALECORE_API_KEY` | — | Must match GaleCore user-secrets `ApiKey` |
| `LOCAL_VALIDATION` | `true` | Restrict to localhost |
| `MAX_STALENESS_SECONDS` | `300` | Max age before rejection |
| `ALLOW_UNKNOWN_FRESHNESS` | `false` | Accept data without timestamp |
| `GALECORE_TIMEOUT_SECONDS` | `120` | HTTP timeout for prepare |
