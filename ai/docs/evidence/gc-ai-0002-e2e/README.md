# Regime loop E2E — GC-AI-0002 (generated)

**Generated:** 2026-09-21T15:46:22.273740+00:00 · **Tool:** `tools/e2e_regime_cases.py` · **GaleCore:** `http://localhost:5000`
**run_id:** `01a0c4a2-4541-7cb3-ab06-259d006f2758` · **facts_hash:** `sha256:67eeed633b36e2ae1c5341a561e5522aebb48cda91c96f08d61c82dd6664d1d6` · **conventions_hash:** `sha256:4213a153871c18d4cb1ec82020d1694dd0a0200e3ebecc7eb202bd789dd7a708` · **MAX_STALENESS_SECONDS:** 36000
**Records dir:** temporary, deleted after the run (this runner never writes to GaleCore/research/regime). P1 record path during the run: `<tmp>\gc-ai-0002-e2e-wa5ifdh7\SPY\2026-09-21.md`

Facts used: symbol=SPY, net_gex=728.4, spot=770.4, put_skew_ratio=1.0829, atm_iv=0.1387, put_wing_iv=0.1502, put_skew_level_ok=True, vix=14.88, vvix=86.36, freshness_status=UNKNOWN
Per-source freshness: gex=VALID, put_skew=UNKNOWN, vix=VALID, vvix=VALID

One JSON artifact per case in this folder: exact stdin payload, stdout (parsed), exit code, failed guardrails.
Sanitized: errors cut to their first line, absolute paths replaced by <repo>/<tmp>/<home>, no API key.
P3 is a runner-authored review (mechanics only); P2 is an outcome fetched seconds after acceptance.

| Case | Scenario | Expected | Exit | Status | Failed guardrails | Record | Error (truncated) |
|---|---|---|---|---|---|---|---|
| P1-accept-record | host-authored positive_gamma/calm interpretation accepted and recorded | exit 0, SUCCESS, result == input, record RECORDED | 0 | SUCCESS | — | RECORDED |  |
| P2-record-outcome | later facts attached to the recorded entry (T+seconds; mechanics only) | exit 0, RECORDED, entry_ids=[run_id] | 0 | RECORDED | — | — |  |
| P3-record-review | review appended to the recorded entry (runner-authored, NOT a human verdict) | exit 0, RECORDED | 0 | RECORDED | — | — |  |
| P4-query | read the record back: what was said, facts, outcome, review | exit 0, no INTEGRITY_FAILED, the run appears with 1 outcome and 1 review | 0 | — | — | — |  |
| N01-stale-source | prepare regime with MAX_STALENESS_SECONDS=1 | error JSON 'stale for source(s)', exit 1 | 1 | — | — | — | Data is stale for source(s) ['gex', 'vix', 'vvix'] (max 1s) |
| N02-missing-source | prepare regime for symbol ZZZZ | error JSON 'Capability fetch failed' or 'Fact validation failed', exit 1 | 1 | — | — | — | Capability fetch failed: gex: HTTP 500: System.Exception: GammaExposureHandler Error: No se pudo obt |
| N03-rejected-not-recorded | tail_pricing=elevated contradicts put_skew_level_ok=True, with --record | exit 3, VALIDATION_ERROR (tail_pricing_level), record NOT_RECORDED, no file | 3 | VALIDATION_ERROR | tail_pricing_level | NOT_RECORDED | Guardrail failure: tail_pricing_level: tail_pricing 'elevated' contradicts put_skew_level_ok=True (e |
| N04-gamma-sign | gamma_regime=negative_gamma against net_gex=728.4 | exit 3, gex_regime_sign | 3 | VALIDATION_ERROR | gex_regime_sign | — | Guardrail failure: gex_regime_sign: negative_gamma requires net_gex < 0, got 728.4 |
| N05-rounded-skew-claim | put_skew_ratio 1.0829 claimed as 1.08 | exit 3, quantitative_claims_valid | 3 | VALIDATION_ERROR | no_invented_numbers, quantitative_claims_valid | — | Guardrail failure: no_invented_numbers: Number 1.08 in interpretation not found in known facts; quan |
| N06-number-in-prose-es | fact value written in a Spanish observation | exit 3, no_numbers_in_prose | 3 | VALIDATION_ERROR | no_numbers_in_prose | — | Guardrail failure: no_numbers_in_prose: Number(s) ['14.88'] found in prose: 'El VIX está en 14.88 y  |
| N07-trading-rec-es | 'Conviene comprar puts de SPY' | exit 3, no_trading_recommendation | 3 | VALIDATION_ERROR | no_trading_recommendation | — | Guardrail failure: no_trading_recommendation: Trading recommendation detected in implications: 'Conv |
| N08-gex-payload-on-regime | GexInterpretation shape submitted for a regime run | exit 3, schema rejection | 3 | VALIDATION_ERROR | — | — | Guardrail failure: 3 validation errors for RegimeInterpretation |
| N09-record-without-prompt | accept --record without --prompt | exit 3, argument error | 3 | — | — | — | Argument error: --record requires a non-empty --prompt |
| N10-tampered-record-query | accepted payload edited in a copy of the record file | exit 3, INTEGRITY_FAILED with entry_hash mismatch, not skipped | 3 | — | — | — |  |
| N11-review-on-tampered | record review against the tampered copy | exit 1, 'cannot be trusted' | 1 | — | — | — | Record cannot be trusted; not modifying: <tmp>\gc-ai-0002-e2e-neg-8y7rqvsr\SPY\2026-09-21.md: entry  |
| N12-review-unknown-run | record review with unknown run_id on the P1 record | exit 1, 'not found' | 1 | — | — | — | run_id 01a0a7bc-0fc3-7a41-9fcf-73ec491249c3 not found in SPY 2026-09-21 |

All 16 cases matched their expected exit code, status, guardrails and record outcome.
