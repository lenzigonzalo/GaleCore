# AC-02 y AC-03/04 — ficha de `spy_prima_varianza_30_45d` 1.0.5 contra GaleCore real (API Dev, 08/10)

Comando (desde `GaleCore-AI/`, con `GALECORE_BASE_URL` y `GALECORE_API_KEY` del entorno de usuario):

```
python -B -m galecore_ai.adapters.cli strategy sheet --ref strategy:spy_prima_varianza_30_45d/1.0.5
```

Exit code: 0. Secciones de la salida (`markdown`) que leen GaleCore: `/App/Runtime/Exposure` (AC-02) y `/App/Runtime/Structures` (AC-03/04), sin editar:

## Riesgo contra el perfil (profile:v8)

| Qué | Esta versión | Límite del perfil (% × capital) | |
|---|---|---|---|
| Pérdida máxima por operación (1 contrato) | 500 USD (tope de la spec; el runtime no abre por encima) | 500 USD (5 %) | dentro |
| Peor caso sumado | 5.000 USD (10 posiciones × pérdida máxima) | 5.000 USD (50 %) | dentro |

- Kill switch: falta: ningún paso del árbol lo define
- Abierto hoy en SHADOW: 1.822 USD en riesgo en 4 posiciones; entra riesgo nuevo por 3.178 USD (GaleCore, 2026-10-08T14:26:36.9733211Z)

## Estructuras para la misma tesis (cadena real, hoy)

SPY 776.24 · vencimiento 2026-11-13 (36 DTE) · GaleCore 2026-10-08T14:26:37.2464596Z. Crédito y breakeven por acción; el resto en USD por contrato; escenarios = P&L.

| Estructura | Crédito (por acción) | Riesgo máx. | Capital | Breakeven | Prob. tocar (0-1) | Δ | Γ | θ/día | Vega/punto | gap -5% | gap -3% | gap +3% | gap +5% | vol +5 pts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PCS | 0.43 | 457.0 | 457.0 | 737.57 | 0.316 | 2.03 | -0.0758 | 0.68 | -5.23 | -141.7 | -70.01 | 30.16 | 37.44 | -24.06 |
| CCS | 0.74 | 426.0 | 426.0 | 807.74 | 0.312 | -4.02 | -0.1398 | 1.94 | -10.81 | 70.62 | 58.76 | -126.96 | -229.05 | -44.16 |
| Iron condor | 1.17 | 383.0 | 383.0 | 736.83 / 808.17 | 0.628 | -1.99 | -0.2156 | 2.62 | -16.04 | -71.08 | -11.25 | -96.8 | -191.62 | -68.22 |

- PCS: ejecutable hoy
- CCS: no ejecutable hoy — el runtime sólo construye PCS (P1-07)
- Iron condor: no ejecutable hoy — el runtime sólo construye PCS (P1-07)
- Esperar: ejecutable hoy — no abre posición: sin crédito ni riesgo
- Supuesto: PCS: el constructor del runtime con delta -0.16 ± 0.04, ancho 5, DTE 30-45, sin crédito mínimo
- Supuesto: CCS: espejo en calls (mismo vencimiento, delta en valor absoluto y ancho); IC = PCS + CCS
- Supuesto: griegas y escenarios: Black-Scholes con la IV de cada pata, tasa 0, sin dividendos; salto de vol = +5 puntos
- Supuesto: probabilidad de tocar ≈ 2 × delta (valor absoluto) del strike vendido; en IC, la suma, tope 1
- Supuesto: crédito y breakevens en puntos del subyacente por acción; riesgo, capital, griegas y P&L en USD por contrato (×100)

