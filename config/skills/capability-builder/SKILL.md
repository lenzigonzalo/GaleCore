---
name: capability-builder
skill_id: capability_builder
version: 1.0.0
display_name: Crear y corregir skills
description: >
  Convierte un pedido del trader («quiero una skill que me diga qué merece mi atención hoy», «cada mañana decime cómo
  está el gamma») en una skill con el formato de la casa, o en un agente programado sobre una skill que ya existe.
  También corrige una skill desde el comentario del trader sobre un resultado (caso, preferencia o método) y retira lo
  que ya no vale. Escribe configuración, no código.
output_contract: galecore_ai.harness.catalog.CatalogEntry
---
Construís con el molde, no a mano ni improvisando. El trader pidió armar algo: guiás, no sugerís por tu cuenta.

## Cuándo se usa
- **Crear:** «Quiero una skill que…», «Armame un agente que todos los días…», «Quiero que cada mañana me digas…».
- **Corregir:** «Le faltó el calendario de la Fed», «Esto no me sirvió porque usaste datos viejos», «¿Qué feedback
  quedó pendiente?».
- **Retirar:** «Esto ya no vale: reemplazalo por la investigación nueva», «Retirá esa regla».

## Qué necesita
- `catalog` (qué existe; reutilizar antes de crear) y `catalog --check` (completa / problemas por entrada).
- `sources query --need "<dato>"`, uno por dato (lo que ninguna fuente cubre: declarar por qué).
- `profile show` (qué campos del perfil aplica la skill).
- Para corregir: `kb search`, `kb show research:<id>`, `feedback add`, `feedback list [--status pending|applied]`.
- Para retirar: `kb mark <ref> --as corrected|superseded|retired --reason "<motivo>" [--by <ref>] --slug <slug>
  --prompt "<palabras del owner>"`.

## Pasos

### Crear (un paso por turno, corto, en palabras del trader; nada se crea antes del paso 5)
1. **Para qué:** qué decisión ayuda y qué tiene que traer el resultado para poder actuar; dos o tres pedidos de
   ejemplo. Una pregunta sólo si la respuesta cambia lo que se arma.
2. **Qué objeto es**, en una línea (nunca armar en el harness lo que debería servir GaleCore):
   - un dato o un cálculo (un registro diario de GEX) → GaleCore: `gap add --kind data|calc` y decir que se le pide a
     GaleCore;
   - vigilar un nivel («avisame si cruza el gamma cero») → el supervisor (`supervise watch`, por código, sin costo);
   - una forma de pensar o responder («así analizá un spread») → una skill (este molde);
   - un trabajo de juicio programado («decime cada mañana…») → un agente sobre una skill (cuesta tokens por corrida);
   - una vista siempre en pantalla → front de GaleCore (no se arma acá; queda pendiente).
   Un pedido puede ser dos cosas (el reporte es un agente, el cruce del nivel es una vigilancia): ofrecer ambas.
3. **Qué usa:** `catalog` (si una entrada ya sirve, usarla o extenderla, sin casi-duplicados; nombrar lo que
   reutiliza); `sources query` por dato; lo que GaleCore no sirve, faltante con su `gap`. Perfil: qué campos aplica;
   si guarda research, la skill dice que se cite `profile:v<N>` (si no, el guardado se rechaza).
4. **Ficha**, una tabla de hasta 6 filas y «¿la armo? sí / no»: Qué hace · Qué objeto es · Qué datos usa (y cuáles
   faltan) · Qué produce y dónde se guarda · Cuándo corre y cuánto cuesta (tokens por corrida; la PC prendida) · Cómo
   se controla desde el chat (ver, pausar, cambiar, borrar).
5. **Con el «sí»:**
   - **Agente sobre una skill genérica** (sin escribir config): `scheduled_report` (un reporte) o `market_watch`
     (condiciones sobre símbolos), con `task create --capability <id> --objective "<método en palabras del trader>"`.
     No programar todavía: primero el paso 6.
   - **Skill nueva** (sólo si ninguna genérica sirve y la sesión puede escribir config; una conversación del Lab no
     puede: decir que queda pendiente y `gap add --kind action`, nunca prometerla creada): escribir
     `config/skills/<id con guiones>/SKILL.md` con el formato de abajo (versión 0.1.0, mismo `output_contract`), su
     `history.yaml` al lado (`skill_id`, `versions: [{version, date, changes, feedback: []}]`) y la entrada en
     `config/catalog.yaml` (id, kind, serves, example_requests, skill, output_contract, galecore_capabilities,
     data_needs [{need, missing?}], flow [comandos en orden], stored_as, controls con al menos un «Not checked - …»).
     Un contrato, almacenamiento o comando nuevo es código: frenar, decir exactamente qué falta y no escribir una línea
     de flow para un comando que no existe. Los slugs van en minúsculas con guiones. `catalog --check` hasta completa.
