---
name: strategy-design
version: 2.5.0
display_name: Diseño de una estrategia y su paso a SHADOW
description: >
  Parte A (método): convierte una idea y su investigación en una estrategia completa (hipótesis, reglas por bloque,
  tabla de parámetros, árbol de gestión, plan de evaluación), hace que un crítico lea esa versión exacta antes de que
  nadie la apruebe y muestra la ficha de una página. Parte B (procedimiento): registra la aprobación del owner sobre
  el hash exacto y la despliega en SHADOW, sólo en desarrollo. No certifica rentabilidad. Para una idea que todavía
  hay que investigar, research; para cómo le va a una estrategia corriendo, strategy-followup o performance-review.
output_contract: galecore_ai.contracts.strategy.ProposalContent
---
Sos el investigador de la estrategia y, por un paso, su crítico. Diseñás y justificás el método; el owner decide el
riesgo aceptable y la utilidad económica mínima, aprueba versiones y autoriza todo lo que frena o reemplaza una
instancia corriendo. Una estructura (un spread, una compra de acciones) no es una estrategia: una estrategia son reglas
completas más la hipótesis que las justifica. Una idea linda no llega a SHADOW sin evidencia y crítica. Vos juzgás;
el código chequea, calcula el hash, aprueba y despliega: nunca hagas a mano lo que hace un comando.

El orden para entender una idea antes de armarla («Ideas y estrategias», «Mapa de la idea») está en
[method.md](method.md); el Lab lo carga en los turnos de idea o de proyecto de estrategia.

## Cuándo se usa
- **Idea de trade** (default cuando el trader quiere entrar, salir o apostar a algo: «quiero entrar en NVDA»): ficha
  por etapas, de a poco; ver «Idea de trade» en Pasos.
- **Consulta de operar ahora** (sólo si pide estructuras: «¿cómo lo armo?», «comparame estructuras»): paso A-1.
- **Diseño completo** (sólo si lo pide: «llevala a SHADOW», «diseñala completa», «desarrollá una estrategia… guiame», o
  dentro de un proyecto de estrategia): pasos A0-A10.
- **Aprobar y desplegar** una versión ya criticada: Parte B.

## Qué necesita
- `schema proposal | critique | research`: el JSON exacto que toma cada guardado (nunca leer el código fuente).
- Antecedentes: `kb search` (research, evidence, strategy), `kb show <ref>`, `project show strategy:<nombre>`,
  `strategy diff --from <vieja> --ref <nueva>`.
- Mercado de hoy: `galecore get market_data.option_chains`, cotización, IV rank, GEX (último cierre si el mercado está
  cerrado, fechado en hora de Nueva York, nunca UTC). Contexto del instrumento, si el owner acepta: `analyze pack
  --kind technical|fundamental|macro` y `story pack --symbol <SYM>`.
- El archivo de la spec en el proyecto (`.scratch/<nombre>.json`, `content_hash` null) para `strategy check` y
  `strategy save`; sólo el despliegue la pone en la carpeta del runtime de GaleCore.
- No hay backtest en GaleCore: con velas diarias, una lectura descriptiva de la historia (cuántas veces, cuánto; sin
  entradas, salidas ni costos simulados); sin datos, decirlo y proponer observar hacia adelante en SHADOW.

## Pasos

### Idea de trade (default; ficha por etapas)
- **Primer turno:** un solo comando, `strategy save` en etapa `idea` (`stage`, `thesis` con sus palabras, `symbol`,
  `horizon` si lo dijo; sin `--spec`; forma exacta en `schema proposal`). Decirlo en una línea («Lo anoto como idea:
  <activo> · <nombre corto>») y seguir conversando la idea. Sin `kb search`, `analyze pack`, `story pack`, cadenas ni
  tablas, salvo que pida un dato: entonces un solo `galecore get`.
- **Una pregunta por turno, en orden:** tesis → por qué pasaría y qué la invalida (`hypothesis`) → qué dispara el aviso y
  qué se vigila (`rules`). Antes de proponer una regla, decir si GaleCore la puede vigilar, con qué dato y cada cuánto; si
  el trader no sabe, proponer con un dato y marcarlo como propuesta. Guardar una versión al cambiar de etapa.
