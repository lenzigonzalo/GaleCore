# Phase 3 — GEX Interactive E2E Evidence

**Date:** 2026-09-16 13:08–13:15 UTC
**Base:** working tree on `main` (HEAD bbbc5a7 + uncommitted Phase 3 closure changes)
**Host:** Claude Code (claude-opus-4-6), manual interpretation
**GaleCore:** localhost:5000, Tastytrade session active

## Configuration (non-secret)

```
GALECORE_BASE_URL=http://localhost:5000
ALLOW_UNKNOWN_FRESHNESS=true
MAX_STALENESS_SECONDS=600
SNAPSHOT_TTL_SECONDS=3600 (default)
LOCAL_VALIDATION=true (default)
```

## Effective assets

| Asset | ID | Version | Content hash |
|---|---|---|---|
| Agent | TradingAgent | 1.0.0 | sha256:df497bd6596375901b8598f5eceff9a7028e3a3c189fe8f7f0b461d32e379bb5 |
| Skill | gex_interpretation | 1.2.0 | sha256:2827b87d9fdcece46ed8b9b44bd5655a0e1fc2bea33c4cf6ea2c0d671ab5e12c |
| Protocol | facts_discipline | 1.1.0 | sha256:2d71a5a6911d5326e65c247f0feb38c3948a89dac81a7dd8493f63078a5d997d |
| Convention | trading_defaults | 1.0.0 | sha256:ab936208eac8f56555f1825d20c6fc4781485c52008d9c0c9d441ff67963442d |

## Step 1 — Prepare

```bash
GALECORE_BASE_URL=http://localhost:5000 \
GALECORE_API_KEY=<redacted> \
ALLOW_UNKNOWN_FRESHNESS=true \
MAX_STALENESS_SECONDS=600 \
python -B -m galecore_ai.adapters.cli prepare --symbol SPY
```

### Sanitized output

```json
{
  "run_id": "01a0aa55-aaa9-7d61-8f81-93cf03a731ac",
  "symbol": "SPY",
  "facts": {
    "symbol": "SPY",
    "net_gex": -1040.5,
    "call_gex": 938352.4989,
    "put_gex": -1978829.6099,
    "spot": 759.28,
    "zero_gamma_level": 764.8,
    "call_wall": 765.0,
    "put_wall": 750.0,
    "expirations_included": 15,
    "expirations_requested": 15,
    "coverage_pct": 100.0,
    "market_data_as_of": "2026-09-16T13:08:56.011976Z",
    "freshness_status": "VALID",
    "from_cache": false
  },
  "facts_hash": "sha256:f198128d25e73f9a604e3cd5ef2d7206a59d121d8c9ac3355530641d592877a8",
  "prepared_at": "2026-09-16T13:08:56.105539Z",
  "freshness_status": "VALID",
  "freshness_max_age_seconds": 600.0,
  "effective_assets": { "...see table above..." }
}
```

Exit code: 0

## Step 2 — Host interpretation

The host (Claude Code) read the facts and produced:

```json
{
  "regime": "negative_gamma",
  "observations": [
    "Net GEX is -1040.5, indicating dealers are net short gamma",
    "Spot at 759.28 is below the zero-gamma level of 764.8"
  ],
  "implications": [
    "Dealer hedging activity is expected to amplify price moves in both directions"
  ],
  "evidence": [
    {"fact_path": "facts.net_gex", "claim": "Net GEX is -1040.5"},
    {"fact_path": "facts.spot", "claim": "Spot at 759.28"},
    {"fact_path": "facts.zero_gamma_level", "claim": "Zero-gamma level of 764.8"}
  ],
  "limitations": [
    "Point-in-time snapshot of open interest; dealer positioning may shift with new flow"
  ]
}
```

## Step 3 — Accept

```bash
echo '<payload with run_id + interpretation + host_provider + host_model>' | \
  ALLOW_UNKNOWN_FRESHNESS=true python -B -m galecore_ai.adapters.cli accept
```

### Acceptance result (sanitized)

- **status:** SUCCESS
- **exit code:** 0
- **result:** interpretation as submitted (no modification)
- **trace.facts_hash:** sha256:f198128d... (matches prepare)
- **trace.prepared_at:** 2026-09-16T13:08:56.105539Z
- **trace.accepted_at:** 2026-09-16T13:11:15.576956Z
- **trace.facts_provenance:** GALECORE_VERIFIED
- **trace.provider:** HOST_DECLARED:claude-code
- **trace.model:** HOST_DECLARED:claude-opus-4-6
- **trace.validator_called_model:** false
- **trace.host_model_execution:** HOST_DECLARED
- **trace.agent_definition:** TradingAgent v1.0.0
- **trace.skills:** gex_interpretation v1.2.0
- **trace.protocols:** facts_discipline v1.1.0
- **trace.conventions:** trading_defaults v1.0.0
- **trace.capabilities_invoked:** compute.gex_analysis via REST, 95125ms, outcome=ok
- **trace.freshness:** VALID, age=139.6s
- **trace.guardrails_executed:**
  - no_invented_numbers: passed
  - facts_match_source: passed
  - no_trading_recommendation: passed
  - gex_regime_sign: passed

