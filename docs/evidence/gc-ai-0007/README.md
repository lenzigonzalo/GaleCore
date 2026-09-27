# GC-AI-0007 — Investigación contextual de SPY: recorrido del 27/09/2026

Registro autoritativo: `research:2026-09-27-spy-contexto-prima-30-60d` en `knowledge/` (3 revisiones) y
22 evidencias `evidence:2026-09-27-spy-ctx-*`. Este archivo resume y rutea; no reemplaza ese registro.
Recalcular los cálculos propios desde la evidencia: `python docs/evidence/gc-ai-0007/recompute.py`.

## Cómo se pide

En Claude Code, desde el workspace, en lenguaje normal:

> Quiero investigar una estrategia sobre SPY. Identificá qué factores importan según la idea y su
> horizonte, explicá por qué, consultá los datos pertinentes y contrastá qué escenarios son compatibles.

El host encuentra `context_research` en `cli catalog`, sigue `config/skills/context-research/skill.yaml`,
busca antecedentes (`kb search`), consulta GaleCore y los conectores que hagan falta, guarda cada respuesta
con `evidence add` y la investigación con `research save --capability context_research`.

Para retomar desde una sesión nueva (pedido breve, sin pegar contenido):

> Retomá la investigación de contexto sobre vender prima en SPY, incorporá lo nuevo que se pueda obtener
> hoy y explicame qué cambia y qué se mantiene. Guardalo.

(Si se usa FRED: `FRED_API_KEY` en el entorno de la sesión; en un worktree, `PYTHONPATH=src`.)

## El análisis, corto (datos al cierre del 25/09)

**Idea y horizonte:** vender puts de SPY (put credit spreads, como RPF) a 30–60 días. El horizonte se tomó
del antecedente RPF; falta que lo confirmes.

| Factor | Qué muestra | Tipo |
|---|---|---|
| Opciones (GaleCore) | VIX 14,87; contango (VIX9D/VIX 0,86; VIX/VIX3M 0,83); VVIX 87,8; skew 25Δ 1,09 | Observación |
| Implícita vs realizada | IV30 14,9 % contra realizada 20d 10,8 % (FMP) → 1,39 | Cálculo propio / expectativa implícita |
| Tasas | 10 años 4,96 → 5,18 % en dos ruedas (22–24/09); curva 2–10 de 25 a 36 pb | Observación |
| Descomposición (FRED) | Toda la suba fue tasa real (2,63 → 2,85 %); breakeven plano (2,33 %) | Observación (r3) |
| Política | Fondos federales 3,88 %; letras 1–12 meses 4,04–4,50 % | Observación → expectativa implícita de subas, con salvedades |
| Inflación | CPI desestacionalizado 3,35 % a/a; +2,26 % ene→may y +0,05 % may→ago | Cálculo propio (corregido en r2) |
| Empleo | Desempleo 4,1 % (desde 4,5 %); empleo +456 mil a/a (vs +712 mil un año antes) | Observación / cálculo propio |
| Eventos en la ventana | Bancos y TSM publican 13–15/10 (consenso FMP); fechas de CPI/FOMC **no obtenidas** | Consenso / faltante |
| Concentración | Tecnología 37,8 %; NVDA+AAPL+MSFT 21 % | Observación |
| Valuación, fiscal, geopolítica | Sin fuente consultada | Pendiente |

**Escenarios:** (A) reprecio de inflación — **debilitado** por FRED; (B) suba de tasa real por crecimiento o
política — **reforzado**; (C) prima por plazo/oferta — abierto, sin evidencia fiscal; (D) vol de acciones
complaciente frente al shock — compatible con todo lo anterior. Ninguna cotización prueba una causa.

**Qué implica para la estrategia:** la prima parece cara contra la realizada, pero la ventana contiene
resultados de bancos y megacaps y probablemente datos macro, y los gates de RPF no miran tasas ni eventos.
Hoy RPF igual no entraría (GEX negativo, antecedente del 26/09). Hipótesis a probar: después de shocks de tasa
real con implícita baja, SPY cruza con más frecuencia la distancia de un short 25Δ (~3,8 %) en 30–60 días.
Prueba: estudio condicional con DFII10 + SPY + VIX históricos; **los umbrales de apoyo los fijás vos antes
de correrlo**.

