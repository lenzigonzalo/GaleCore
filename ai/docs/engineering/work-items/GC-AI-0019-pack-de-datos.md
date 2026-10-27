---
id: GC-AI-0019
title: Pack de datos — inventario real, GaleCore completo y receta «sumar una fuente» (entregable 1, pieza e)
status: CLOSED
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: false
review_result: APPROVED
approval_result: APPROVED
---

# GC-AI-0019 — Pack de datos

Roadmap §4, entregable 1, pieza **e** (ajuste 1, aprobado el 30/09). Abierto con el «dale» del owner el 01/10. Rama
desde `feature/GC-AI-0018`. La parte de GaleCore (FRED y Fed mudados; EDGAR, Tesoro, BLS y CBOE nuevas) ya está
pedida en `docs/engineering/HANDOFF-GALECORE-FUENTES.md` del workspace; este ítem es **el lado de GaleCore-AI**.

## Acuerdo breve

- **Para qué:** que al pedir un análisis el sistema sepa qué datos tiene de verdad, de dónde salen, si funcionan hoy y
  qué falta, y que sumar una fuente nueva sea un paso conocido y no un trabajo a medida.
- **Qué vas a poder pedir:** «¿Qué datos tenemos?» · «¿Con qué cubro tasas / volatilidad / resultados de NVDA?» ·
  «¿Qué fuente falta y quién la trae?» · «Sumemos la fuente X».
- **Cómo veremos que sirve:** una tabla con cada fuente, qué cubre, costo y **estado probado hoy** (no de memoria), y un
  análisis real que usa cadenas, IV rank, IV o velas de GaleCore que hoy el harness no puede pedir.
- **Comparado con hoy:** el registro de fuentes nunca se probó entero (estado vacío en casi todas), y GaleCore ya tiene
  cadenas, IV rank, IV, velas y datos de volatilidad que el harness no declara: el registro dice «no disponible» aunque
  la ruta existe.

## Lo que encontré al abrir (01/10)

| GaleCore ya tiene | ¿Lo pide el harness hoy? |
|---|---|
| Cotización, trade (SPY, VIX, VVIX…), GEX, put skew 25Δ, runtime SHADOW | Sí |
| Cadenas de opciones (`Tastytrade/OptionChains`), IV rank (`App.Analytics/IVRank`), IV (`App.Analytics/ImpliedVolatility`) | La ruta está en el despachador, pero **no registrada**: no se puede pedir |
| Velas (`Tastytrade/MarketData/Candle`), métricas de volatilidad (`Tastytrade/Market-metrics/VolatilityData`), griegas | No |

Registro de fuentes: `galecore`, `fred`, `fed`, `alpha_vantage`, `fmp`; **sin estado observado** en la mayoría.

## Propuesta

| Pieza | Qué es |
|---|---|
| Inventario real | Probar cada fuente registrada (`sources check` para las propias; `sources declare` con lo que ve el host para Alpha Vantage y FMP) y dejar la tabla «fuente · cubre · costo · estado · fecha de la prueba». Una vista en `sources list` lista para leer |
| GaleCore completo | Registrar como consultas de sólo lectura: cadenas, IV rank, IV, velas y métricas de volatilidad; cada una probada contra GaleCore Dev, con su contrato de respuesta y su cobertura en el registro |
| Fuentes pedidas a GaleCore | EDGAR, Tesoro, BLS y CBOE (y FRED/Fed mudados) en el registro como **pedidas, todavía no disponibles**: una consulta que las necesita responde «falta, la trae GaleCore (traspaso del 30/09)» en vez de callar |
| Receta «sumar una fuente» | Pasos fijos: mapa (qué cubre y para quién) → prueba de acceso → capacidades que la usan → caso de ejemplo. Como paso de la capacidad `data_sources` (skill) y verificada con un caso real |

## Decisiones tuyas antes del código

