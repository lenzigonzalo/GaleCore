# Interactive E2E — Increment 4 schema (generated)

**Generated:** 2026-09-16T19:42:11.214524+00:00 · **Tool:** `tools/e2e_interactive_cases.py` · **GaleCore:** `http://localhost:5000`
**run_id:** `01a0abad-626d-7e01-b1c2-2c7fc000aede` · **conventions_hash:** `sha256:4213a153871c18d4cb1ec82020d1694dd0a0200e3ebecc7eb202bd789dd7a708` · **facts_hash:** `sha256:08970f5a2650c61a84fa2a92be49d185b28615496fc56401a4e61f66b70f1817`

Facts used: symbol=SPY, net_gex=-1530.8, call_gex=707598.8531, put_gex=-2238392.5174, spot=750.43, zero_gamma_level=765.84, call_wall=770.0, put_wall=750.0, freshness_status=VALID

One JSON artifact per case in this folder: exact stdin payload, stdout (parsed), exit code, failed guardrails.

| Case | Scenario | Expected | Exit | Status | Failed guardrails | Error (truncated) |
|---|---|---|---|---|---|---|
| P0-prepare | prepare against live GaleCore (view captured earlier, same session) | exit 0, view with facts + hashes | 0 | — | — |  |
| P1-positive | valid negative_gamma interpretation (host-authored) | exit 0, SUCCESS, result == input | 0 | SUCCESS | — |  |
| N01-invented-number | 999.99 in an observation | VALIDATION_ERROR (no_invented_numbers, no_numbers_in_prose) | 3 | VALIDATION_ERROR | no_invented_numbers, no_numbers_in_prose | Guardrail failure: no_invented_numbers: Number 999.99 in interpretation not found in known facts; no_numbers_i |
| N02-invalid-evidence-path | evidence fact_path=facts.nonexistent | VALIDATION_ERROR (facts_match_source) | 3 | VALIDATION_ERROR | facts_match_source | Guardrail failure: facts_match_source: Unknown fact path: facts.nonexistent |
| N03-sign-contradiction | regime=positive_gamma against net_gex=-1530.8 | VALIDATION_ERROR (gex_regime_sign) | 3 | VALIDATION_ERROR | gex_regime_sign | Guardrail failure: gex_regime_sign: positive_gamma requires net_gex > 0, got -1530.8 |
| N04-empty-limitations | limitations=[] | VALIDATION_ERROR (schema min_length) | 3 | VALIDATION_ERROR | — | Guardrail failure: 1 validation error for GexInterpretation limitations List should have at least 1 item after |
| N05-trading-rec-en | 'Consider buying puts on SPY' | VALIDATION_ERROR (no_trading_recommendation) | 3 | VALIDATION_ERROR | no_trading_recommendation | Guardrail failure: no_trading_recommendation: Trading recommendation detected in implications: 'Consider buyin |
| N06-nonexistent-run-id | unknown run_id | VALIDATION_ERROR (snapshot not found) | 3 | VALIDATION_ERROR | snapshot_lookup | Snapshot not found or expired: Snapshot not found: 01a0a7bc-0fc3-7a41-9fcf-73ec491249c3 |
| N07-malformed-json | stdin 'not json' | error JSON, exit 3 | 3 | — | — | Invalid JSON input: Expecting value: line 1 column 1 (char 0) |
| N08-missing-symbol | prepare without --symbol | error JSON, exit 3 | 3 | — | — | Argument error: the following arguments are required: --symbol |
| N09-expired-snapshot | TTL=2s, accept after 3s | VALIDATION_ERROR (snapshot expired) | 3 | VALIDATION_ERROR | snapshot_lookup | Snapshot not found or expired: Snapshot expired (age=4s, ttl=2s): 01a0abbf-5ee8-7872-81c7-cab7a7f68d62 |
| N10-missing-asset | trading-agent.yaml absent during prepare | error JSON, non-zero exit | 1 | — | — | Required asset missing: Required agent asset not found: C:\Users\lenzi\OneDrive\Escritorio\GaleCore\GaleCore-A |
| N11-empty-stdin | accept with empty stdin | error JSON, non-zero exit | 3 | — | — | Invalid JSON input: Expecting value: line 1 column 1 (char 0) |
| N12-mixed-evidence | one valid + one invalid evidence path | VALIDATION_ERROR (facts_match_source) | 3 | VALIDATION_ERROR | facts_match_source | Guardrail failure: facts_match_source: Unknown fact path: facts.nonexistent |
| N13-wrong-metric | net_gex value claimed as metric=put_wall/usd | VALIDATION_ERROR (quantitative_claims_valid) | 3 | VALIDATION_ERROR | quantitative_claims_valid | Guardrail failure: quantitative_claims_valid: Claim[0]: metric 'put_wall' value -1530.8 does not match fact 75 |
| N14-near-zero | regime=near_zero on real data | VALIDATION_ERROR (gex_regime_sign, incompatible scales) | 3 | VALIDATION_ERROR | gex_regime_sign | Guardrail failure: gex_regime_sign: near_zero validation unavailable: GaleCore call_gex/put_gex and net_gex us |
| N15-number-in-prose | fact value written in an observation | VALIDATION_ERROR (no_numbers_in_prose) | 3 | VALIDATION_ERROR | no_numbers_in_prose | Guardrail failure: no_numbers_in_prose: Number(s) ['-1530.8'] found in prose: 'Net GEX is -1530.8, dealers pos |
| N16-conventions-mutated | resolved_conventions edited in the store after prepare | INTERNAL_ERROR (conventions_hash mismatch), no cognitive checks | 1 | INTERNAL_ERROR | snapshot_integrity | Internal conventions_hash mismatch — resolved conventions changed after prepare |
| N21-outer-timestamp-mutated | snapshot.market_data_as_of edited; hashed facts unchanged | INTERNAL_ERROR (market_data_as_of mismatch) | 1 | INTERNAL_ERROR | snapshot_integrity | Internal market_data_as_of mismatch — snapshot metadata disagrees with the hashed facts |
| N17-trading-rec-es | 'Recomendamos vender puts de SPY' | VALIDATION_ERROR (no_trading_recommendation) | 3 | VALIDATION_ERROR | no_trading_recommendation | Guardrail failure: no_trading_recommendation: Trading recommendation detected in implications: 'vender puts' |
| N18-omitted-claims | quantitative_claims omitted entirely | VALIDATION_ERROR (schema: field required) | 3 | VALIDATION_ERROR | — | Guardrail failure: 1 validation error for GexInterpretation quantitative_claims Field required [type=missing,  |
| N19-hold-directive | 'Hold SPY shares through the event' | VALIDATION_ERROR (no_trading_recommendation) | 3 | VALIDATION_ERROR | no_trading_recommendation | Guardrail failure: no_trading_recommendation: Trading recommendation detected in implications: 'Hold SPY' |
| N20-rescaled-claim | net_gex -1530.8 claimed as -1.5308 | VALIDATION_ERROR (quantitative_claims_valid) | 3 | VALIDATION_ERROR | no_invented_numbers, quantitative_claims_valid | Guardrail failure: no_invented_numbers: Number -1.5308 in interpretation not found in known facts; quantitativ |

All 23 cases matched their expected exit code, status and guardrails.