**Qué cambió al incorporar observaciones nuevas:** r2 corrigió el CPI (la serie de Alpha Vantage no era la
desestacionalizada; el impulso real de ene→may fue 2,26 %, no 3,0 %); r3 incorporó FRED y movió el peso de
A hacia B. Se mantuvieron D, la consecuencia para la estrategia y el bloqueo por GEX.

## Fuentes: qué aportó cada una en esta sesión

| Fuente | Usada para | Funcionó | Límite real encontrado |
|---|---|---|---|
| GaleCore (DataFeed local, 7 GET) | VIX, VIX9D, VIX3M, VVIX, SPY, skew, IV por plazo | Sí | Sin historia ni vol realizada; IV/skew sin hora del dato; RoC IV30 repetido del 26/09 |
| FMP | Curva completa, SPY (cotización y diario), calendario de resultados | Parcial | Calendario macro y ETF/fondos **denegados por plan** |
| Alpha Vantage | CPI, desempleo, empleo, fondos federales, perfil de SPY | Sí | 1 consulta/s y 25/día; mensuales sin filtro de fecha; diarias truncadas a 2 puntos; CPI sin ajuste estacional |
| FRED (API directa, `tools/fred_query.py`) | Tasa real, breakeven, 10 años, CPI desestacionalizado con vintage | Sí | MCP no registrado en Claude Code; se usó la clave por entorno |

Toda la evidencia es `HOST_DECLARED`: el host obtuvo y guardó las respuestas; nada externo figura como
verificado por GaleCore. Las horas de consulta a conectores son cotas superiores.

## Guion para el partner (≈10 minutos)

1. **El pedido** (1 min): mostrar el pedido en lenguaje normal de arriba. «No le digo qué series mirar.»
2. **Descubrimiento** (1 min): `python -B -m galecore_ai.adapters.cli catalog` → aparece `context_research`
   con su método, flujo y controles.
3. **Fuentes reales y sus límites** (2 min): tabla de fuentes; abrir una evidencia
   (`kb show evidence:2026-09-27-spy-ctx-fmp-economics-calendar-denied`) para mostrar que también se guarda
   lo que **no** se pudo obtener, y una de GaleCore con su payload exacto.
4. **El análisis** (3 min): abrir la investigación en Obsidian (`knowledge/research/…spy-contexto…md`) —
   observación vs expectativa implícita vs consenso vs hipótesis; los cuatro escenarios; qué implica para
   la estrategia y la prueba propuesta.
5. **Memoria y aprendizaje** (2 min): `kb show research:2026-09-27-spy-contexto-prima-30-60d` → historial
   r1 → r2 (corrección) → r3 (resultado), cada una con nota de qué cambió; `cited_by` desde la evidencia.
6. **Lo que no demuestra** (1 min): la sección de abajo, dicha tal cual.

## Qué aporte de GaleCore-AI es observable

- Un método descubrible desde el catálogo que selecciona factores por idea y horizonte y fuerza a separar
  tipos de afirmación y a contrastar escenarios (visible en la investigación guardada).
- Evidencia durable, inmutable y citable, con procedencia, que otra sesión puede recalcular
  (`recompute.py` reproduce todos los cálculos propios desde `knowledge/`).
- Memoria con historia: correcciones y resultados como revisiones append-only con hash y nota.
- Controles automáticos: una cita a evidencia inexistente o editada se rechaza; parámetros con aspecto de
  credencial se rechazan (716+ tests; ver el work item).

## Qué todavía no está demostrado

- **Continuidad desde una sesión nueva:** no se ejecutó. El intento de lanzar otra sesión de Claude Code
  desde esta fue bloqueado por los permisos del host. r2 y r3 las escribió esta misma sesión.
- **Que el método mejore el análisis:** no hubo comparación con y sin la skill en estas condiciones.
- **Que la estrategia gane plata:** nada de esto evalúa rentabilidad; la hipótesis no se probó.
- **Que la evidencia sea lo que devolvió la fuente:** GaleCore sí va byte a byte; lo de los conectores lo
  transcribió el host (verificable sólo re-consultando).
- Fiscal, geopolítica, valuación y calendario macro siguen sin fuente.
