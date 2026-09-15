# GEX Interpretation Skill — Instructions

## What you receive

A `GexFacts` object with deterministic data from GaleCore's `compute.gamma_exposure` capability:

| Field              | Type     | Description                                    |
|--------------------|----------|------------------------------------------------|
| `symbol`           | string   | Ticker symbol (e.g. "SPY")                     |
| `net_gex`          | float    | Net gamma exposure (call_gex + put_gex)        |
| `call_gex`         | float    | Gamma exposure from calls                      |
| `put_gex`          | float    | Gamma exposure from puts (typically negative)   |
| `spot`             | float    | Current spot price                              |
| `zero_gamma_level` | float?   | Price where net GEX crosses zero               |
| `call_wall`        | float?   | Strike with highest call gamma                 |
| `put_wall`         | float?   | Strike with highest put gamma                  |
| `dte`              | int?     | Days to expiration (if single-expiry calc)     |

## What you produce

A `GexInterpretation` with:

- **regime**: `"positive_gamma"`, `"negative_gamma"`, or `"near_zero"`
- **observations**: What the numbers tell us about dealer positioning
- **implications**: Expected market behavior given the regime
- **caveats**: Limitations of the analysis

## Rules

1. **No invented numbers.** Every number you mention must appear in the facts.
2. **No recalculation.** Do not compute ratios, percentages, or derived values.
3. **Regime classification** follows the rules in the skill YAML.
4. **Reference the facts.** Your observations must cite specific fact values.
5. **Acknowledge limitations.** GEX is a point-in-time snapshot.
