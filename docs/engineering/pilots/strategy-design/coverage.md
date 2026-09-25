# Cobertura del diseño

Revisar todos los bloques comunes. Profundizar las ramas aplicables; si varias aplican, combinarlas.
Cada dimensión relevante tiene contenido o pendiente/bloqueo/no aplica justificado, según SKILL.md.
Estas instrucciones piden verificar condiciones específicas, no afirman términos vigentes de contratos.

## Común

| Bloque | Decisiones y comprobaciones |
|---|---|
| Mandato e identidad | Nombre por propósito (no sólo estructura), versión, usuario, objetivo y prioridad entre objetivos; moneda, benchmark/alternativa de no operar, horizonte de evaluación, capital asignable, liquidez/retiros requeridos, pérdida tolerable y tiempo de atención. |
| Tesis y contexto | Mecanismo económico o intención de exposición/cobertura; evidencia a favor/en contra, supuestos, alternativas, contexto favorable/adverso, condiciones de abstención e invalidación. No exigir un filtro de régimen si no aporta al caso. |
| Universo | Identificador exacto, tipo de instrumento, subyacente, mercado, jurisdicción, moneda, intermediario/acceso, elegibilidad, dirección, exclusiones, selección y actualización del universo. |
| Datos y variables | Fuentes/licencias/costo/acceso, cobertura histórica, frecuencia, zona horaria/calendario, unidades, ajustes, frescura, timestamps de evento/publicación/recepción, disponibilidad point-in-time por insumo (también benchmarks, tasas y costos), revisiones, faltantes/outliers, fórmula/transformación/ventanas y versión de cada feature. |
| Señal y selección | Condición exacta, filtros, confirmación, hora/evento de evaluación, duración/expiración de señal, ranking/desempate entre candidatos, repetición/reentrada, operación única o recurrente. |
| Construcción | Patas, ratios, contratos, vencimientos, selección y sustituciones admisibles, exposición económica y escenarios; cubrir todo el ciclo de una restricción, no sólo la foto inicial. |
| Sizing y cartera | Capital base, unidades/lotes/redondeo, riesgo y capital por posición, margen/garantías, financiación, reservas, exposición bruta/neta/factorial, concentración/correlaciones, posiciones simultáneas, acumulación, capacidad y prioridad si falta capital. El stop no es garantía de precio de ejecución. |
| Ejecución | Horarios/sesiones, orden y precio, vigencia, bid/ask y liquidez, spread/comisiones/slippage/impacto, latencia, límites de participación, órdenes parciales/rechazadas/duplicadas, cancelación/reintentos y reconciliación. No asumir fills a mid por defecto. |
| Gestión y salidas | Frecuencia y responsable, toma de ganancias/pérdidas si aplica, tiempo, señal contraria/tesis, eventos, trailing, rebalanceo, ajustes/roll o exclusión explícita; prioridad si coinciden disparadores, gaps y falta de contraparte. |
| Riesgo operacional | Datos corruptos/ausentes, broker/red fuera de servicio, exposición inesperada, límites y alertas, pausa de entradas versus gestión de posiciones abiertas, responsable y contingencia manual cuando no pueda automatizarse. |
| Eventos y obligaciones | Dividendos/splits, halts/delistings, vencimientos, liquidación/entrega, ejercicio/asignación, pagos, garantías, tributación/regulación aplicable y fuente vigente. No resolver obligaciones legales desde memoria. |
| Medición | P&L realizado/no realizado, ingresos y cashflows, reinversión, FX, costos e impuestos según alcance; retorno total/benchmark, drawdown y duración, pérdidas de cola, frecuencia/magnitud de ganancias y pérdidas, exposición/capacidad, incertidumbre y objetivo de cobertura si aplica. Elegir métricas interpretables para la muestra, no un panel obligatorio de ratios. |
| Evaluación | Datos requeridos/disponibles, baseline como cartera comparable (calendario, capital, restricciones, efectivo), variantes declaradas, método, muestra y dependencias, sesgos, separación temporal y múltiples pruebas cuando corresponda, sensibilidad, escenarios, criterio ex ante y resultado inconcluso, con el cumplimiento de restricciones juzgado aparte; fidelidad/limitaciones del simulador y seguimiento prospectivo. |
| Ciclo de vida | Registro de decisiones/experimentos, versiones, política de ajuste, monitoreo de degradación, revisión/retiro, responsables, condiciones y aprobaciones para pasos posteriores; vínculo entre propuesta, prueba y resultados sin modificar retrospectivamente reglas. |