6. **Prueba con datos reales:** correr el método una vez ahora, con los datos de GaleCore como lo haría la corrida
   programada, y mostrarlo con su fecha. ¿Es lo que quería? Lo que cambie va al objetivo (o a una versión nueva de la
   skill), nunca a una segunda capacidad.
7. **Programar:** sólo con un segundo «sí» a ese resultado real, `task create` (hora propuesta según el calendario del
   mercado, zona Nueva York) y `task status`. La primera corrida programada es al día siguiente y se revisa entonces
   (`task status`, `task history`).
8. **Control después:** «pausalo», «cambialo a las 8», «borralo» → `task pause|resume|set-frequency|cancel` con sus
   palabras; «cambiá cómo lo hace» es una versión nueva de la skill. Borrar conserva la historia.

### Formato de una skill (WS-0054, aprobado por el owner 21/10)
```markdown
---
name: <id con guiones>
version: 0.1.0
display_name: <nombre corto>
description: >  qué pedido atiende y cuándo NO usarla (qué skill va en su lugar)
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa       pedidos típicos en palabras del trader
## Qué necesita        comandos de GaleCore y del perfil; qué hacer si falta un dato
## Pasos               numerados, imperativos, con el comando de cada paso
## Qué entrega         forma + un ejemplo corto
## Errores a evitar    de casos reales
## Cómo responder      ≤ 8 líneas; empieza por el comando que trae los datos (es lo que el Lab pega en el turno)
```
Sólo lectura y sin órdenes: ninguna skill opera, cambia asignaciones ni presenta una recomendación como decisión del
trader.

### Corregir desde un comentario
9. El comentario es sobre un resultado guardado: encontrarlo y la revisión que vio el trader. Sus palabras textuales;
   si se reformulan, el trader acepta la reformulación antes de registrarla y quedan las dos.
10. Clasificar por lo que cambia y decirlo en una línea antes de registrar: **caso** (el dato o la lectura de ese
    resultado estaba mal → sólo cambia ese resultado), **preferencia** (cómo quiere las cosas → cambia el perfil),
    **método** (lo que la skill debería hacer siempre → versión nueva). Con duda: «¿sólo este resultado o siempre?».
11. Registrar: `feedback add --research research:<id> --revision <N> --classification case|preference|method --slug
    <slug> --prompt "<palabras>" < {"words", "formulation"?, "host_provider", "host_model"}`. La skill y la versión
    salen de esa revisión.
12. Aplicar donde corresponde, citando `feedback:<id>`: caso → `research revise --id <id> --reason correction` con el
    feedback como antecedente; preferencia → `profile set --feedback feedback:<id>`; método → editar el SKILL.md,
    subir la versión (menor para un comportamiento nuevo, parche para un arreglo), entrada en `history.yaml` con
    `feedback: [feedback:<id>]` y `catalog --check`. Un caso no es una regla: un cambio de método necesita comentarios
    sobre al menos dos resultados distintos (`same_skill_pending` en `feedback list`) o la decisión explícita del owner
    (sus palabras en `owner_decision`; nunca escribirla si no la dijo). Decir qué NO cambia.
13. `feedback list` muestra aplicados y pendientes, y dónde se aplicó cada uno. La prueba de un cambio de método es la
    próxima corrida: la versión nueva muestra el cambio sin que el trader lo repita.

### Retirar lo que ya no vale
14. Encontrar el ítem y decir en una línea qué le pasa: corregido (estaba mal; nombrar la corrección), reemplazado
    (algo más nuevo lo reemplaza; nombrarlo) o retirado (ya no se usa). Después `kb mark`. Nada se borra: queda legible
    con su marca, `kb search` lo deja afuera (`--include-marked` lo muestra) y un resultado nuevo no lo puede citar. Una
    regla equivocada de una skill se reemplaza con una versión nueva, no con una marca. Marcar sólo con palabras del
    owner (la curaduría sólo propone). Un perfil no se marca: lo reemplaza uno nuevo (`profile set`).

## Qué entrega
- Crear: la ficha (tabla de 6 filas) y, con los dos «sí», el agente programado o la skill nueva con `catalog --check`
  completo; lo que reutiliza y lo que quedó faltante.
- Corregir: la clasificación en una línea, el feedback registrado y dónde se aplicó.
- Retirar: qué le pasa al ítem y su marca.

## Errores a evitar
- Crear algo antes del paso 5, o programar antes de probar con datos reales.
- Un casi-duplicado de una entrada que ya existía.
- Prometer una skill creada desde el Lab (no puede escribir config).
- Una línea de flow para un comando que no existe, o una fuente inventada.
- Convertir un solo comentario en cambio de método.

## Cómo responder
Primero `catalog` (¿ya existe algo que sirva?). Un paso por turno, corto, en palabras del trader, sin ids ni nombres de
archivo. Antes de armar: la ficha de 6 filas y «¿la armo? sí / no»; antes de programar, una corrida real con su
fecha y un segundo «sí». Un comentario sobre un resultado: decir si es caso, preferencia o método antes de registrarlo.
