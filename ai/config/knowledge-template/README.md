# Base de conocimiento de GaleCore

Resultados relevantes del trabajo con el harness de IA (`ai/`), con su procedencia, para recuperarlos y usarlos
en trabajos posteriores. Guardar algo acá no lo vuelve verdadero ni validado: cada archivo dice qué
es hecho, qué es interpretación o hipótesis, y qué pasó después.

| Carpeta | Qué hay | Lo escribe |
|---|---|---|
| `regime/<SYMBOL>/<YYYY-MM-DD>.md` | Registros diarios de régimen: datos, interpretación aceptada, outcomes y review del owner | `cli accept --record`, `record outcome`, `record review` |
| `research/<YYYY-MM-DD-slug>.md` | Investigaciones: pregunta, antecedentes, hipótesis, plan de prueba, pendientes, revisiones | `cli research save`, `research revise` |
| `evidence/<YYYY-MM-DD-slug>.json` | Respuestas de fuentes con su procedencia (create-only, hash) | `cli evidence add` |
| `strategies/<name>/<version>.proposal.json` · `.approval.json` | Propuesta de estrategia con su spec exacta, hash de GaleCore y chequeo contra el runtime; aprobación del owner de esa versión (create-only, hash) | `cli strategy save`, `strategy approve` |

En cada archivo el **frontmatter YAML es el registro autoritativo**; el cuerpo Markdown es un resumen
derivado que se regenera y se compara al leer. Una edición a mano que rompe un hash o deja el cuerpo
desalineado se detecta como `INTEGRITY_FAILED`; quitar revisiones o reescribir una recalculando su
hash no: para eso está la historia de git de esta carpeta, por eso se commitea después de cada sesión.

## Cómo se usa

Desde `ai/` (ver `ai/CLAUDE.md`): `cli catalog` dice qué capacidades hay;
`cli kb search --text "..."` busca; `cli kb show <ref>` muestra un item con sus pendientes y quién lo
cita. Referencias: `regime:SPY/2026-09-23`, `research:<id>`, `evidence:<id>`, `strategy:<name>/<version>`,
`file:<ruta relativa a la carpeta que contiene esta>`.
Los links del cuerpo son relativos: se leen igual en Obsidian, en GitHub o en un editor.

## Cómo se conserva y se recupera

- **Ubicación:** esta carpeta está fuera del código del producto (por defecto `~/GaleCore-datos/knowledge`, o la que
  indique `GALECORE_KNOWLEDGE_DIR`). El Lab la crea desde la plantilla `ai/config/knowledge-template` si no existe;
  los comandos de `ai/` nunca la crean vacía.
- **Historia:** es un repo git propio, sólo de datos, en la rama `main` (no se usan ramas acá). El Lab commitea al
  terminar cada turno. Recuperar una versión: `git log -- <archivo>` y `git show <sha>:<archivo>`.
- **Respaldo:** si la carpeta tiene un remoto `origin` (un repo privado de quien usa esta PC), el Lab la sube al
  terminar cada turno. Sin remoto, queda local.
