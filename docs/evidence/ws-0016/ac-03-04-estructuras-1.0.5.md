# AC-03/04 — estructuras de `spy_prima_varianza_30_45d` 1.0.5 con la cadena real (API Dev, 08/10)

`strategy sheet --ref strategy:spy_prima_varianza_30_45d/1.0.5`, sección que lee `GET /App/Runtime/Structures`.

## Estructuras para la misma tesis (cadena real, hoy)

SPY 774.76 · vencimiento 2026-11-13 (36 DTE) · GaleCore 2026-10-08T13:44:28.5819706Z. Montos en USD por contrato; escenarios = P&L.

| Estructura | Crédito | Riesgo máx. | Breakeven | Prob. tocar (0-1) | Δ | θ/día | Vega/punto | gap -5% | gap -3% | gap +3% | gap +5% | vol +5 pts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PCS | 0.44 | 456.0 | 736.56 | 0.325 | 2.12 | 0.73 | -5.35 | -143.43 | -71.56 | 31.89 | 39.94 | -24.4 |
| CCS | 0.79 | 421.0 | 805.79 | 0.324 | -4.16 | 2.0 | -10.91 | 74.49 | 61.58 | -128.78 | -230.17 | -44.24 |
| Iron condor | 1.23 | 377.0 | 735.77 / 806.23 | 0.65 | -2.04 | 2.73 | -16.25 | -68.94 | -9.98 | -96.89 | -190.23 | -68.64 |

- PCS: ejecutable hoy
- CCS: no ejecutable hoy — el runtime sólo construye PCS (P1-07)
- Iron condor: no ejecutable hoy — el runtime sólo construye PCS (P1-07)
- Esperar: ejecutable hoy — no abre posición: sin crédito ni riesgo
- Supuesto: PCS: el constructor del runtime con delta -0.16 ± 0.04, ancho 5, DTE 30-45, sin crédito mínimo
- Supuesto: CCS: espejo en calls (mismo vencimiento, delta en valor absoluto y ancho); IC = PCS + CCS
- Supuesto: griegas y escenarios: Black-Scholes con la IV de cada pata, tasa 0, sin dividendos; salto de vol = +5 puntos
- Supuesto: probabilidad de tocar ≈ 2 × delta (valor absoluto) del strike vendido; en IC, la suma, tope 1
- Supuesto: montos en USD por contrato (×100)