## Negative cases

All executed against the same GaleCore session on 2026-09-16.

| # | Case | Command variation | Exit | Status | result | Key error |
|---|---|---|---|---|---|---|
| 1 | Invented number (999.99) | observations contain 999.99 | 3 | VALIDATION_ERROR | null | no_invented_numbers |
| 2 | Invalid evidence path | fact_path=facts.nonexistent | 3 | VALIDATION_ERROR | null | facts_match_source |
| 3 | Sign contradiction | regime=positive_gamma, net_gex<0 | 3 | VALIDATION_ERROR | null | gex_regime_sign |
| 4 | Empty limitations | limitations=[] | 3 | VALIDATION_ERROR | null | schema min_length |
| 5 | Trading recommendation (EN) | "Consider buying puts on SPY" | 3 | VALIDATION_ERROR | null | no_trading_recommendation |
| 6 | Nonexistent run_id | random valid UUID | 3 | VALIDATION_ERROR | null | Snapshot not found |
| 7 | Malformed JSON | "not json" | 3 | error JSON | N/A | Invalid JSON input |
| 8 | Missing --symbol | prepare without --symbol | 3 | error JSON | N/A | Argument error |
| 9 | Expired snapshot | TTL=2s, waited >2s | 3 | VALIDATION_ERROR | null | Snapshot expired |
| 10 | Missing required asset | trading-agent.yaml renamed | 1 | error JSON | N/A | Required agent asset not found |
| 11 | Empty stdin | no input piped to accept | non-zero | error JSON | N/A | CLI parse |
| 12 | Mixed valid + invalid evidence | one valid + one invalid path | 3 | VALIDATION_ERROR | null | facts_match_source |
| 13 | Value from wrong field | spot cited as net_gex | 3 | VALIDATION_ERROR | null | facts_match_source |

All 13 negatives produced structured JSON on stdout with the expected exit code. No tracebacks.

**Note (F-07 reconciliation):** Increment 1 E2E evidence documented 10 negative cases. Cases 11–13 were tested via unit/integration tests but not listed in the evidence table. They are now included for completeness.

## What this evidence proves

- The prepare/accept boundary works end-to-end with real GaleCore data.
- The acceptance trace contains: run_id, facts_hash, prepared_at, accepted_at (internal), facts_provenance (GALECORE_VERIFIED), all effective asset IDs/versions/hashes, capability trace, freshness, guardrails, and HOST_DECLARED provider/model.
- The host cannot inject provenance, hashes, or timestamps — the validator recovers these from its internal store.
- Deterministic guardrails catch: invented numbers, ungrounded evidence, sign contradictions, empty limitations, explicit trading recommendations, and various input errors.
- All error paths produce structured JSON — no unstructured stderr output as sole response.

## What this evidence does not prove

- **Model quality**: the host generated a manual interpretation, not a validator-invoked model call (validator_called_model=false; host_model_execution=HOST_DECLARED).
- **Asset compliance**: asset hashes prove what was loaded, not that the host read or obeyed the instructions.
- **Semantic entailment**: free-text claims in observations/implications are not verified for meaning.
- **Near-zero magnitude**: not validated at all; the regime is rejected fail-closed because GaleCore's call/put_gex and net_gex scales are incompatible.
- **Note**: this E2E predates Increment 4. The interpretation format it records (numbers inside observations, no `quantitative_claims`) is no longer accepted; the positive case must be re-run against the new contract before this evidence certifies AC-05 for the current code.
- **Novel trading recommendations**: the guardrail is pattern-based; indirect or novel phrasings may bypass it.
- **Persistence**: the snapshot store is ephemeral in $TEMP; traces are not durably stored.
- **Filesystem isolation**: a process with access to the same OS user can modify the store directly. The store is an MVP for a cooperative host, not a security isolation boundary.

## Limitations of this evidence

- Single execution session; not replicated across multiple environments.
- GaleCore was running with a Tastytrade session but market data freshness depends on exchange hours.
- The working tree has uncommitted changes — this is not a tagged release.
- The host identity (claude-code / claude-opus-4-6) is HOST_DECLARED; the validator did not verify it.