## Ramas condicionales

- **Opciones:** verificar estilo de ejercicio, entrega y liquidación, multiplicador/ajustes, liquidez
  de cada pata y del conjunto, selección de strikes/DTE, volatilidad/superficie/griegas necesarias,
  dividendos, asignación anticipada, riesgo cerca del vencimiento y exposición tras ejercicio/fill
  parcial. Si se prohíbe naked, resolver entrada, mantenimiento y salida; no prometer que una orden
  combinada elimina toda contingencia. No equiparar delta con probabilidad empírica de ganar.
- **Futuros:** contrato/mes y tamaño/tick, margen y ajustes diarios, liquidación/entrega, límites de
  precio, calendario/roll, curva y basis cuando aplique; distinguir serie continua ajustada de precios
  realmente negociables. No dimensionar por margen como si fuera pérdida máxima.
- **Acciones/ETFs y shorts:** composición histórica, acciones corporativas, liquidez, suspensiones,
  delisting, dividendos, localización/préstamo/costo/recall si short, exposición sectorial y concentración.
- **Penny stocks o sentimiento/noticias:** identidad y universo histórico, salida factible ante falta
  de liquidez; procedencia, timestamps, cobertura, duplicados/bots/manipulación, idioma, modelo de
  sentimiento y cambios de versión. Separar noticia conocida entonces de clasificación hecha después.
- **Bonos/crédito:** identificador/serie y prospecto, emisor/ley aplicable, moneda de negociación/pago,
  clean/dirty y devengados, nominal/mínimo, flujos/cupones/amortización/indexación, rescate/default/
  reestructuración, liquidez, riesgo de tasa/crédito/FX y reinversión. Para Argentina verificar términos
  locales concretos; no asumir que ticker, moneda o jurisdicción determinan todos los flujos.
- **FX/cripto:** par/base de cuenta, spot/derivado, sesiones, venue/custodia/contraparte, funding,
  colateral/liquidación y límites de transferencia. Si hay protocolos, identificar riesgos específicos.
- **Multiinstrumento, arbitraje o cobertura:** sincronización, ratios, basis/correlación cambiante,
  descalce de plazos/monedas, fallos de una pata, coste de carry y exposición residual; medir el
  objetivo conjunto, no sólo P&L de cada componente.
- **Fundamental/macro/eventos:** fuentes primarias, fechas efectivas/publicación/revisiones, sorpresa
  frente a expectativa, mecanismo/catalizador y horizonte; no usar información retrospectiva.
- **ML o señales aprendidas:** objetivo/labels, universo y datos point-in-time, splits temporales,
  solapamiento/purga cuando aplique, entrenamiento y selección separados del test, versiones,
  incertidumbre/drift, costo de inferencia y fallback. No asumir necesidad de ML.
- **Compra única o discrecional:** preservar intención, definir exposición, capacidad de pérdida,
  flujos, horizonte y circunstancias de revisión/salida; permitir mantener a vencimiento con sus
  riesgos explicitados. No inventar una regla repetitiva, edge ni obligatoriedad de stop/roll/backtest.
- **Instrumento/mecanismo no cubierto:** obtener términos primarios y reconstruir ciclo completo
  de efectivo, obligaciones, exposición, salida y fallas. Agregar requisitos encontrados; si no se
  comprenden, bloquear sólo la decisión dependiente y pedir la especialización faltante.
