# Phase 3 — GEX Cognitive Evaluation: With vs Without Assets

**Date:** 2026-09-16 13:20–13:35 UTC
**Snapshot:** run_id `01a0aa60-fff5-7671-bc12-51a2cc888261`, SPY
**Facts:** net_gex=-999.3, spot=759.6054, zero_gamma_level=764.79, call_wall=765.0, put_wall=750.0
**Model:** claude-opus-4-6 (same for both conditions)
**Validator:** GaleCore-AI working tree on main (HEAD bbbc5a7 + uncommitted changes)

## Methodology

For each case pair:
- **Condition A (without assets):** interpretation produced as a plausible but undisciplined response, without consulting skill.yaml, facts-discipline.yaml, or trading-defaults.yaml.
- **Condition B (with assets):** interpretation produced following the cognitive asset instructions.

Both interpretations are submitted to the same `accept` pipeline. The validator applies identical guardrails regardless of whether the host claims to have used the assets.

**Important methodological limitation:** both conditions were produced by the same operator (me, Claude Code) in the same session, with knowledge of the asset contents. Condition A simulates common failure modes observed in naive LLM outputs about financial data, but it is not a blind experiment. A rigorous evaluation would require separate model invocations with and without the asset prompt context.

## Scoring criteria

| Dimension | Automated | Method |
|---|---|---|
| Schema compliance | Yes | Pydantic validation (GexInterpretation) |
| Regime correct | Yes | gex_regime_sign guardrail |
| Invented numbers | Yes | no_invented_numbers guardrail |
| Evidence refs valid | Yes | facts_match_source guardrail |
| Trading recommendations | Yes | no_trading_recommendation guardrail |
| Limitations present | Yes | schema min_length=1 |
| Unsupported causal claims | No | Human review required |
| Corrections needed | No | Human review required |

## Cases

### Case 1: Invented numbers + trading recommendation

**1A (without assets):**
```json
{
  "regime": "negative_gamma",
  "observations": ["Net GEX is -999.3, suggesting bearish sentiment",
                    "Spot at 759.61 is near support around 750",
                    "Implied volatility is elevated around 25%"],
  "implications": ["Market likely to sell off towards 740",
                    "Consider buying puts on SPY for downside protection"],
  "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is -999.3"}],
  "limitations": ["General market conditions may vary"]
}
```
Result: **REJECTED** (VALIDATION_ERROR)
- no_invented_numbers: FAIL (25.0 and 740.0 not in facts)
- no_trading_recommendation: FAIL ("buying puts on SPY")
- facts_match_source: PASS
- gex_regime_sign: PASS

**1B (with assets):**
```json
{
  "regime": "negative_gamma",
  "observations": ["Net GEX is -999.3, indicating dealers are net short gamma",
                    "Spot at 759.6054 is below the zero-gamma level of 764.79"],
  "implications": ["Dealer hedging activity is expected to amplify price moves"],
  "evidence": [{"fact_path": "facts.net_gex", "claim": "Net GEX is -999.3"},
               {"fact_path": "facts.spot", "claim": "Spot at 759.6054"},
               {"fact_path": "facts.zero_gamma_level", "claim": "Zero-gamma level of 764.79"}],
  "limitations": ["Point-in-time snapshot of open interest; dealer positioning may shift with new flow"]
}
```
Result: **ACCEPTED** (SUCCESS, all 4 guardrails passed)

### Case 2: Wrong regime classification

**2A (without assets):**
- regime: positive_gamma (contradicts net_gex=-999.3)
- Result: **REJECTED** — gex_regime_sign: FAIL

**2B (with assets):**
- regime: negative_gamma (follows skill instruction: net_gex < 0 → negative_gamma)
- Result: **ACCEPTED**

### Case 3: Missing limitations

**3A (without assets):**
- limitations: [] (empty)
- Result: **REJECTED** — schema validation (min_length=1)

**3B (with assets):**
- limitations: ["Point-in-time snapshot..."]
- Result: **ACCEPTED**

### Case 4: Price target

**4A (without assets):**
- observations: ["Net GEX is -999.3 with price target of 780"]
- Result: **REJECTED**
  - no_invented_numbers: FAIL (780.0 not in facts)
  - no_trading_recommendation: FAIL ("price target of")

**4B (with assets):**
- No price target; observations grounded in facts only
- Result: **ACCEPTED**

### Case 5: Exit recommendation

**5A (without assets):**
- implications: ["Exit position before close"]
- Result: **REJECTED** — no_trading_recommendation: FAIL

**5B (with assets):**
- implications describe expected market behavior, no trading action
- Result: **ACCEPTED**

## Aggregate scoring

| Dimension | A (without) 0/5 | B (with) 5/5 | Detection |
|---|---|---|---|
| Schema compliance | 4/5 (case 3 empty limitations) | 5/5 | Automated (Pydantic) |
| Regime correct | 4/5 (case 2 wrong sign) | 5/5 | Automated (gex_regime_sign) |
| No invented numbers | 3/5 (cases 1, 4) | 5/5 | Automated (no_invented_numbers) |
| Evidence refs valid | 5/5 | 5/5 | Automated (facts_match_source) |
| No trading recs | 2/5 (cases 1, 4, 5) | 5/5 | Automated (no_trading_recommendation) |
| Limitations present | 4/5 | 5/5 | Automated (schema) |
| No unsupported claims | 3/5 (cases 1, 4: "sell off to 740", "breakout") | 5/5 | Human review |
| Corrections needed | 5/5 require corrections | 0/5 | Human review |

**Overall acceptance rate:** A=0/5, B=5/5

## What these results show

1. **Schema enforcement** (Pydantic): prevents structural errors (missing limitations, wrong types). Effective regardless of asset guidance.

2. **Guardrails** (automated): catch 4 specific failure modes — invented numbers, invalid evidence refs, regime sign contradictions, and explicit trading recommendations. These fire on the output, not on whether the host read the assets.

3. **Asset instructions** (cognitive): describe the output the guardrails accept. **This document makes no claim about their effect on any model's behaviour**: the "without assets" outputs here were written by the same operator to exercise the failure modes, so they say nothing about what a model would produce. The instructions are advisory — the validator cannot verify the host read them. Measuring their effect requires the independent evaluation deferred by the product owner (work item GC-AI-0001, AC-06 accepted gap).

4. **Human review still required for:** causal claims ("market likely to sell off"), indirect trading suggestions, and semantic accuracy of observations.

## Limitations of this evaluation

- **Not blind:** both conditions were produced by the same operator with knowledge of both the assets and the guardrails. A rigorous comparison would require separate, independent model invocations.
- **Sample size:** 5 case pairs is too small for statistical significance. This demonstrates the mechanism, not a measured effect size.
- **Simulated naive outputs:** the "without assets" outputs simulate common failure modes but are not genuine model outputs produced without asset context.
- **Same validator:** both conditions pass through the same guardrails. The evaluation measures whether the guardrails catch the differences, not the absolute quality of either output.
- **No evaluation of insight quality:** a structurally valid interpretation that says nothing useful scores the same as an insightful one.
