# GEX Interpretation Skill — Instructions

## What you receive

A `GexFacts` object with deterministic data from GaleCore's `compute.gex_analysis` capability:

| Field                  | Type     | Description                                    |
|------------------------|----------|------------------------------------------------|
| `symbol`               | string   | Ticker symbol (e.g. "SPY")                     |
| `net_gex`              | float    | Net gamma exposure, billions USD (claimable)   |
| `call_gex`             | float    | Gamma exposure from calls — unit not published by GaleCore, not claimable |
| `put_gex`              | float    | Gamma exposure from puts — unit not published by GaleCore, not claimable |
| `spot`                 | float    | Current spot price, USD (claimable)            |
| `zero_gamma_level`     | float?   | Price where net GEX crosses zero, USD (claimable) |
| `call_wall`            | float?   | Strike with highest call gamma, USD (claimable) |
| `put_wall`             | float?   | Strike with highest put gamma, USD (claimable) |
| `expirations_included` | int?     | Number of expirations in the calculation       |
| `coverage_pct`         | float?   | Coverage percentage of the scan                |

## What you produce

A `GexInterpretation` with:

- **regime**: `"positive_gamma"` or `"negative_gamma"`. `"near_zero"` is in the enum but is
  always rejected by the validator (GaleCore's `call_gex`/`put_gex` and `net_gex` use incompatible
  scales, so a near-zero claim cannot be verified).
- **observations**: qualitative prose about dealer positioning (at least 1). **No digits.**
- **implications**: qualitative prose about expected behavior. **No digits.**
- **quantitative_claims**: array of `QuantitativeClaim` (at least 1) — where interpretive numbers go
- **evidence**: array of `EvidenceRef` linking qualitative claims to fact paths (at least 1)
- **limitations**: data quality notes, timing caveats (at least 1)

## Quantitative claims

```json
{"metric": "net_gex", "value": 1500.0, "unit": "billion_usd"}
```

| metric             | unit          | validated against       |
|--------------------|---------------|-------------------------|
| `net_gex`          | `billion_usd` | `facts.net_gex`         |
| `spot`             | `usd`         | `facts.spot`            |
| `zero_gamma_level` | `usd`         | `facts.zero_gamma_level`|
| `call_wall`        | `usd`         | `facts.call_wall`       |
| `put_wall`         | `usd`         | `facts.put_wall`        |

The validator derives the fact path and the required unit from `metric`; you do not send a path.
`value` must equal the fact exactly — no rounding, no rescaling (1500.0 stays 1500.0, never 1.5).
Any unknown metric or unit, a wrong unit, a non-finite value, a missing/null fact, or a value that
differs from the fact rejects the whole interpretation.

## Evidence format

Each evidence entry must have:
- **fact_path**: dot-notation path like `"facts.net_gex"`, `"facts.spot"`, `"facts.call_wall"`
- **claim**: qualitative statement supported by that fact

```json
{"fact_path": "facts.net_gex", "claim": "Net GEX is negative, indicating dealer short gamma"}
```

The validator checks that the path resolves to an available scalar and that any number inside the
claim equals that scalar. It does **not** verify that the sentence is semantically entailed by the
fact; that remains a documented limitation.

## Rules

1. **Interpretive numbers go in `quantitative_claims`.** Any digit in observations or implications is rejected. A number inside an evidence claim must equal the referenced fact; numbers in limitations are only checked against the fact set.
2. **No recalculation.** Do not compute ratios, percentages, or derived values.
3. **Regime classification** follows the rules in the skill YAML; do not use `near_zero`.
4. **Reference the facts.** Your evidence must cite specific fact paths.
5. **Acknowledge limitations.** GEX is a point-in-time snapshot.
6. **No trading recommendations.** Never suggest buying, selling, or any trading action.
