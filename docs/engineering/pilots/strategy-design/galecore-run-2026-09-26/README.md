# PCS sobre SPY con datos reales de GaleCore — primer recorrido (26/09/2026)

**Pedido del owner:** con los datos que GaleCore entrega hoy, ¿qué se puede evaluar de vender prima con put
credit spreads sobre SPY, qué hipótesis quedan abiertas y qué información falta? Sin estrategia terminada,
sin rentabilidad, sin despliegue.

**Recorrido:** pedido → 14 consultas GET reales al DataFeed local (`127.0.0.1:7001`) → análisis sólo con lo
obtenido → este archivo. Método: [SKILL.md](../SKILL.md) v0.2.0-draft, §2–§4 y §6, aplicados a un corte chico.
Sin web ni subagentes. Cada dato citado abajo remite a `raw/<archivo>.response` y su `.meta.json` (URL, hora
UTC, status). Reproducir: `python docs/evidence/gc-ai-0006/galecore_query.py <dir> <ruta>...`

> Momento de los datos: cierre del viernes 25/09 (VIX y SPY 20:15 UTC); consultas del sábado 26/09
> 13:3x UTC con el mercado cerrado. Es **una foto**, no una serie.

## 1. Respuesta corta

- **Se puede evaluar hoy (foto de un día):** 4 de los 4 chequeos de régimen de RPF y 1 de los 2 componentes
  de cola. Con RPF tal como está, **el 25/09 no habría habido entrada: el GEX era negativo** (≈ −76, regla ≥ 0).
- **No se puede evaluar con lo que GaleCore sirve:** VRP (falta la vol realizada de 30 días), edge (falta la
  probabilidad de pérdida calibrada y el crédito de un candidato RPF), put wall, cambio del skew a 5 días, y
  **todo lo histórico**: GaleCore no entrega historia de cadenas ni de sus señales. La pregunta de fondo (¿hay
  ventaja después de costos?) **no se puede contestar con la API actual**.
- **Lo que GaleCore sí muestra en vivo:** un runtime SHADOW funcionando con dos specs **de prueba** (no son
  RPF ni una estrategia) y una posición PCS abierta. Esa posición **no cumpliría** el piso de crédito de RPF.
- **Hay datos defectuosos:** el IV Rank se informa sobre una base de 252 días pero trae 10 días de historia, con
  máximo y mínimo en 0. No se usa.

## 2. Qué se consultó y qué devolvió

| Dato | Valor | Archivo en `raw/` |
|---|---|---|
| Reglas RPF | v0.2.0-draft, `paper_only`, PCS-only, SPY-only, con fuente BT por regla | `App_Rpf_Rules` |
| Config de la app | kill switch 1,5 %, TP 50 %, 2 posiciones máx. (distinto de RPF: 1 %) | `App_GaleCore_Rules_Core` |
| VIX / VIX9D / VVIX | 14,87 / 12,76 / 87,84 (25/09 20:15 UTC) | `Data_Tastytrade_MarketData_Trade_Symbol_*` |
| Skew 25Δ SPY | 1,0885 (put 743 IV 15,0 % / ATM 13,78 %, venc. 20/11, 55 DTE); RoC 5d y percentil = **null** ("no persistido aún") | `App.Analytics_PutSkew_Symbol_SPY` |
| IV Rank SPY | 12,71 con `highIV`/`lowIV` = 0 y 10 días de historia → **inconsistente** | `App.Analytics_IVRank_Symbol_SPY` |
| IV30 RoC | −1,27 % (26/09 00:37 UTC, verificación de acceso previa) | [`../galecore-access-2026-09-26/get_implied_volatility.response`](../galecore-access-2026-09-26/) |
| Runtime SHADOW | persistencia OK; 2 instancias: v1 detenida, v2 corriendo | `App_Runtime_Status`, `App_Runtime_Instances` |
| Specs | `shadow_runtime_test_v1` y `v2`, ambas "no es una estrategia" | `App_Runtime_Specs` |
| Métricas | v1: 49 evaluaciones, 0 pasan (GEX). v2: 164, 162 pasan, 161 `ENTRY_SKIPPED`, 1 posición | `App_Runtime_Metrics` |
| Últimas evaluaciones | v1: GEX −80,2 falla `gex_non_negative`; v2: GEX −76,5 pasa `≥ −150` | `App_Runtime_Instances_*_Evaluations_*` |
| Posición v2 | PCS 731/726 venc. 06/11, crédito 0,44, delta corto −0,16, riesgo máx. 456, no realizado −0,5 | `App_Runtime_Instances_0bbd904a_Positions` |

