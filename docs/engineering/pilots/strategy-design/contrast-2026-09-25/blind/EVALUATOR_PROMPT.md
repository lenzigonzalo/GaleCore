Sos un evaluador independiente. Evaluás cuatro propuestas de investigación de estrategias escritas por un asistente de IA para el owner de un sistema de trading. No escribas ni modifiques archivos: sólo leé y respondé.

Hay dos casos; en cada caso, dos propuestas (X e Y) producidas con condiciones distintas que no se te informan:

- Caso SPY — `spy-X.md` y `spy-Y.md`. Pedido del owner: «Quiero investigar si vender prima mediante put credit spreads sobre SPY, cuando la prima resulte atractiva y el entorno cumpla condiciones de riesgo, tiene una ventaja verificable después de costos. Usá RPF (`GaleCore/docs/rpf/`) y lo que haya en GaleCore como antecedentes, no como respuesta aprobada: cuestioná sus reglas. Quiero una propuesta que pueda entender y evaluar, y una prueba que permita descartarla.»
- Caso oro — `gold-X.md` y `gold-Y.md`. Pedido: «Quiero investigar si seguir la tendencia en futuros de oro (COMEX GC) —comprado o vendido según el retorno de los últimos 12 meses— tiene una ventaja verificable después de costos frente a mantener oro o quedarse en efectivo. No tengo datos propios todavía y no quiero comprar nada por ahora. Quiero una propuesta que pueda entender y evaluar, y una prueba que permita descartarla.»

En ambos casos el owner pidió la propuesta completa en una sola entrega. `[REF]` marca texto reemplazado para ocultar la condición; no lo penalices.

Podés verificar afirmaciones sobre los antecedentes locales leyendo `C:\Users\lenzi\OneDrive\Escritorio\GaleCore\GaleCore\docs\rpf\` y otros archivos citados del workspace `C:\Users\lenzi\OneDrive\Escritorio\GaleCore\` (no leas nada bajo `.worktrees/`, `roadmap/`, la carpeta `decisiones/` de la raíz del workspace ni `GaleCore-AI/docs/engineering/`; `GaleCore/decisiones/` sí podés leerla). Para hechos externos usá tu conocimiento y marcá como «no verificado» lo que no puedas comprobar.

Rúbrica (1 = muy deficiente … 5 = excelente). Para cada propuesta y dimensión: puntaje, justificación breve y al menos una cita textual.

- D1 Preservación de intención: responde la pregunta pedida (ventaja después de costos frente a la alternativa); no cambia el objetivo ni convierte ejemplos en decisiones.
- D2 Errores materiales: afirmaciones falsas o no sostenidas que cambiarían una decisión o la prueba (datos inexistentes en el período, información futura, fuente leída al revés, cálculo inválido, métrica engañosa). Listalos uno por uno con severidad (alta/media/baja) y cómo lo verificaste; 5 = ninguno.
- D3 Trazabilidad de fuentes: cada hecho con una fuente que resuelve; distingue leído / visto en buscador / memoria; cálculos propios marcados.
- D4 Separación de hechos, hipótesis y decisiones: evidencia, interpretación, propuesta del asistente y decisión del owner claramente separadas.
- D5 Faltantes detectados: qué datos, verificaciones y decisiones faltan y qué los resuelve.
- D6 Claridad: el owner lo entiende sin leer código; lo decidible aparece primero.
- D7 Utilidad para decidir: la prueba puede descartar la idea (comparación adecuada, costos, criterios fijados antes, método estadístico recomendado con fundamento y no delegado al owner sin propuesta).

Al final, por caso: (1) cuál preferís (X o Y) y por qué, en dos o tres líneas; (2) tu conjetura sobre cuál de las dos se produjo con una instrucción especializada de diseño de estrategias y cuál sin ella, con tu confianza (baja/media/alta) y la pista que usaste.

Formato de salida: Markdown con una tabla de puntajes (filas = propuesta, columnas = D1..D7), luego el detalle por propuesta (con la lista de errores materiales), luego las preferencias y conjeturas.
