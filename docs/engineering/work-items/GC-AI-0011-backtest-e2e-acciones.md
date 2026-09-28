---
id: GC-AI-0011
title: Una idea evaluada de punta a punta - datos, backtest y reporte (acciones), luego SHADOW
status: DRAFT
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0011 — Backtest de punta a punta con acciones (roadmap §4, recorrido B posterior)

Origen: owner, 28/09/2026 — «agregar estrategias simples y estándar de acciones (buy & hold, reversión a la media) para
aplicar backtesting en el flujo… el fin es más testear que el andamiaje funcione e2e que los resultados de la estrategia».
El recorte posterior del roadmap §4 dejó **sólo la compuerta de datos esta semana**. El recorrido completo datos →
backtest → reporte → decisión queda como incremento propio posterior. SHADOW de acciones es otra entrega condicional,
dentro de GaleCore (opción a); no bloquea la utilidad del backtest.

## Alcance actual: compuerta de datos

Guardar precios y dividendos con procedencia y hash; comprobar que precio sin ajustar + dividendos reproduce el retorno
ajustado dentro de una tolerancia declarada, con sesiones alineadas y tratamiento explícito de splits. El parquet local
sirve como contraste, con su procedencia incompleta declarada. Registrar señal al cierre, fill en apertura de la próxima
sesión, ex-date y payment date. Si falta evidencia para resolverlo, dejar el bloqueo preciso. No construir motor,
reporte, spec SHADOW ni optimización en esta compuerta.

## Acuerdo breve del incremento posterior (borrador)

- **Problema:** hoy no hay forma estándar de evaluar una idea antes de SHADOW: los estudios de la 1.0.3 fueron scripts
  sueltos (`docs/evidence/gc-ai-0008/hypothesis_study.py`), no un método reutilizable ni un reporte atado a la versión.
- **Qué vas a poder hacer (1ª entrega):** pedir en el chat «backtesteá una reversión a la media en SPY contra buy & hold»
  y obtener un reporte reproducible (datos y código con hash, reglas congeladas, costos y slippage explícitos, fuera de
  muestra) guardado en la base y atado a la versión de la estrategia; iterar («probá con otro umbral») = versión nueva con
  su propio reporte; retomarlo desde otra sesión.
- **Primera demostración:** una estrategia sencilla (reversión a la media) en **un símbolo** (SPY), comparada contra buy &
  hold del mismo símbolo, con el reporte recuperado desde una sesión limpia.
- **Qué falta para correrla:** método de backtest (skill mínima + código), contrato del reporte, y el subconjunto de
  datos de `BL-004` (precios diarios de un símbolo + dividendos). Acceso verificado abajo.
- **Fuera:** plataforma histórica general, opciones históricas, optimización de parámetros como producto, afirmar
  rentabilidad, multiinstancia (salvo indispensable), PAPER/LIVE.
- **2ª entrega (condicional):** la misma estrategia (misma identidad, versión, aprobación y reglas) → SHADOW en GaleCore →
  seguimiento. Requiere un item de GaleCore (spec y fills de acciones: hoy `StrategySpecContract.LegTemplate` sólo modela
  patas de opciones) y **tu decisión** de sustituir a la 1.0.3 para entradas nuevas (una sola instancia RUNNING, `BL-007`).
  Walk-forward histórico ≠ seguimiento prospectivo: una semana no demuestra robustez.

## Verificación de datos (28/09, antes de construir)

| Fuente | Acceso | Cobertura | Semántica | Uso |
|---|---|---|---|---|
| GaleCore `GET /Data/Tastytrade/MarketData/Candle` (DXLink), script de sólo lectura | OK (HTTP 200, clave de desarrollo por entorno) | SPY diario 2005-01-03 → 2026-09-25: 5.467 filas en 2,6 s, una llamada | **Precios sin ajustar por dividendos** (10/01/2005 close 119,00); filas de feriado con OHLC `NaN` (p. ej. 2005-01-01, `eventFlags` 10) a descartar; volumen 0 en filas recientes (presente en las viejas); orden descendente; `timeStamp` = fecha de la sesión | Precios del backtest, byte a byte desde GaleCore |
| FMP `historical-price-eod-dividend-adjusted` (conector del host) | OK | Desde al menos 2005 | OHLC ajustado por dividendos y splits (05/01/2005 adjClose 79,43); en fechas recientes igual al sin ajustar; el ajuste retroactivo cambia con cada dividendo nuevo | Control cruzado del retorno total en fechas de muestra |
| FMP `dividends-company` (conector) | OK | Trimestral; últimos: ex 18/09/2026 1,88883, 18/06 1,90352, 20/03 1,797 (~88 filas desde 2005, transcribibles) | `date` = fecha ex (el día en que el precio sin ajustar cae); `dividend` sin ajustar; `paymentDate` posterior | Dividendos para retorno total de buy & hold y de la estrategia |
| FMP por script | **No**: no hay clave local, sólo el conector | — | — | Transcribir 20 años por el conector sería caro y frágil: descartado |

**Consecuencia:** retorno total = precios de GaleCore + dividendos (FMP); sin dividendos, buy & hold de SPY queda
subestimado ~1,5–2 %/año y la comparación contra la estrategia sería engañosa. Si los dividendos no se pueden obtener con
procedencia, el reporte lo declara y compara sólo retorno de precio en ambos lados (bloqueo explícito del retorno total).

## Acceptance criteria del incremento posterior (borrador; no son el compromiso semanal)

- [ ] **AC-01 — Datos:** precios y dividendos del símbolo guardados con procedencia y hash; problemas de calidad resueltos o
  que bloquean el resultado explícitamente.
- [ ] **AC-02 — Estrategia:** reglas y parámetros identificados y congelados antes de correr; reutilizar el método de
  diseño cuando aplique, sin forzar acciones al contrato ejecutable actual de `strategy_design` (sólo EQUITY_OPTION).
  El contrato de reporte debe identificar esa versión; no afirmar que su hash es el de SHADOW hasta que GaleCore soporte
  acciones, rechace campos desconocidos y se verifique la correspondencia.
- [ ] **AC-03 — Backtest:** sin información futura (señal al cierre, ejecución en la apertura siguiente o equivalente
  declarado), costos y slippage explícitos, período fuera de muestra separado, comparado contra buy & hold, reproducible.
- [ ] **AC-04 — Reporte:** atado a la versión y al hash de datos/código; recuperable desde otra sesión; iterar = versión nueva.
- [ ] **AC-05 — Método como skill:** versionado, en el catálogo, ejecutable con datos nuevos.
- [ ] **AC-06 — Revisión:** interna y Codex; utilidad y cierre, el owner.