## 3. RPF contra la foto del 25/09

| Regla RPF (fuente: `App_Rpf_Rules`) | Insumo obtenido | Resultado |
|---|---|---|
| VIX < 30 | 14,87 | pasa |
| VIX9D < VIX | 12,76 < 14,87 | pasa |
| Aceleración de vol ≤ 12 % | IV30 RoC −1,27 % | pasa |
| GEX ≥ 0 | −76,5 (del evaluador SHADOW v2) | **falla → no trade** |
| VRP ≥ 1,2 | IV ATM sí; vol realizada 30d **no servida** | no evaluable |
| Cola: VVIX (warn 110 / block 130) | 87,84 | 0 puntos |
| Cola: skew25 RoC 5d (0,05 / 0,08) | null | no evaluable |
| Short ≤ put wall | no consultado (GEX por strike es una llamada pesada) | no evaluado |
| Edge ≥ barra por régimen | falta p(pérdida) calibrada y candidato RPF | no evaluable |
| Crédito ≥ 10 % del ancho | sólo existe el candidato de la spec de prueba: 0,44/5 = 8,8 % | ese candidato no pasaría |

**Supuesto no verificado:** que el GEX del evaluador SHADOW sea el mismo cálculo y la misma unidad (miles de
millones de USD) que `definitions.gex` de RPF. La spec v1 usa el mismo umbral (≥ 0) y el mismo nombre de regla.

## 4. Hipótesis abiertas

- **H1 — ventaja después de costos** (la idea del owner): abierta. GaleCore no da la historia para probarla. La
  propuesta del 25/09 (§6) sigue siendo el plan; usa el dataset de `research/`, no la API.
- **H2 — ¿el filtro GEX ≥ 0 sirve o sólo bloquea?** Visible hoy: v1 bloqueó el 100 % de 49 evaluaciones el 25/09.
  RPF mismo anota que el único episodio que lo justifica (ago-2015) está fuera de la muestra de prueba. Es
  la hipótesis más barata de observar: SHADOW ya registra cada evaluación.
- **H3 — ¿el runtime refleja RPF?** No. Las specs activas son de prueba: 2 gates contra los 4 + 5 de RPF, delta
  0,16 contra 0,25 y sin piso de crédito. Los resultados de SHADOW no dicen nada todavía sobre RPF.
- **H4 — ¿la cola se puede vigilar en vivo?** La mitad sí (VVIX). El skew RoC 5d depende de un historial que la
  API declara no persistido, aunque la config de la app tiene un servicio de snapshot de skew habilitado. No
  se verificó dónde queda ese historial ni si alcanza.

## 5. Qué falta, en orden de impacto

1. **Historia en GaleCore** (cadenas o al menos señales diarias) → sin esto H1 no se prueba desde GaleCore.
2. **Una spec SHADOW que sea RPF** → H3; convertir RPF a spec es trabajo de I4 con sus controles, no de esta vuelta.
3. **Vol realizada 30d y p(pérdida) servidos por la API** → VRP y edge evaluables en vivo.
4. **IV Rank corregido** → hoy es inconsistente; RPF no lo usa (removido en Fork B), así que no bloquea.

## 6. Próxima prueba (chica, sin construir nada)

Durante una semana de mercado, una consulta diaria al cierre con el mismo script (≤ 15 GET) y una tabla
por día con los chequeos de §3. Con eso se ve **cuántos días RPF pasaría el régimen** y si el GEX ≥ 0 es el que
decide. Responde H2 con datos de GaleCore, no con documentos. No agrega endpoints ni servicios.

## 7. Límites de este resultado

Un solo día; mercado cerrado al consultar. No se verificaron las fórmulas del runtime ni los valores contra
otra fuente (IBKR no se usó). El "−0,5" de la posición se interpreta como USD por contrato (0,445 − 0,44 ×
100); la API no declara la unidad. Nada de esto evalúa rentabilidad.
