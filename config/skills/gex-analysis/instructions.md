# GEX Interpretation Skill — Instructions

## What you receive

A `GexFacts` object with deterministic data from GaleCore's `compute.gex_analysis` capability:

| Field                  | Type     | Description                                    |
|------------------------|----------|------------------------------------------------|
| `symbol`               | string   | Ticker symbol (e.g. "SPY")                     |
| `net_gex`              | float    | Net gamma exposure from GaleCore               |
| `call_gex`             | float    | Gamma exposure from calls                      |
| `put_gex`              | float    | Gamma exposure from puts (typically negative)   |
| `spot`                 | float    | Current spot price                              |
| `zero_gamma_level`     | float?   | Price where net GEX crosses zero               |
| `call_wall`            | float?   | Strike with highest call gamma                 |
| `put_wall`             | float?   | Strike with highest put gamma                  |
| `expirations_included` | int?     | Number of expirations in the calculation       |
| `coverage_pct`         | float?   | Coverage percentage of the scan                |

## What you produce

A `GexInterpretation` with:

- **regime**: `GexRegime` enum — `"positive_gamma"`, `"negative_gamma"`, or `"near_zero"`
- **observations**: What the numbers tell us about dealer positioning (at least 1)
- **implications**: Expected market behavior given the regime
- **evidence**: Array of `EvidenceRef` linking claims to facts (at least 1)
- **limitations**: Data quality notes, timing caveats

## Evidence format

Each evidence entry must have:
- **fact_path**: dot-notation path like `"facts.net_gex"`, `"facts.spot"`, `"facts.call_wall"`
- **claim**: human-readable statement supported by that fact

Example:
```json
{"fact_path": "facts.net_gex", "claim": "Net GEX is negative at -1584.1, indicating dealer short gamma"}
```

## Rules

1. **No invented numbers.** Every number you mention must appear in the facts.
2. **No recalculation.** Do not compute ratios, percentages, or derived values.
3. **Regime classification** follows the rules in the skill YAML.
4. **Reference the facts.** Your evidence must cite specific fact paths and values.
5. **Acknowledge limitations.** GEX is a point-in-time snapshot.
6. **No trading recommendations.** Never suggest buying, selling, or any trading action.
