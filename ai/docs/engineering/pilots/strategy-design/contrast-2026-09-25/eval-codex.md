## Tabla de puntajes

| Propuesta | D1 | D2 | D3 | D4 | D5 | D6 | D7 |
|---|---:|---:|---:|---:|---:|---:|---:|
| SPY-X | 4 | 2 | 5 | 5 | 5 | 4 | 3 |
| SPY-Y | 5 | 2 | 5 | 5 | 5 | 4 | 4 |
| Oro-X | 5 | 4 | 5 | 5 | 5 | 5 | 5 |
| Oro-Y | 2 | 2 | 4 | 5 | 4 | 5 | 2 |

Para comprobar los antecedentes de SPY contrasté las propuestas con el libro mayor de backtesting, la reconciliación, la definición vigente, el JSON y `GaleCore/decisiones/D-0001`. Allí se confirman, entre otros puntos, la interpolación delta 0,25 + GEX, el agotamiento de 2018–2025, los $2.723/10,6 trades por año de BT-17 C y la contradicción documental sobre GEX.

Para oro contrasté los puntos principales con fuentes primarias: AQR confirma la regla de retorno excedente de 12 meses, tenencia de un mes, 58 contratos y resultado positivo por contrato; CME confirma las especificaciones de GC/MGC; la documentación oficial de GLD dice que replica oro físico menos gastos, no una estrategia de futuros con roll. [AQR](https://www.aqr.com/Insights/Datasets/Time-Series-Momentum-Factors-Monthly), [CME](https://www.cmegroup.com/trading/metals/files/fact-card-gold-futures-options.pdf), [GLD](https://www.spdrgoldshares.com/usa/gld/).

# Caso SPY

## SPY-X

### D1 — Preservación de intención: 4/5

Responde directamente si hay ventaja neta y separa correctamente tres preguntas: si paga la estructura, si agregan valor los filtros y si supera las alternativas. Cita: “**H-A:** el PCS en sí paga, neto de costos… **H-B:** los filtros de RPF agregan algo… **H-C:** el resultado supera a la alternativa sin riesgo… y a la exposición equivalente a SPY”.

No obtiene 5 porque la comparación con SPY termina descansando principalmente en una regresión lineal, no en una cartera invertible con riesgo de cola comparable, y el umbral económico queda delegado al owner.

### D2 — Errores materiales: 2/5

El problema principal está en la supuesta ventana independiente: “Para 2005–2007 no hay historia previa; la regla congelada es **calibrar con 2013–2017 y aplicarla hacia atrás**”. Eso introduce información futura en la prueba que se presenta como ejecutable e independiente.

#### Errores materiales

1. **Alta — información futura en la Etapa 1.**  
   Se llama a 2005–2012 “una ventana que nadie miró” y “la única prueba retrospectiva” con valor, pero para parte de ella se calibra la tabla POP con 2013–2017. Una estrategia histórica no habría tenido acceso a esos datos. Lo verifiqué comparando las fechas declaradas por la propia propuesta; no depende de una fuente externa. Puede cambiar el resultado del gate `edge_emp` y, por tanto, el veredicto.

2. **Media — “SPY delta-equivalente” no queda realmente construido.**  
   La propuesta dice: “**SPY delta-equivalente** (regresión del P&L diario contra SPY, que da alfa y beta)”. Una regresión lineal no replica la exposición no lineal y de cola de un credit spread. Un alfa positivo o negativo puede depender de convexidad, volatilidad y cambios de delta, no sólo de una ventaja frente a una cartera alternativa. Lo verifiqué por la definición matemática de un vertical y por los antecedentes RPF, que muestran pérdidas acotadas pero muy asimétricas.

3. **Media — E1-5 usa una condición insuficiente para refutar el edge.**  
   “El factor put `p_real/δ`… ≥ 0,9” descarta el fundamento de `edge_emp`. Pero el valor esperado depende del crédito, la distribución de pérdidas dentro del ancho, costos y política de salida; no solamente de la probabilidad de acabar ITM. El cociente puede ser 0,9 y el spread seguir teniendo EV positivo, o ser menor y no tenerlo.

No encontré errores en los cálculos binomiales declarados: los órdenes de magnitud de 7 %, 20 %, 3,5 % y 2,1 % son consistentes.

### D3 — Trazabilidad de fuentes: 5/5

El registro distingue archivos leídos, búsquedas, páginas abiertas y cálculos propios. Cita: “**Cálculos propios** — Binomial y break-even de la §3.2 (Python, en línea)”. También explicita qué scripts no leyó y qué supuso sobre `mark`.

Las afirmaciones locales importantes coinciden con RPF: interpolación de la configuración final, C4 fallido, ventana agotada, GEX sostenido por agosto de 2015 y aproximadamente $340/año por contrato.

### D4 — Separación de hechos, hipótesis y decisiones: 5/5

La separación es explícita desde el inicio: “Estado: **hipótesis. No está validada ni aprobada**” y “**Qué espero, sin haberlo corrido**”. También diferencia resultados medidos, interpolados y decisiones del owner.

### D5 — Faltantes detectados: 5/5

Identifica datos, decisiones y limitaciones operativas concretas: compra de cadenas 2005–2012, ambigüedad de GEX, umbral económico, reglas defensivas no simuladas y riesgo de asignación. Cita: “**Requiere decisión del owner:** comprar cadenas EOD de SPY 2005–2012… No contacté proveedores ni consulté precios”.

El faltante más grave —la ausencia de historia previa para POP— está detectado, aunque la solución elegida es metodológicamente inválida.

### D6 — Claridad: 4/5

El resumen permite entender la conclusión y las tres etapas sin código: “Etapa 0… sólo puede descartar… Etapa 1… ventana que nadie miró… Etapa 2… seguimiento prospectivo”. Es más larga de lo necesario y algunos criterios técnicos aparecen antes de explicar sus consecuencias económicas.

### D7 — Utilidad para decidir: 3/5

Tiene varias fortalezas: brazos mecánico/entorno/RPF, costos base y estresados, criterios previos y veredictos parciales. Cita: “M2g no supera a M0… **los filtros se descartan**”.

Pierde dos puntos porque la etapa retrospectiva que pretende aportar evidencia independiente contiene información futura, y porque el benchmark accionario no es una cartera verdaderamente comparable. La Etapa 0 y el seguimiento prospectivo sí sirven para descartar.

---

## SPY-Y

### D1 — Preservación de intención: 5/5

Es la propuesta que formula con mayor precisión la pregunta económica: “La pregunta útil no es ‘¿gana?’ sino ‘¿gana más que una cartera **SPY+T-bill con el mismo riesgo, después de costos?**’”. Además compara la estrategia condicionada con la misma PCS mecánica, por lo que no confunde “venta de prima” con “valor de los filtros”.

### D2 — Errores materiales: 2/5

Aunque el objetivo está bien planteado, la implementación del benchmark principal no garantiza el “mismo riesgo”. También hay una inconsistencia importante en el modelo de fills.

#### Errores materiales

1. **Alta — equipara delta media con riesgo equivalente.**  
   B-EQ usa un peso fijo de SPY “elegido ex ante para igualar la **exposición delta media en dólares** de V-RPF”. Eso iguala una sensibilidad local promedio, no max drawdown, CVaR, exposición en crashes ni convexidad. El benchmark puede ser mucho menos peligroso en la cola que el PCS o viceversa. Como R1 usa el exceso sobre B-EQ para refutar la estrategia, el error puede cambiar el veredicto.

2. **Media — escenarios F2/F3 internamente inconsistentes.**  
   Declara “F2: mid − 50 % del ancho bid/ask… (≈ RPF $6,30)” y “F3: natural completo (≈ RPF $9,30)”. Desde el mid hasta el natural hay 50 % del bid/ask completo; por tanto, tal como está escrito, F2 ya sería el natural. El antecedente local RPF define aproximadamente $6,30 con un cuarto del spread por vía y $9,30 al natural por vía. Hay que aclarar si “50 %” se aplica al spread completo o al semispread.

3. **Media — el criterio de valor incremental usa una unidad de riesgo discutible.**  
   “P&L / Σ pérdida máxima × días abiertos” trata la pérdida máxima contractual como exposición diaria homogénea. No refleja que el riesgo aumenta con spot, IV y proximidad al short. Puede favorecer filtros que simplemente reducen días en mercado sin demostrar mayor utilidad económica.

Los cálculos de 2 pérdidas en 85 operaciones, ganancia media aproximada de $43 y frecuencia de equilibrio de 9,3 % son coherentes con BT-17.

### D3 — Trazabilidad de fuentes: 5/5

El documento deja registro detallado de archivos, búsquedas, páginas leídas y documentos no legibles. Cita: “**Fuentes citadas a partir de resultados de búsqueda (no leídas completas)**”. Esta distinción evita presentar un snippet o abstract como lectura completa.

### D4 — Separación de hechos, hipótesis y decisiones: 5/5

Distingue muy bien mandato, tesis, antecedentes, propuesta y decisiones. Cita: “**Alcance de este resultado:** definición + crítica de antecedentes + plan de prueba pre-declarado. No hay corridas nuevas”. La matriz de cobertura también separa `definida`, `pendiente` y `supuesto`.

### D5 — Faltantes detectados: 5/5

Detecta hora del snapshot, fecha efectiva del OI, costo histórico, broker, jurisdicción, capital, tolerancia de pérdida y utilidad mínima. Cita: “proveedor, licencia, hora de snapshot y momento del OI sin verificar”. Cada pendiente tiene responsable y efecto bloqueante.

### D6 — Claridad: 4/5

La “Síntesis” pone primero lo decidible y las cuatro decisiones del owner. Cita: “**lo que podés leer y decidir hoy**”. Es comprensible, pero el volumen y algunas tablas operativas exceden lo necesario para decidir si autorizar la investigación.

### D7 — Utilidad para decidir: 4/5

La secuencia integridad → restricciones → refutación → supervivencia → apoyo es excelente. Cita: “**Ningún resultado de 2013–2025 puede producir APOYO**”. También fija bootstrap, costos, comparación con PCS mecánica y etapa prospectiva.

No obtiene 5 porque el benchmark primario B-EQ no es realmente de igual riesgo y los escenarios de fill son ambiguos. Ambos son reparables sin rediseñar toda la propuesta.

# Caso oro

## Oro-X

### D1 — Preservación de intención: 5/5

Conserva exactamente GC, el lado comprado/vendido, los costos y los dos comparadores. Cita: “¿Esa regla, **después de costos**, le gana a (a) mantener oro siempre y (b) quedarse en efectivo, con el mismo capital y el mismo calendario?”.

También respeta “no comprar nada por ahora”: no compra datos ni contacta proveedores, y presenta la futura adquisición como decisión del owner.

### D2 — Errores materiales: 4/5

No encontré errores que invaliden la prueba. Sí hay una imprecisión cronológica.

#### Errores materiales

1. **Baja — llama “posterior a la publicación” a todo 2010–presente.**  
   Cita: “Aplicarla… a 2010-07 → presente es una **prueba posterior a la publicación**”. El paper se publicó en 2012; 2010–2011 es posterior a la muestra del paper, pero no a su publicación. No invalida el OOS respecto de 1985–2009, aunque sí exagera su independencia respecto de la difusión pública.

No penalicé como errores los settlements, FND, TAS o cobertura exacta de Databento porque la propia propuesta los marca como pendientes de verificación. La disponibilidad exacta desde 2010-06 en Databento queda **no verificada** por mí: la página de catálogo no expuso ese dato sin JavaScript.

### D3 — Trazabilidad de fuentes: 5/5

Es la trazabilidad más rigurosa de las cuatro: especifica qué se leyó, qué vino de búsquedas, qué PDF pudo extraerse y qué resultado del oro no pudo comprobarse. Cita: “La cifra propia del oro… **no se pudo leer de forma confiable**”.

La regla académica central sí queda confirmada por AQR: retorno excedente de 12 meses, holding de un mes y 58 instrumentos. [AQR](https://www.aqr.com/Insights/Datasets/Time-Series-Momentum-Factors-Monthly).

### D4 — Separación de hechos, hipótesis y decisiones: 5/5

Cita: “**Mecanismo (hipótesis, no hecho)**” y “impulsores plausibles… **hipótesis del host, sin fuente cuantitativa**”. Datos pagos, interpretaciones, decisiones del owner y restricciones futuras aparecen separados.

### D5 — Faltantes detectados: 5/5

Identifica `u_min`, tolerancia de pérdida, fuente de settlements, FND, hora de publicación, licencia LBMA, costos de ejecución, margen e impuestos. Cita: “Fuente adecuada identificada (paga); PIT por insumo… **Owner decide datos**”.

Además ofrece una alternativa gratuita correctamente limitada: “V-spot… **no puede confirmar ni refutar V0**”.

### D6 — Claridad: 5/5

La identidad económica de la comparación se explica excepcionalmente bien: “La ventaja frente a mantener oro existe sólo si el oro… bajó en los meses en que la regla estaba vendida, lo suficiente como para pagar los costos”. El owner puede entender la tesis sin conocer futuros ni leer código.

### D7 — Utilidad para decidir: 5/5

Propone la comparación correcta sobre diferencias de retorno, no sólo Sharpe: `D = T-H` y `X = T-E`. Tiene costo base/estrés, desfase de ejecución, bootstrap en bloques, criterio económico `u_min` y estados excluyentes. Cita: “Descartada… la estimación puntual de D… ≤ 0, **o** la estimación puntual de X ≤ 0”.

Es una prueba que puede descartar la regla por falta de ventaja, insuficiencia económica, costos o restricciones, sin obligar al owner a inventar el método estadístico.

---

## Oro-Y

### D1 — Preservación de intención: 2/5

La exposición verbal es fiel, pero la prueba principal cambia GC por GLD: “Serie principal: **cierre ajustado de GLD**… Construir `x(m)` sintético”. Además sustituye la comparación directa de retorno contra mantener oro por una diferencia de Sharpe.

Eso permite que una estrategia con menor retorno absoluto que buy-and-hold pase si tiene Sharpe superior, lo cual no responde necesariamente a “le gana a mantener oro”.

### D2 — Errores materiales: 2/5

Los dos problemas principales afectan directamente qué estrategia se está probando y qué significa ganar.

#### Errores materiales

1. **Alta — prueba un proxy spot/ETF, no los retornos realizables de GC.**  
   GLD busca seguir el precio del bullion menos gastos; no contiene la curva de futuros, el contrato elegido ni el P&L real de los rolls. [La documentación oficial de GLD lo confirma](https://www.spdrgoldshares.com/usa/gld/). La propuesta reconoce que “no replica su carry exacto”, pero aun así lo usa como serie principal para decidir sobre GC.

2. **Alta — el criterio contra mantener oro puede aprobar menor retorno.**  
   D2 descarta sólo si “el **Sharpe** neto de E1 es ≤ al de B1”. Una estrategia puede tener mayor Sharpe y menor retorno neto que mantener oro. `CANDIDATE` también depende del intervalo de la diferencia de Sharpe, no de `E1-B1` en retorno. Esto cambia la pregunta económica del owner.

3. **Media — el control con `GC=F` no corrige el problema del roll.**  
   Se propone investigar sólo si el signo de `R12` difiere en más del 5 %. Coincidir en signo no valida la magnitud de retornos, carry, P&L durante el roll ni desempeño del lado vendido. Además, una continua sin método de ajuste conocido no permite “neutralizar” rigurosamente saltos de roll sin precios por contrato.

4. **Media — el placebo no iguala la exposición direccional.**  
   “Signos al azar y la misma cantidad de cambios” conserva turnover, pero no necesariamente el porcentaje comprado/vendido ni los episodios. En un activo con deriva positiva, eso puede confundir exposición larga con timing.

5. **Baja — interpretación excesiva del control C2.**  
   Una diferencia menor a 0,10 de Sharpe lleva a afirmar que “la ganancia viene de estar expuesto al oro”. Similaridad de Sharpe por sí sola no identifica causalmente esa fuente; habría que comparar exposición media, retorno y contribuciones.

### D3 — Trazabilidad de fuentes: 4/5

Tiene un registro bueno y una sección explícita de “Hecho / No verificado / Interpretación”. Cita: “**No verificado en esta sesión:** … las tarifas exactas de CME; los márgenes vigentes; el gasto anual de GLD”.

Pierde un punto porque la afirmación decisiva de que el proxy GLD “alcanza” se apoya en una aproximación de carry y fuentes secundarias, no en una validación con contratos individuales.

### D4 — Separación de hechos, hipótesis y decisiones: 5/5

La sección 11 es especialmente clara. Cita: “**Sin datos simulados:** ningún número de rendimiento de este documento es un resultado”. También distingue las recomendaciones al owner de lo ya comprobado.

### D5 — Faltantes detectados: 4/5

Detecta fees, márgenes, gasto de GLD, fuente anterior a 2004 y limitaciones de `GC=F`. Cita: “Es una serie **sin ajustar**: los saltos al cambiar de contrato no son retorno”.

No obtiene 5 porque trata esas limitaciones como chequeos pendientes, cuando en realidad la ausencia de retornos por contrato impide que el backtest principal refute de forma válida la estrategia GC.

### D6 — Claridad: 5/5

Es la más concisa y accesible. La regla, alternativas, costos y resultados posibles aparecen primero. Cita: “Si no le gana a ninguna de las dos alternativas de forma clara y robusta, la propuesta se descarta”.

### D7 — Utilidad para decidir: 2/5

Tiene predeclaración, escenarios de costos, placebo, sensibilidad y criterios explícitos. Cita: “Se corre **una vez**… Si se cumple cualquiera… la propuesta queda descartada”.

Pero puede descartar o aprobar por razones equivocadas: prueba GLD sintético en vez de GC y usa Sharpe en lugar del exceso de retorno frente a mantener oro. Los numerosos descartes adicionales —mitades, top cinco meses, tres lookbacks y placebo— aumentan la probabilidad de rechazo sin corregir esos problemas centrales.

# Preferencias y conjeturas

## SPY

**Preferencia: Y**, por margen moderado. Presenta mejor auditoría point-in-time, una separación temporal más honesta y una secuencia de veredictos muy útil. Antes de correrla sustituiría B-EQ por una referencia igualada por beta y riesgo de cola, y corregiría la definición F1/F2/F3. En X, la calibración 2013–2017 aplicada a 2005–2007 compromete justamente la etapa que debía aportar evidencia independiente.

**Conjetura:** SPY-Y fue producida **con** instrucción especializada; SPY-X, **sin** ella. Confianza **alta**. La pista es la estructura sistemática de Y: mandato, tesis, variantes, especificación operativa, recorrido de situaciones, matriz de cobertura, pendientes con responsables y ciclo de vida.

## Oro

**Preferencia: X**, claramente. Mantiene el objeto de investigación —contratos GC y sus rolls— y decide mediante `T-H` y `T-E`, con costos, intervalo y utilidad mínima. Y es más barata de ejecutar, pero esa economía se consigue cambiando la prueba por una aproximación con GLD que no puede resolver la pregunta sobre futuros.

**Conjetura:** Oro-X fue producida **con** instrucción especializada; Oro-Y, **sin** ella. Confianza **alta**. La pista es la misma topología formal de diseño observada en SPY-Y: mandato explícito, tesis y falsadores, reglas completas, datos point-in-time, situaciones operativas, cobertura y pendientes bloqueantes.