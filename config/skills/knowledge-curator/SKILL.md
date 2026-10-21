---
name: knowledge-curator
version: 1.0.0
display_name: Curaduría de la memoria
description: >
  Mantiene la memoria al día sin que se lo pidan: lee qué cambió en la base de conocimiento desde su última corrida
  (resultados, feedback, decisiones y bitácora de los proyectos, versiones de estrategias y del perfil) y guarda, como
  revisión de una investigación de curaduría, lo que importa con su fuente: qué se aprendió, qué se decidió y por qué,
  qué contradice o reemplaza algo anterior y qué comentarios sobre un método ya se repiten. Sólo propone: marcar algo
  como corregido, reemplazado o retirado, o convertir comentarios repetidos en regla, lo decide el owner.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
La corre el agente programado de curaduría; a mano: «¿Qué quedó viejo en la memoria?», «¿Qué aprendimos esta semana?».

## Qué necesita
- `profile show` (citar la versión) y `kb search --kind research --text "curaduria"`; la revisión anterior (`kb show
  research:<id>`) dice desde cuándo leer y qué ya se propuso. Primera corrida: los últimos 14 días.
- Lo que cambió: el runner ya filtró la memoria por código y da, en el pedido, los dominios a curar y los refs nuevos
  de cada uno. Leer sólo esos con `kb show <ref>`; no buscar más ni curar otros dominios. Completan: `feedback list
  --status pending`, `project show portfolio` y `project show strategy:<nombre>` (para una estrategia con novedades).
  Sin filtro (pedido a mano): `kb search --since <AAAA-MM-DD>`.
- Sin datos de mercado: se cura lo guardado, no se analiza el mercado.

## Pasos
1. Leer lo que cambió (arriba).
2. Lo que importa, una afirmación por cosa, siempre citando el ítem de donde sale: una conclusión, una decisión y su
   motivo, una corrección, una lección de un cierre, un pendiente que envejeció. Un hecho repite lo que dice el ítem;
   tu lectura es interpretación. Las corridas sin nada nuevo quedan afuera.
3. Proponer, nunca aplicar. Cada propuesta es un próximo paso para el owner con el comando exacto:
   - un ítem que uno más nuevo contradice o reemplaza: «Proponer: kb mark <ref> --as superseded --by <ref> —
     <motivo>»; uno que ya nadie usa: «--as retired»; uno que una corrección posterior arregló: «--as corrected».
     Decir por qué con ambos refs; si hay duda, decirla en vez de proponer.
   - comentarios sobre la misma skill en resultados distintos (`same_skill_pending` en feedback list): «Se repite:
     feedback:<a> y feedback:<b> sobre <skill> — candidato a regla (decide el owner)». Un solo comentario es un caso,
     nunca una regla.
   - el feedback pendiente viejo que lista el filtro: nombrarlo y su antigüedad.
4. Corto: hasta 10 afirmaciones y 5 propuestas, lo más importante primero. Estado open si hay propuestas para el owner,
   concluded si no. Limitaciones: qué no se leyó y por qué.
5. Guardar: `research save --capability knowledge_curator --slug curaduria` la primera vez, después `research revise
   --capability knowledge_curator --id <id> --reason continuation`. Si el owner marcó algo citado antes, el guardado lo
   rechaza y nombra el reemplazo: citar el reemplazo (o sacar la afirmación). Una decisión o entrada de bitácora del
   owner se cita como `project:<nombre de estrategia>` o `project:portfolio`.

## Qué entrega
Ejemplo de forma:

| Qué | Fuente | Propuesta |
|---|---|---|
| La investigación del skew quedó reemplazada por la del 18/10 | research:<a>, research:<b> | kb mark research:<a> --as superseded --by research:<b> |
| Dos comentarios piden fechas con día de la semana | feedback:<a>, feedback:<b> | candidato a regla (decide el owner) |

## Errores a evitar
- Aplicar una marca o una regla en vez de proponerla.
- Convertir un solo comentario en regla.
- Curar dominios o refs que el filtro no dio, o leer datos de mercado.
- Citar un ítem que el owner ya marcó.

## Cómo responder
Primero la revisión anterior (`kb search --kind research --text "curaduria"`) y lo que cambió desde ahí.
Tabla corta (qué · fuente · propuesta con el comando exacto), lo más importante primero, hasta 5 propuestas. Todo es
propuesta: decide el owner.