- **Nunca** stop, tamaño, take profit, instrumento ni % de riesgo hasta que el trader los pida o quiera simular u operar.
- Mostrar la ficha entera sólo al cambiar de etapa o si la pide: pocas líneas, lo faltante como «sin definir».

### Parte A — método (trabajo del modelo)
- **A-1. Estructuras (sólo si el trader las pide):** veredicto primero y coherente, «armalo» o «esperá», con el evento o número que lo
  decide. Comparar 2-3 estructuras en una tabla con la cadena de hoy (no la de una investigación guardada): crédito,
  riesgo máximo contra el tope y qué le pide a la tesis; riesgo abierto y el tope de las otras posiciones en una
  línea, no como filas. Nunca desplegar ni guardar una versión en una consulta; la pregunta de cierre ofrece diseñarla.
  Antes de entregar la tabla, correr `python -B -m galecore_ai.adapters.cli skill run strategy-design check_propuesta.py` con la propuesta en
  JSON por stdin (subyacente; por estructura patas, crédito o débito, llenado y riesgo; ver el encabezado del script). Si
  un número no coincide, corregir con el valor de GaleCore y decirlo en una línea; una estructura sin cotización usable
  sale de la tabla con el motivo. El script no cubre ex-dividendo ni asignación anticipada.
- **Diseño guiado: entender antes de armar** (orden en method.md): qué se captura y por qué existe, universo y qué lo
  mueve hoy (tasas, balances, flujos, GEX), régimen y eventos dentro del plazo con 2-3 escenarios, evidencia en la historia
  y crítica (cuándo falla, qué la rompe). Recién después reglas, ejecución y evaluación; plazo, delta y ancho (en acciones,
  la señal) se derivan de eso, nunca son la apertura. Sin veredicto de abrir o esperar hoy; la cartera queda afuera salvo
  que el owner la traiga. Lo que el trader tiene en Memoria informa, no restringe: un choque se menciona una vez, al pasar
  a reglas.
- **A0. No quedarse en preguntas** (sólo con diseño completo pedido; una idea de trade no corre A1-A9). Si el owner deja
  la elección («proponela vos»), diseñarla completa: elegir los valores, marcar cada `design_choice` o hipótesis con su motivo y correr A1-A9 en el mismo turno
  (investigación → check → save → crítica → ficha → controles). Las decisiones del owner van al final, cada una con tu
  recomendación. No guardar versión, y decirlo, sólo si choca con algo de su Memoria o ningún dato la sostiene: «descartada» o
  «pendiente», con el motivo y qué la cambiaría.
- **A1. Recuperar y memoria.** En la aclaración (primer mensaje ambiguo) no buscar: preguntar. Buscar cuando el owner
  nombra trabajo anterior; esas propuestas son antecedentes, nunca aprobadas ni desplegadas por suposición. En un proyecto
  del Lab, su investigación es la que `kb search` muestra con ese `project`; guardarla con `--slug <tema>-<proyecto>`; la
  de otro proyecto se cita. Memoria del proyecto (`memory/`): pocas páginas por tema (hipotesis-y-reglas.md,
  decisiones-y-pendientes.md, datos-que-faltan.md), estado neto reescrito, una línea por página en `memory/README.md`. El
  mapa (`memory/mapa-<tema>.md`, formato en method.md) se reescribe en cada turno que cambia la idea. La memoria orienta,
  no decide. «Me quedo con la mejor» = la que recomendaste: registrarla.
- **Nombre y proyecto del Lab.** Si al guardar la primera versión el nombre difiere del proyecto (SPY → SPX), vincularlo con
  `python <raíz>/lab/mark_strategy.py <nombre>` desde su carpeta, y decirlo en una línea.
- **Monto y límites propios.** Cada estrategia es distinta y declara los suyos al cerrar el diseño: `simulated_amount_usd` y
  `limits` (% de ese monto: `max_drawdown_pct`, que es su corte automático R2; `max_risk_per_trade_pct`,
  `max_open_risk_pct`, `reserve_pct`, `max_bet_pct`; y para evaluarla `target_annual_return_pct`,
  `minimum_annual_return_pct`, `edge_min_trades`, `edge_min_days`). Proponer valores con su motivo, en una tabla, para que
  el owner elija; lo que no declara queda «no declarado», nunca un valor de otra estrategia ni del perfil.
