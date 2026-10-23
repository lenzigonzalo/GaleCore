---
name: research
version: 2.0.1
display_name: Investigación retomable
description: >
  Lleva una idea un paso honesto hacia algo decidible: la pregunta, los antecedentes que pesan, qué es hecho y qué es
  interpretación o hipótesis, una prueba que la apoyaría o la debilitaría y qué falta. Queda guardada y se retoma en
  otra sesión desde sus próximos pasos. No es una estrategia validada ni una decisión de operar: para diseñar una
  estrategia, strategy-design; para leer datos de hoy sin hipótesis, on-demand-analysis.
output_contract: galecore_ai.contracts.research.ResearchContent
---
## Cuándo se usa
«Investigá si el 0DTE vencido distorsiona el GEX post-cierre y cómo lo probaríamos», «Retomá la investigación sobre
X», una idea que necesita antecedentes, hipótesis y una prueba antes de decidir algo.

## Qué necesita
- nombre, intereses y memoria del trader ya vienen en el contexto: tenelos en cuenta sin volver a preguntar. Un dato que falta y que importa va a `missing`, nunca supuesto.
- `kb search --text "<términos>"` (y `--status unfinished` para lo abierto o con prueba planificada); `kb show <ref>`.

## Pasos
1. Buscar antes de escribir. Si una investigación ya cubre la pregunta, seguirla con `research revise` en vez de
   abrir otra.
2. Cada antecedente dice qué contiene **y** cómo cambia la hipótesis o el plan. Una lista de links no es antecedente.
3. Separar tipos: hecho (observable, con fuente: un ítem de la base o un archivo), interpretación (lee hechos),
   hipótesis (algo a probar), decisión (algo decidido). Nunca una hipótesis como hecho.
4. Plan de prueba: por paso, el dato que hace falta y qué observación apoyaría o debilitaría la hipótesis. Preferir
   pruebas con datos y capacidades existentes; decir cuándo hace falta dato o código nuevo.
5. Decir qué falta (datos, decisiones) y los próximos pasos con precisión suficiente para que otra sesión, sin esta
   conversación, siga.
6. Guardar. Nueva: `research save --slug <slug> --prompt "<pedido>" < {"content": {...}, "host_provider": "...",
   "host_model": "..."}`. Seguir, corregir o registrar un resultado (las revisiones anteriores quedan):
   `research revise --id <id> --reason continuation|correction|result --note "<qué cambia>" --prompt "<pedido>" < {...}`.

## Qué entrega
Un `ResearchContent` guardado y, al trader, lo esencial en tabla:

| Campo | Qué lleva |
|---|---|
| title, question | nombre corto y la pregunta |
| status | open · test_planned · concluded · abandoned |
| antecedents | `{ref, summary, bearing}`; ref = `regime:<SYM>/<fecha>`, `research:<id>` o `file:<ruta>` |
| statements | `{kind, text, sources}`; un hecho lleva al menos una fuente |
| hypothesis | obligatoria con plan de prueba |
| test_plan | `{step, data_needed, supports_if, weakens_if}` |
| missing, next_steps, limitations | lo que falta; los pasos (obligatorios si queda abierta); al menos una limitación |

Ejemplo de cierre: «Hipótesis: el 0DTE vencido infla el GEX post-cierre. Prueba: comparar el GEX con y sin el
vencimiento del día en 20 cierres. Falta: la serie histórica de GEX por vencimiento.»

## Errores a evitar
- Inventar hechos o concluir sin respaldo; sí se puede explicar un método o proponer un experimento diciendo qué falta.
- Creer que guardar valida: los chequeos estructurales pasan con razonamiento equivocado; declarar limitaciones.
- Presentar una estructura (p. ej. un spread de venta de puts) como estrategia: una estrategia necesita reglas
  completas (entrada, construcción, tamaño, seguimiento, ajustes, roll, salidas, invalidación).
- Abrir una investigación nueva cuando ya había una sobre lo mismo.

## Cómo responder
Primero `kb search` (una investigación abierta sobre lo mismo se sigue con `research revise`); al final, guardar con `research save|revise`.
Conclusión en una línea (qué se sabe y qué no), después una tabla con hechos, hipótesis y la prueba propuesta, y los
próximos pasos. Hecho, interpretación e hipótesis se dicen distinto. Nada de recomendación de operar.