| # | Pregunta | Decisión (owner, 03/10: «dale… arrancá con el mapa de datos») |
|---|---|---|
| 1 | ¿Este ítem espera a que GaleCore exponga las fuentes nuevas? | **No.** Este ítem es la fase 1a del Producto 1; las fuentes externas quedan «pedidas» y las implementamos nosotros en GaleCore en la fase 1b (sin traspaso) |
| 2 | ¿Qué caso de ejemplo para la receta? | Velas e IV rank de GaleCore, probados en vivo |

## Non-goals

- Implementar en GaleCore las fuentes nuevas (pedido aparte, `HANDOFF-GALECORE-FUENTES.md`).
- Borrar `fred_query.py` y `fed_calendar.py`: siguen hasta que GaleCore exponga lo mismo y una corrida real del briefing
  lo use.
- IBKR e IoL (entran con la gestión de cartera completa); conectores pagos (descartados).
- Cambiar las skills de análisis para que usen los datos nuevos: se hace cuando un caso lo pida.

## Acceptance criteria

- [x] **AC-01 — Inventario probado:** cada fuente registrada tiene estado observado con fecha; la tabla se puede leer
  en una respuesta y dice qué falta. **Evidencia 03/10:** `sources check` → galecore y fred `available`; alpha_vantage
  `limited` (27/09), fmp `denied` (28/09); `fed` sin sonda propia (la usa el briefing cada día); 5 pedidas sin estado
  (no existen todavía). `sources list` da la tabla.
- [x] **AC-02 — GaleCore completo:** cadenas, IV rank, IV, velas y métricas de volatilidad se pueden pedir desde el
  harness como sólo lectura, cada una probada contra GaleCore Dev y declarada en el registro; `catalog --check` pasa.
  **Evidencia 03/10:** 6 capacidades nuevas en `capabilities/contracts.py` + rutas; `galecore list|get` en el CLI
  (`--out` para la cadena; en una corrida programada sólo dentro de su carpeta). Probadas en vivo contra :7001:
  cadena SPY, IV rank SPY (16,39), estructura de IV, métricas de SPY y QQQ, velas diarias, griegas de
  `SPY   261008P00775000`. Límites declarados: historia de IV desde el 21/09, velas en formato DXLink.
- [x] **AC-03 — Pedidas a GaleCore:** las fuentes del traspaso aparecen como pedidas; una necesidad que sólo ellas
  cubren responde que falta y quién la trae. **Evidencia:** `AccessType/Usage.REQUESTED`; «fundamentales de NVDA» →
  `missing` con `sec_edgar` «pedida a GaleCore»; `tests/unit/test_data_map.py`.
- [x] **AC-04 — Receta:** «sumar una fuente» escrita como paso de la capacidad y aplicada a un caso real de punta a punta.
  **Evidencia:** skill `data_sources` 1.2.0 (receta en 4 pasos); aplicada a velas e IV rank (mapa → prueba en vivo →
  `strategy_design` las usa en `data_needs` → consulta real).
- [x] **AC-05 — Demostración:** un análisis real que usa un dato de GaleCore que hoy no se puede pedir.
  **Ejemplo interno 03/10 (demos ágiles):** «¿IV rank de NVDA?» → `sources query` apunta a galecore → `galecore get
  compute.iv_rank` responde con `GALECORE_VERIFIED`; antes respondía «faltante».
- [x] **AC-06 — Revisión:** interna (cambio chico y de lectura: sin Codex, regla del 03/10); utilidad y cierre, vos.

## Requirement-to-evidence matrix

| Criterion | Implementation | Automated verification | Reproducible artifact | Status |
|---|---|---|---|---|
| AC-01 … AC-06 | PENDING | PENDING | PENDING | PENDING |

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```

## Cierre

**CLOSED por el owner el 04/10/2026** («ok, cerrá GC-AI-0024 y el lote pendiente»), en lote con GC-AI-0019…0024.
Revisión: interna (con sus arreglos registrados arriba); sin Codex. Demos reemplazadas por ejemplos internos y corridas
reales (regla del 03/10).