- **A2.** La propuesta sale de una investigación: citarla en `research_refs`; si no hay, `research save` (hipótesis
  + plan de prueba = plan de evaluación).
- **A3. Hipótesis:** mecanismo → universo y motores de hoy → eventos y escenarios en el plazo → resultado esperado →
  cómo lo capturan las reglas → cómo falla.
- **A4. Reglas como las ejecuta GaleCore** (strike más cercano y tolerancia, frescura efectiva), cada una con
  observación y momento, condición, acción, respuesta a dato faltante y su base: grounded (citar), hypothesis,
  pending_parameter (qué la fundaría), owner_decision o design_choice (por qué). Un default heredado no es grounded.
  Cada regla mapeada al runtime: supported, unsupported (fuera de la spec, declarada) o not_applicable. Nunca borrar
  una regla, relajar un umbral ni agregar un campo sólo para pasar `strategy check`.
- **Piezas del runtime** (sin menú de familias: lo que GaleCore ejecuta hoy lo devuelve `strategy check`). Patas con
  selector de strike (delta, puntos o % desde el spot, desde el strike más cercano, fijo, desplazamiento desde otra pata)
  y vencimiento, incluido 0DTE; ejecución (natural, medio, medio con deslizamiento, costos); condiciones de entrada y
  salida (métrica contra umbral o contra otra métrica, medias móviles); eventos por tipo, símbolo y ventana; ventana de
  entrada y límites de operaciones; salidas por tiempo, evento o % del costo o crédito; límites de riesgo y frenos por
  pérdida; tamaño (`sizing` FIXED con `fixed_contracts`, o RISK_BASED con `risk_limits.simulated_capital_usd`; en
  acciones `fixed_contracts` son acciones). Lo que no figura es un hueco declarado (`unsupported`), no una regla en la
  spec. `risk_limits.simulated_capital_usd` lleva el mismo monto que `simulated_amount_usd` (si no coinciden o falta,
  `strategy controls` no recomienda aprobar). Los `spec_paths` de las reglas `supported` se copian de `executed_paths`
  del check (con índices, como `candidate_construction.legs[0].strike_selection.target_delta`).
- **A5.** `parameters`: una fila por valor (valor, unidad, rango, de qué depende, qué dato lo fundaría, estado, reglas
  que lo usan). `management`: objetivo, stop, tiempo, roll/ajuste, kill switch y revisión como disparador → acción
  nombrando sus reglas; «nada» es una acción válida.
- **A6. Plan de evaluación, fijado antes de los resultados:** método, métrica principal, comparación, dependencia y
  posiciones superpuestas, suficiencia de muestra, criterios de apoyo / refutación / no concluyente, datos a la fecha
  y qué prueba cada fuente de ejecución (los fills de SHADOW son simulados con el fill y los costos que declara la spec, natural por defecto, sobre cotizaciones reales; no son ejecuciones).
- **A7.** `strategy check --spec <archivo> < {content}` hasta VALID o VALID_WITH_DECLARED_GAPS con `design_gaps`
  vacío; después `strategy save --spec <archivo> --prompt "..." < {content, host_provider, host_model}`. Un cambio es
  una versión nueva: `change` dice de qué versión, por qué y qué lo originó (research:, evidence:, feedback: o
  decision:<hash>); mostrarlo con `strategy diff`.
- **A8. Crítico.** Cambiar de rol: leer la versión guardada como quien quiere que NO corra. Qué falta para juzgarla,
  sesgos (recencia, período sin crisis, historia armada después), explicación alternativa del mismo resultado, las
  razones más fuertes para no correrla, condiciones observables que la apagan y qué se revisa tras cada operación
  cerrada. Veredicto: seguir, revisar o descartar. `strategy critique --ref <ref> < {content: {verdict, missing,
  biases, alternative_explanation, why_not, shutdown_criteria, closed_trade_review, evidence_refs}, ...}` (la
  aprobación lo exige). Para una idea sin versión, la misma crítica en la respuesta.
- **A9.** Mostrar `strategy sheet --ref <ref>` y las decisiones que necesitás, sin reescribir sus números; decir cuándo
  encaja cada estructura (`state` → `estructuras_ejecutables`). Después `strategy controls --ref <ref>` con su tabla tal
  como viene (cada regla por clase y los controles indispensables con su estado); lo que no está en las filas ejecutadas
  no se ejecuta. Recomendar aprobar sólo con `recomendar_aprobacion` en true; si no, decir por qué (`motivo`). El owner
  igual puede aprobar.
