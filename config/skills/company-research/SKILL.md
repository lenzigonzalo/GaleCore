---
name: company-research
version: 1.1.1
display_name: Investigar o seleccionar empresas
description: >
  «Analizame MSFT», «investigá NVDA», «¿qué tal está AAPL a este precio?», «de MSFT, AAPL y NVDA, ¿cuál tiene
  tendencia alcista y fundamentos que la sostengan?». Dos recorridos: Investigar entiende una empresa aunque no cumpla
  ningún criterio (negocio, calidad, salud financiera, valoración, eventos, riesgos); Seleccionar compara una lista
  contra un criterio declarado. Junta y calcula el código (`analyze pack`, `analyze company`); el modelo interpreta: la
  tesis, qué tiene que pasar en 6-12 meses para que funcione y qué la rompe. Lectura: no recomienda comprar ni vender.
  Para la macro o el flow de un índice, on-demand-analysis.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
Una empresa a entender («analizame MSFT») o varias a comparar contra un criterio («¿cuál de estas tiene tendencia y
fundamentos?»). El pedido fija el objetivo, el plazo y el criterio; la respuesta lo sigue, sin bloques fijos.

## Qué necesita
- Datos del día, siempre de nuevo: `analyze pack --kind fundamental --symbol SYM --prompt "<pedido>"`, `analyze pack
  --kind technical --symbol SYM` (también SPY o un ETF de comparación) y, si hace falta, `analyze pack --kind macro`.
- Varias empresas: `analyze company --symbols A,B,C --prompt "<pedido>"` (cifras lado a lado, fuerza relativa contra
  SPY y un ETF del sector por defecto; ~1 min). Si ese ETF representa mal el negocio, pedir el pack técnico de otro.
- El 10-K cuando el pedido lo necesita: `galecore get filings.sec_document --param Ticker=SYM --param Items=1,1A,7
  --param MaxChars=30000 --keep "<pedido>"`.
- `profile show`; `kb search --kind research --text "empresa <símbolo>"` y `kb show <ref>`: una investigación guardada
  es antecedente para decir qué cambió, nunca la fuente de los números.

## Pasos
1. Decidir el recorrido: **Investigar** (una empresa: negocio, calidad, salud financiera, valoración, eventos,
   riesgos) o **Seleccionar** (una lista contra un criterio declarado). Si el pedido es amplio y no trae lista («qué
   tecnológicas tienen más potencial»), Seleccionar empieza por el universo: qué se revisa, por qué esas y con qué
   criterio, con el plazo y el riesgo del perfil como supuestos dichos; preguntar sólo si cambian la respuesta.
2. Traer los packs. Lo que da el fundamental: trimestres reportados a la SEC (crecimiento, márgenes, flujo libre,
   capex, deuda neta con lo que incluye, dilución, capital devuelto, P/E con su propia historia, múltiplos EV, parte no
   operativa del resultado antes de impuestos, próximo balance). Técnico: promedios, rendimientos, volatilidad
   realizada contra IV. Competidores o ETF de comparación cuando el pedido los necesita: GaleCore sirve el pack de
   cualquier empresa listada, así que «no hay datos de competidores» no vale sin haberlo pedido.
3. Valorar por modelo de negocio, no un múltiplo para todas: el P/E solo engaña si el resultado no operativo pesa
   (`non_operating_share_pct`) o en financieras y cíclicas. Una brecha entre dos líneas (EPS contra resultado
   operativo, caja contra ganancia) es una pregunta a descomponer, no una conclusión.
4. Interpretar: la tesis, qué tiene que pasar en 6-12 meses para que funcione y qué la rompe. Cada cifra con su fecha
   y fuente; lo que los packs declaran faltante (consenso más allá del próximo EPS, guía, noticias) se dice cuando
   importa para la respuesta. Escenarios o sensibilidades propias muestran supuestos y cuenta.
5. Si es una investigación (no una consulta al paso), guardarla: `research save --capability company_research --slug
   empresa-<símbolo>` o `seleccion-<tema>`; si existe, `research revise --capability company_research --id <id>
   --reason continuation --note "<qué cambia>"`.

## Qué entrega
Lo que pide el pedido, como se entienda mejor. En Seleccionar, primero las que pasan y por qué, con las cifras que
deciden la comparación, en el mismo orden en toda la respuesta; lo que no cambia la conclusión no entra. Una forma
posible (Seleccionar):

De las tres, sólo MSFT tiene tendencia y fundamentos que la sostienen; NVDA tiene tendencia pero el flujo libre no
acompaña la ganancia (pregunta abierta).

| Empresa | Sobre media 200 | Crec. ingresos 4T | Margen operativo | Flujo libre / ganancia | P/E vs su rango |
|---|---|---|---|---|---|
| (del pack) | | | | | |

Después: qué tiene que pasar en 6-12 meses, qué lo rompe y qué falta.

## Errores a evitar
- Usar los números de una investigación guardada en vez de traer el pack de hoy.
- Un solo múltiplo para todas (P/E en una financiera o con resultado no operativo grande).
- Tomar el flujo libre del pack como de la empresa: es del accionista.
- Leer la media de 200 ruedas como corte de pérdida.
- Aconsejar comprar o vender: el posicionamiento es otro paso.

## Cómo responder
Datos del día, siempre de nuevo (`analyze pack` o `analyze company` para varias). Competidores, ETF de comparación y
10-K cuando el pedido los necesita. Sin lista dada, decí qué universo revisaste y con qué criterio; primero las que
pasan, cada conclusión con la cifra que la sostiene; lo que no cambia la conclusión, afuera. Valorar por modelo de negocio; el flujo libre del pack es del accionista; la media
200 no es un corte de pérdida; escenarios con supuestos y cuenta a la vista. Lectura, no consejo de compra o venta.
Si es una investigación, guardala o revisá la anterior.
