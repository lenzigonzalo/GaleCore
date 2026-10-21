---
name: performance-review
version: 2.0.0
display_name: Rendimiento y aprendizaje
description: >
  «¿Cómo viene la estrategia? ¿Cuánto rinde mi cartera contra mi objetivo? ¿Es edge o suerte? ¿Qué aprendo de cada
  cierre? ¿Qué esperábamos cuando decidimos?» GaleCore calcula (por estrategia, versión y regla de salida; la cartera
  contra el capital de referencia; cada cierre contra el nivel que planeaba su regla) y `performance` lo pone contra el
  perfil (objetivo, utilidad mínima, criterio de edge, límites) y las decisiones guardadas. El modelo sólo lo presenta.
  Para qué mirar hoy, daily-attention; para capital disponible, capital-risk.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«¿Cómo viene la estrategia X? ¿Dónde falla?», «¿Cuánto rinde mi cartera contra mi objetivo?», «¿Es edge o suerte?»,
«¿Qué aprendo de cada cierre?», «Resumime la semana de mi cartera».

## Qué necesita
- `performance` (`--strategy <nombre>` para una; trae también `paneles.<nombre>`, el panel SHADOW de GaleCore;
  `--since <AAAA-MM-DD>` para una ventana como la semana).
- Para la semana: `supervise list` (avisos), `story pack` o la última historia del mercado, `contrast pack` o el
  calendario del supervisor (eventos que vienen).
- Todo número sale de su salida: nunca recalcular, reescalar ni redondear; citar «GaleCore App/Runtime/Performance» y
  la versión del perfil que nombra.

## Pasos
1. **Tablas primero:** cartera contra el objetivo (rendimiento, anualizado, objetivo, mínimo, drawdown usado, riesgo
   abierto), por estrategia y versión, y por regla de salida (cantidad, resultado, distancia al plan). Después cada
   cierre: regla que actuó, planeado contra ocurrido, diagnóstico y certeza.
2. **Edge o suerte:** decir `edge.conclusion` tal cual. Con muestra insuficiente: «no hay edge demostrado; es
   anécdota», cualquiera sea el resultado; una racha ganadora no es edge. Mencionar `costos` (fills de SHADOW al medio,
   sin comisiones) y `faltantes` (comparación con efectivo).
3. **Diagnóstico de un cierre:** separar `observado` (un hecho: regla no respetada, fill peor que su nivel) de
   `hipotesis` (la tesis puede estar fallando). Una pérdida dentro del plan es compatible con la estrategia; un stop no
   prueba que la tesis esté mal. `todavia_nada` = no hay nada que cambiar todavía: decirlo en vez de inventar una
   lección.
4. **Decisiones:** por cierre con `decision`, «qué esperábamos» contra «qué ocurrió»; listar `decisiones_a_revisar`
   (llegó la fecha). Si `esperado` está vacío, decir que la decisión no registró una expectativa y ofrecer anotarla la
   próxima vez.
5. **Semana** («resumime la semana»): `performance --since <lunes>`. La semana es `ventana` (cierres desde el lunes:
   resultado y por regla) y `operaciones`; `cartera`, `edge` y los desgloses quedan acumulados (ver `alcance`): decir
   cuál es cuál. Una sección corta por pieza (avisos, historia, eventos que vienen); decir cuál no se pudo leer.
6. **«¿Cómo viene X? ¿Dónde falla?»** con `paneles.X` (`pedido_con` dice qué del perfil se le pasó): resultado y máxima
   caída; acierto, ganancia y pérdida promedio, factor de ganancia, esperanza, peor operación y racha de pérdidas;
   `regime` (VIX, IV Rank, gamma), `byExitRule` y `byVersion` para decir DÓNDE gana y DÓNDE pierde; `references` contra
   el objetivo; `hypothesis` (muestra, no edge); `execution` (cruce del bid/ask). Un `Metric` con `value: null` va con
   su `reason`, nunca como 0 ni guion mudo; mostrar `notes` y `smallSample`. Con pocas cerradas, «dónde falla» es una
   pista, no un hallazgo. Sharpe/Sortino son por operación. Sin `paneles.X` (404, sin persistencia): decir que no se
   pudo leer (`faltantes`) y seguir.
7. **Sin cambios de reglas desde acá:** con muestra insuficiente, cambiar reglas es ajustar ruido. Si el owner quiere,
   es una versión nueva por strategy-design, con aprobación.

## Qué entrega
Ejemplo de forma:

Sin edge demostrado todavía (9 cerradas, el criterio pide 30); el resultado SHADOW va por encima del mínimo.

| Estrategia (SHADOW) | Cerradas | Resultado | Acierto | Peor | Por regla |
|---|---|---|---|---|---|
| (de `performance`) | | | | | |

Después: cada cierre (planeado contra ocurrido) y las decisiones a revisar.

## Errores a evitar
- Presentar la variación semanal/mensual/anual de la cuenta real (`account.overview` `periods`) como rendimiento: incluye
  depósitos y retiros; con ese dato el rendimiento no se puede determinar.
- Llamar edge a una racha ganadora, o inventar una lección cuando `todavia_nada`.
- Mostrar un `Metric` nulo como 0.
- Mezclar SHADOW con lo real: nombrarlo «SHADOW».
- Proponer cambios de reglas con muestra insuficiente.

## Cómo responder
Primero `performance` (`--strategy <nombre>` para una, `--since <lunes>` para la semana).
Tablas primero (cartera contra objetivo, por estrategia y versión, por regla de salida), números de `performance` tal
como vienen, `edge.conclusion` dicho tal cual y SHADOW nombrado como tal. Texto mínimo; sin proponer cambios de reglas
con muestra chica.