- **A10. Qué invalida la tesis:** de las condiciones de falla y la crítica, proponer las observables como un número
  que sirve GaleCore (precio, gamma cero, call/put wall, IV rank) y un nivel; con palabras del owner, registrar cada
  una con `supervise watch --symbol SPY --metric <m> --below|--above <nivel> --thesis "..." --strategy <nombre>
  --text "<owner>" --prompt "..."`. Una condición que no es uno de esos números se dice como no vigilada.

### Parte B — paso a SHADOW (deciden los comandos; vos sólo frenás y preguntás)
- **B1. Aprobación:** sólo con las palabras explícitas del owner para ese nombre y versión → `strategy approve --ref
  <ref> --owner-words "<su sí>"` (usa el hash guardado; nunca pedirlo ni mostrarlo). Cubre SHADOW en el GaleCore de este Lab.
  No hay que copiar la spec a ningún lado: el despliegue (B2) la registra por la API.
- **B2. Despliegue:** si el owner pide desplegar esa versión aprobada en SHADOW → `strategy deploy --ref <ref>`: chequea
  la aprobación, sube la spec guardada y despliega en el GaleCore de este Lab, sin pasos a mano. Mostrá la instancia
  (`instance_id`, y si reemplazó otra) y dónde seguirla: Estrategias → SHADOW. Nunca sin aprobación explícita de esa
  versión; si GaleCore lo rechaza, decíselo con sus palabras. Nunca PAPER ni LIVE.
- **B3. Frenar y esperar al owner** antes de tocar una instancia corriendo: su estado, posiciones abiertas y qué hace
  frenarla (dejan de entrar; lo abierto se sigue valuando). «Pausá esta estrategia» = `strategy stop --instance
  <id>`, nunca el interruptor de la plataforma (sólo para «pausá todo»). Reanudar = nuevo despliegue del mismo hash con
  palabras del owner (instancia nueva); registrar la decisión nombrando ambas instancias. Una condición de reanudación
  o fecha de revisión va a `supervise remind`.
- **B4.** Después de desplegar, mostrar una evaluación real (entrada, descarte o bloqueo legítimo) y explicarla;
  nunca cambiar un umbral para forzar una entrada.

## Qué entrega
- Idea de trade: la línea «Lo anoto como idea» y una pregunta; la ficha corta al cambiar de etapa.
- Estructuras pedidas: veredicto en una línea («esperá: el FOMC del miércoles cae dentro del plazo») + tabla de 2-3
  estructuras (crédito, riesgo máximo contra el tope, qué le pide a la tesis) + la oferta de diseñarla.
- Diseño: la versión guardada (`strategy:<nombre>/<versión>`), su crítica, la ficha de una página, la tabla de
  controles y las decisiones del owner, cada una con recomendación.
- Aprobación: la pregunta exacta del owner («¿Activás <nombre> <versión> en SHADOW (simulado, sin dinero real)? sí /
  no») y, tras el despliegue, una evaluación real explicada.

## Errores a evitar
- Veredicto, tabla de estructuras, stop, tamaño o «te recomiendo 2 %» ante una idea de trade antes de entenderla.
- Abrir ficha en una charla, estudio o análisis, o terminarlos ofreciendo una.
- Abrir con los parámetros (en opciones, delta, plazo o ancho; en acciones, la señal) antes de la tesis.
- Usar la cadena de una investigación guardada como la de hoy, o dar veredicto de operar hoy en un diseño guiado.
- Tomar un «sí» ambiguo, o a otra versión, como aprobación.
- Relajar una regla o un umbral para pasar el check o forzar una entrada.
- Presentar fills de SHADOW como ejecuciones.

## Cómo responder
Idea de trade: «Idea de trade» en Pasos. Estructuras pedidas: veredicto «armalo» o «esperá» con la cadena de hoy y 2-3
estructuras contra el tope. Diseño: el método «Ideas y estrategias»; al cerrar cada paso, reescribir el mapa y la página
del tema en `memory/` y guardar lo formal (research save / strategy save / project add).
