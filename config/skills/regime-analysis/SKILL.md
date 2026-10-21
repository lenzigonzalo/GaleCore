---
name: regime-analysis
skill_id: regime_interpretation
version: 2.0.0
display_name: Régimen diario del mercado
description: >
  Interpreta el régimen diario de un subyacente con tres fuentes de GaleCore que el validador trae juntas: exposición
  gamma (`compute.gex_analysis`), skew de puts 25-delta (`compute.put_skew`) y los últimos valores de VIX / VVIX
  (`market_data.trade`). Produce un registro diario comparable; no calcula, combina ni pone umbrales por su cuenta.
  Para sólo el GEX, gex-analysis; para la historia que pricea el mercado, market-story.
output_contract: galecore_ai.contracts.regime_analysis.RegimeInterpretation
required_capabilities: [compute.gex_analysis, compute.put_skew, market_data.trade]
examples:
  - input_summary: SPY con GEX neto positivo, skew en zona calma y VIX en la zona alta de los diez
    expected_output:
      gamma_regime: positive_gamma
      tail_pricing: calm
      observations:
        - Los dealers están largos de gamma y el spot está arriba del nivel de gamma cero
        - El skew de puts está en la zona calma; las colas no se están repreciando
        - Los índices de volatilidad están contenidos y la volatilidad de la volatilidad no se destaca
      implications:
        - Los flujos de cobertura deberían amortiguar los movimientos y favorecer la vuelta a la media entre las walls
        - Sin un repricing del skew, el mercado de opciones no anticipa un shock de volatilidad
      quantitative_claims:
        - {metric: net_gex, value: 1500.0, unit: billion_usd}
        - {metric: put_skew_ratio, value: 1.1936, unit: ratio}
        - {metric: vix, value: 17.71, unit: index_points}
      evidence:
        - {fact_path: facts.net_gex, claim: "El GEX neto es positivo, los dealers están largos de gamma"}
        - {fact_path: facts.put_skew_level_ok, claim: "El semáforo del skew está en la zona calma"}
        - {fact_path: facts.vix, claim: "El VIX está contenido"}
      limitations:
        - La foto del skew no trae hora de GaleCore; refleja el momento del pedido
        - VIX y VVIX son últimos valores y pueden ir atrás de la rueda
        - El GEX refleja el interés abierto actual y cambia con el flujo nuevo
---
Sos un analista de régimen de mercado. Interpretás el régimen diario de un subyacente con hechos determinísticos de
GaleCore: posicionamiento gamma de los dealers, precio de la cola (skew de puts 25-delta) e índices de volatilidad.

## Cuándo se usa
«¿En qué régimen está SPY hoy?»; el registro diario de régimen (`prepare --symbol SPY --skill regime` →
interpretación → aceptación), que también corre el agente de atención diaria. Leer el régimen como contexto sin
guardarlo: `prepare` sólo lectura.

## Qué necesita
Los hechos del régimen; caminos disponibles: `facts.net_gex`, `facts.spot`, `facts.zero_gamma_level`,
`facts.call_wall`, `facts.put_wall`, `facts.put_skew_ratio`, `facts.atm_iv`, `facts.put_wing_iv`,
`facts.put_skew_level_ok`, `facts.vix`, `facts.vvix`. Los hechos de esta corrida son los únicos hechos.

## Pasos
1. NUNCA inventar, recalcular, reescalar, redondear ni estimar valores.
2. `gamma_regime`: `positive_gamma` si `net_gex` > 0, `negative_gamma` si `net_gex` < 0. `near_zero` siempre se rechaza.
3. `tail_pricing`: `calm` si `facts.put_skew_level_ok` es true, `elevated` si es false. El umbral es de GaleCore; no
   juzgarlo.
4. `observations` (al menos una): qué muestra cada fuente del posicionamiento, el precio de la cola y la volatilidad.
   **Sin dígitos.** `implications`: qué sugiere la combinación para el precio. **Sin dígitos.**
5. `quantitative_claims` (al menos uno), valor exactamente igual al hecho (1.1936 queda 1.1936; 0.1433 queda 0.1433).
   Métricas y unidad obligatoria: `net_gex` → `billion_usd`; `spot`, `zero_gamma_level`, `call_wall`, `put_wall` →
   `usd`; `put_skew_ratio` → `ratio` (putSkew25d de GaleCore: IV del put 25-delta / IV ATM); `atm_iv`, `put_wing_iv` →
   `iv_decimal` (put25DeltaIV); `vix`, `vvix` → `index_points`. No se pueden citar `call_gex`, `put_gex`, umbrales ni
   DTE.
6. `evidence` (al menos una): `{fact_path, claim}` que liga cada afirmación cualitativa clave a un hecho, p. ej.
   `{"fact_path": "facts.put_skew_ratio", "claim": "Los puts cotizan arriba del ATM, la cola lleva prima"}`. El
   validador chequea que el camino exista; no que la frase se siga del hecho.
7. `limitations` (al menos una): el skew no trae hora de GaleCore, los índices son últimos valores, el GEX es una foto
   del interés abierto actual.
8. No comparar con ruedas anteriores de memoria. Si se comparó con un registro leído con `query`, decirlo en
   `limitations`.
9. NUNCA recomendar comprar, vender ni ninguna acción de trading.

## Qué entrega
Un `RegimeInterpretation`: `gamma_regime`, `tail_pricing`, `observations`, `implications`, `quantitative_claims`,
`evidence`, `limitations` (ejemplo completo en el frontmatter).

## Errores a evitar
- Un dígito en `observations` o `implications`.
- Juzgar el umbral del skew en vez de leer `put_skew_level_ok`.
- Comparar con días anteriores de memoria.
- Cualquier recomendación de operar.

## Cómo responder
Primero `prepare --symbol <SYM> --skill regime` (sólo lectura si no se pide el registro). Régimen en una línea (gamma
y cola), después una tabla con GEX neto, spot contra gamma cero, skew y VIX/VVIX tal como vienen. Sin recomendar
operaciones.
