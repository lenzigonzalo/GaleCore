# Contrato — Panel de rendimiento SHADOW (WS-0033)

`GET /App/Runtime/Performance/Panel` · sólo SHADOW · P&L en USD por contrato · JSON en camelCase.

## Pedido

| Parámetro | Obligatorio | Qué es |
|---|---|---|
| `spec` | sí | Nombre de la estrategia. 404 si no tiene posiciones SHADOW. |
| `version` | no | Una versión (`1.0.5`). Sin ella, todas. |
| `from`, `to` | no | Período (UTC) por fecha de **salida** de las cerradas. |
| `referenceCapital` | no | Capital de referencia en USD. Sin él no hay retorno en %. |
| `cashRatePct`, `bond10yPct`, `targetAnnualPct` | no | Efectivo, bono a 10 años y objetivo del perfil, en % anual. Los pasa quien llama. |
| `hypothesisMinTrades`, `hypothesisMinDays` | no | Criterio de la hipótesis (operaciones y período). |
| `reservePct`, `maxRiskPerTradePct`, `maxOpenRiskPct`, `maxBetPct` | no | Límites del perfil; con `referenceCapital` habilitan `openRiskVsLimits`. Van los cinco o ninguno. |

503 si SHADOW no tiene persistencia.

## Regla de oro

Todo número es `Metric = { value, reason }`. **Si no hay valor, `value` es `null` y `reason` dice por qué** («muestra chica: 2 cerradas, hacen falta 30», «sin pérdidas», «falta la tasa de efectivo»). Nunca es 0 ni una estimación: el panel tiene que mostrar el motivo, no un guion mudo.

## Respuesta

| Campo | Contenido |
|---|---|
| `asOf`, `mode`, `source` | Fecha de la respuesta, siempre `"SHADOW"` y de dónde salen los datos. |
| `spec`, `version`, `from`, `to` | Lo pedido. |
| `tradesClosed`, `tradesOpen`, `firstExitAt`, `lastExitAt` | Muestra. |
| `smallSample`, `notes[]` | Avisos en texto: «Muestra chica…», «Sin operaciones cerradas…». Mostrarlos. |
| `curve[]` | `{ at, pnl, cumulative, drawdown }` por instante de salida. |
| `realizedPnl`, `unrealizedPnl`, `maxDrawdown` | Resultado y máxima caída. |
| `winRate` (0–1), `avgWin`, `avgLoss`, `profitFactor`, `expectancy` | Por operación cerrada. |
| `sharpe`, `sortino` | **Por operación**, no anualizados: media/desvío del resultado en % del riesgo máximo. Requieren ≥ 30 cerradas. |
| `avgDaysHeld`, `worstTrade`, `lossStreak` | Duración, peor operación y racha de pérdidas más larga. |
| `openMaxRisk` | Riesgo máximo abierto (USD). |
| `openRiskVsLimits[]` | `{ limit, used, max, headroom, ok }`; `null` + `openRiskVsLimitsReason` si no llegaron los límites. |
| `regime` | `byVix`, `byIvRank`, `byGamma`: listas de grupo. `tradesWithoutContext` y `reason` cuando faltan. `edges` trae los cortes para mostrarlos. |
| `byExitRule[]`, `byVersion[]` | Grupo: `{ key, trades, winRate, avgPnl, realizedPnl, avgGapToPlan }` (`avgGapToPlan` sólo en reglas). |
| `references` | `periodDays`, `strategyReturnPct`, `cashReturnPct`, `bondReturnPct`, `targetReturnPct`, `excessVsCashPct`, `excessVsBondPct`, `excessVsTargetPct` (todos `Metric`, en % del período). |
| `hypothesis` | `tradesClosed/tradesRequired`, `daysElapsed/daysRequired`, `sampleReached` (`null` si falta el criterio) y `reason`. Mide la muestra, no dice si hay edge. |
| `execution` | Calidad de ejecución: `tradesMeasured`, `tradesWithoutQuotes`, `avgCrossingCost`, `totalCrossingCost`, `realizedMeasured`, `realizedAfterCrossing`, `winRateAfterCrossing`, y `notIncluded` (comisiones y costos reales de la cuenta: no se conocen). |

## Qué hay y qué no hay hoy

- `regime` y `execution` se calculan con el contexto de entrada y salida que se guarda **desde WS-0033**. Las posiciones anteriores salen como «sin contexto»; el panel debe decirlo, no ocultarlo.
- El régimen de gamma sale del gate de la spec cuyo id contiene `gex`; si la spec no tiene uno, `byGamma` viene vacío.
- Cortes de VIX e IV Rank fijos (están en `regime.edges`).
- Tasa de efectivo, bono a 10 años y objetivo no los lee GaleCore: los pasa quien llama.

## Evidencia

- `panel_sin_parametros.json` — `spy_prima_varianza_30_45d` en Dev, sin parámetros opcionales.
- `panel_con_parametros_ilustrativos.json` — mismos datos con valores **ilustrativos** (no son el perfil real): capital 10.000, efectivo 4,5 %, bono 4,2 %, objetivo 15 %, hipótesis 30 operaciones / 60 días.
