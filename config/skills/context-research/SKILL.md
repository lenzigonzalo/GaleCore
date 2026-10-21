---
name: context-research
version: 1.0.0
display_name: Contexto de mercado para una idea
description: >
  Arma el contexto de mercado que necesita una idea, para su instrumento y plazo: qué factores importan y por qué, qué
  fuentes pueden responder cada uno con el acceso que esta sesión realmente tiene, qué muestran los datos, qué
  explicaciones son compatibles y qué implica para investigar la estrategia. Cada respuesta usada queda como evidencia
  con su procedencia; la investigación se guarda y se retoma. No es una estrategia, un pronóstico ni una decisión de
  operar. Para convertir el contexto en una estrategia completa, strategy-design.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«¿Qué contexto importa para vender puts de SPY a 30-45 días?», «¿Qué factores mueven esta idea en este plazo?», antes
de diseñar una estrategia cuando hace falta medir el entorno con datos reales.

## Qué necesita
- `profile show`: aplicar sin volver a preguntar (capital para tamaños, objetivos, horizonte, drawdown y topes como
  marco, fuentes preferidas para desempatar, formato e idioma). Citar `profile:v<N>`. Lo que falta y pesa, a
  `missing`; lo `provisional`, marcado como provisorio.
- `kb search` con los términos de la idea (research y evidence): una investigación abierta sobre lo mismo se sigue.
- Fuentes del registro, no de memoria: `sources query --need "<factor>"` (qué fuentes lo cubren, en orden de uso:
  gratis, GaleCore, cupo diario, plan; con su último acceso y límites) y `sources list`. Para GaleCore y FRED,
  `sources check` reverifica cuando la última observación es vieja. Para un conector del host (Alpha Vantage, FMP u
  otro), probar la llamada mínima y registrar el resultado con `sources declare` antes de usarlo.
- Datos oficiales por GaleCore: series FRED con vintage (`galecore get macro.fred_series --param SeriesId=DFII10
  --param From=<fecha>`), BLS (`macro.bls_series --param Ids=CUUR0000SA0,LNS14000000`), curva del Tesoro
  (`rates.treasury_curve`), subastas (`calendar.treasury_auctions`), historia diaria de VIX, VVIX y SKEW
  (`history.index_daily --param Index=SKEW --param From=...`), presentaciones y cifras a la SEC
  (`filings.sec_filings --param Ticker=NVDA --param Forms=8-K,10-Q`, `filings.sec_facts --param Ticker=NVDA --param
  Tag=Revenues`). Un 502 es la fuente de origen caída: declararlo, sin ir a la web.

## Pasos
1. **Encuadrar antes de buscar:** instrumento, idea (qué ventaja, qué estructura si hay), plazo (tenencia / DTE). Si
   falta el plazo o la idea y cambia qué factores importan, una pregunta corta; mientras tanto, tomar el plazo del
   antecedente más cercano y decirlo.
2. **Elegir factores, no enumerarlos.** Por cada dimensión decir si importa PARA ESTA IDEA Y PLAZO y por qué, o por qué
   queda afuera: tasas y curva; inflación y compensación por inflación; actividad y empleo; resultados y valuación;
   eventos programados dentro del plazo (datos macro, banco central, temporada de balances, vencimientos); opciones y
   volatilidad (nivel, estructura, skew, implícita contra realizada, posicionamiento de dealers); fiscal; geopolítica.
   Fiscal y geopolítica quedan PENDIENTES salvo que se haya consultado una fuente con evidencia adecuada.
3. **Fuentes:** del registro. Una negación, un límite de cuota o un conector que falta es un hallazgo: declararlo y
   anotarlo en `missing`. Que `sources query` no encuentre nada también es un hallazgo, no motivo para adivinar.
4. **Guardar cada respuesta como evidencia ANTES de citarla:** `evidence add --slug <slug> --prompt "<pedido>"` con
   fuente, herramienta, parámetros no sensibles, unidad, fechas de observación, frecuencia y notas de revisión. El
   payload va textual (o un extracto con las filas usadas, diciendo qué quedó afuera). Nunca una clave en los
   parámetros. La evidencia es HOST_DECLARED: nunca decir que un dato externo lo verificó GaleCore.
   ```
   {"content": {"source": "...", "tool": "...", "params": {...}, "retrieved_at": "<UTC ISO>",
                "series": [{"name": "...", "unit": "...", "frequency": "...", "observation_dates": "...",
                            "revision_note": "..."}],
                "payload": "<respuesta textual o extracto>", "payload_scope": "full|excerpt",
                "excerpt_note": "...", "access_notes": ["..."]},
    "host_provider": "...", "host_model": "..."}
   ```
5. **Separar y rotular** cada afirmación: «Observación:» (valor informado, cita `evidence:<id>`); «Cálculo propio:»
   (transformación, cita la evidencia y la fórmula); «Expectativa implícita:» (lo que implican los precios);
   «Consenso (fuente):» (pronóstico publicado por una fuente nombrada); «Hipótesis:» (explicación propia). Los precios
   solos no identifican una causa: 2 a 4 escenarios rivales, con qué observaciones es compatible cada uno, cuáles lo
   contradicen y qué los distinguiría. Nunca un solo relato causal desde precios.
6. **Consecuencias para la estrategia:** qué cambia el contexto en la hipótesis, las condiciones de entrada, el riesgo
   o el plan de prueba; qué falta; una prueba (dato, apoya si, debilita si) con fuentes nombradas.
7. **Guardar:** `research save --capability context_research` citando la evidencia; observaciones nuevas o
   correcciones con `research revise` (result, continuation o correction) diciendo qué cambia y qué queda.
8. **Presupuesto:** declarar las llamadas antes de una corrida larga y preferir la consulta mínima (filtros de fecha,
   un vencimiento, un símbolo). Registrar lo gastado.

## Qué entrega
Un `ResearchContent` (mismo contrato que research): título, pregunta (idea + instrumento + plazo), estado, antecedentes
con su peso, una afirmación por factor (elegido o excluido y por qué), los escenarios comparados, hipótesis, plan de
prueba, faltantes (fiscal / geopolítica si quedaron pendientes), próximos pasos y al menos una limitación. Al trader,
una tabla primero:

| Factor | ¿Importa a 30-45 días? | Dato (fecha, fuente) | Lectura |
|---|---|---|---|
| Tasas y curva | sí: mueve el costo de cobertura | (evidence) | Observación / Expectativa implícita |
| Fiscal | pendiente | — | sin fuente consultada |

## Errores a evitar
- Enumerar todos los factores en vez de elegir los que importan para esta idea y plazo.
- Citar un dato antes de guardarlo como evidencia, o presentar un dato externo como verificado por GaleCore.
- Usar una fuente que no está en el registro o suponer que un conector o plan permite una llamada.
- Un solo relato causal sacado de los precios.

## Cómo responder
Fuentes con `sources query --need`; cada respuesta usada, antes `evidence add`.
Tabla de factores primero (cuál importa para esta idea y plazo, dato con fecha y fuente, lectura rotulada), después
los escenarios rivales y qué cambia para la estrategia. Observación, cálculo, expectativa implícita, consenso e
hipótesis se dicen distinto. No es pronóstico ni consejo de operar.
