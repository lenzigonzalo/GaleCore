# Registros de régimen — se movieron

Desde el 2026-09-23 los registros diarios de régimen viven en la base de conocimiento del workspace,
`knowledge/regime/<SYMBOL>/<YYYY-MM-DD>.md`, fuera de este repo de código, para que su contenido no
dependa de la rama en que esté GaleCore (GC-AI-0005; ver `knowledge/README.md`).

Los archivos del 17 al 23 de septiembre se copiaron byte a byte con sha256 e integridad verificados
y siguen en la historia de git de esta rama (commit anterior a este README). Para volver atrás:
revertir el commit que los quitó y apuntar `GALECORE_RECORDS_DIR` a esta carpeta.
