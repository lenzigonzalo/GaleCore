# GC-0031 — Review independiente de conexiones MCP locales

Fecha: 13/10/2026. Reviewer independiente: Codex. Una sola pasada; no es aprobación ni cierre del work item.

## Alcance y snapshot

Revisé el diff comprometido `aae9cebe44bae20d852092db1aadfd21c979dada..364b1c967f80f07721bcce145cb67a81a05f8597` en el worktree `C:/Users/lenzi/GaleCore-Local-MCP-GC-0031`. El alcance fue inventario y habilitación/deshabilitación de MCP locales para Claude Code y Codex, preservación de configuración y secretos, controles HTTP en localhost, escrituras y concurrencia, y semántica del frontend.

El árbol no estaba limpio: `dev/local_mcp_smoke.py` tenía un cambio posterior de formato/imports y `docs/engineering/evidence/GC-0031/` era un directorio no versionado. Ambos quedaron fuera del snapshot revisado. No leí ni modifiqué configuraciones reales de `~/.claude.json` o `~/.codex/config.toml`; todas las comprobaciones de escritura usaron hogares temporales.

**Resultado: CHANGES_REQUESTED por F1–F3.** No corresponde marcar `VALIDATED` ni `CLOSED`.

## F1 — P1: el respaldo copia secretos dentro del checkout sincronizado por OneDrive

Ubicación: `dev/local_mcp.py:190-197,294-296`.

Antes de cada reemplazo, el servicio copia todos los bytes del archivo destino a `dev/.local/mcp-backups`. Para Codex y Claude esa copia incluye el documento completo y, por lo tanto, puede contener comandos, argumentos, URLs, headers, variables de entorno y credenciales. `.gitignore` confirma que `dev/.local/` no entra a Git, pero el checkout canónico de GaleCore está bajo `C:/Users/lenzi/OneDrive/...`: al ejecutar la versión integrada, los respaldos en texto plano quedan dentro de una carpeta sincronizada por OneDrive. Además, `Path.write_bytes` crea el archivo con los permisos heredados del checkout, sin conservar ni endurecer explícitamente la protección del archivo original.

Esto contradice el límite de no exponer credenciales: ignorar un archivo en Git no evita su copia a otro sistema ni constituye una frontera de secretos. Mover los respaldos a un directorio local por usuario fuera de carpetas sincronizadas (por ejemplo, datos locales de la aplicación) y crearlos con permisos/ACL restrictivos. Agregar una prueba que compruebe que la ruta de respaldo no cae dentro del workspace y que el contenido nunca se publica en inventario, logs o evidencia.

## F2 — P1: un MCP compartido de Claude puede mostrarse «habilitado» sin estar aprobado

Ubicación: `dev/local_mcp.py:74-88,174-187` y `source/galecore-monitor/src/components/settings/LocalMcp.tsx:29-30,54`.

Para servidores de `.mcp.json`, el inventario define `enabled` únicamente por ausencia en `disabledMcpjsonServers`. Al habilitar, el writer sólo elimina el nombre de esa lista. No interpreta ni actualiza `enabledMcpjsonServers` y tampoco considera `enableAllProjectMcpServers`, que representan la aprobación de servidores compartidos de proyecto en Claude Code.

Lo reproduje con un hogar temporal: `.mcp.json` contenía `shared`, mientras `settings.local.json` contenía `enabledMcpjsonServers: []` y `disabledMcpjsonServers: ["shared"]`. Después de `toggle(..., True, ...)`, el backend devolvió `enabled=true`, la lista de denegados quedó vacía y la lista de aprobados siguió vacía. La UI confirmó entonces «habilitado» y pidió abrir una sesión nueva, aunque el cambio no concedió la aprobación necesaria.

Modelar los tres estados relevantes de Claude para `.mcp.json`: denegado, aprobado explícitamente y aprobación global. Al habilitar, quitar la denegación y agregar la aprobación cuando no rija la aprobación global; al deshabilitar, quitar la aprobación y agregar la denegación. Si una política de mayor precedencia impide determinar o cambiar el estado efectivo, mostrarlo como no comprobado/no editable en vez de afirmar que quedó habilitado. Cubrir las combinaciones de allowlist, denylist y aprobación global con fixtures.

## F3 — P2: la última comprobación de revisión no evita sobrescribir una edición concurrente

Ubicación: `dev/local_mcp.py:198-208`.

El hash se vuelve a comprobar en la línea 204 y luego se llama a `os.replace`. Una aplicación externa puede modificar el destino entre esas dos operaciones. `LOCK` sólo serializa threads de este proceso; Claude, Codex y editores no lo comparten. En esa ventana, `os.replace` pisa silenciosamente la edición externa y la respuesta informa éxito.

La reproducción temporal interceptó `os.replace`, escribió primero una edición externa válida en el destino y luego ejecutó el reemplazo real. El toggle terminó con éxito, `enabled = false` quedó persistido y la edición externa desapareció. Las pruebas actuales cubren sólo un cambio anterior a la segunda comparación, por eso no detectan este caso.

La aceptación promete rechazar conflictos, de modo que hace falta un mecanismo de exclusión entre procesos que cubra la última lectura y el reemplazo, con comportamiento comprobado en Windows. Si no se puede excluir a writers no cooperativos, el contrato y la UI deben describir el control como optimista y no garantizar que todo conflicto se rechaza. Agregar una prueba que inyecte la edición exactamente en la ventana final.

## Evaluación restante

- El inventario no devuelve `command`, `args`, `url`, headers ni `env`; los fixtures confirman que esos valores no aparecen en el JSON HTTP. Los identificadores y revisiones son hashes, y el handler silencia URLs y payloads en logs.
- Codex conserva comentarios y otros campos mediante `tomlkit`; Claude conserva semánticamente las claves ajenas al toggle. Los reemplazos usan archivo temporal, `fsync` y `os.replace`, y el fallo de reemplazo deja intacto el original. F1 cubre el riesgo introducido por el respaldo completo.
- El servicio escucha sólo en `127.0.0.1:8772`; exige `Origin: http://localhost:3039`, limita `Host` a loopback y requiere un bearer efímero después del bootstrap. Requests con origen, host o token incorrectos son rechazados. El frontend sólo muestra la sección en hostname loopback y distingue configuración declarada de conexión comprobada.
- La UI separa Claude/Codex y contextos de Claude, bloquea toggles mientras guarda, conserva el estado visible ante un error y avisa que una sesión nueva es necesaria. F2 impide aceptar todavía la afirmación de éxito para `.mcp.json`.
- No se ejecutan MCP ni se intentan conexiones. No vi rutas hacia producción, brokers u órdenes en el diff.

## Verificación ejecutada y límites

- `python -m unittest test_local_mcp.py`: 9 tests, PASS, usando directorios temporales.
- `npm test -- --watchAll=false --runTestsByPath src/components/settings/LocalMcp.test.tsx`: 3 tests, PASS.
- `CI=true npm run build`: compilación de producción, PASS; sólo emitió el aviso no bloqueante de `caniuse-lite` desactualizado.
- Dos reproducciones ad hoc con `TemporaryDirectory`: estado de aprobación compartida de Claude y edición concurrente en la ventana final; ambas reprodujeron F2 y F3 sin tocar archivos reales.

No ejecuté `dev/local_mcp_smoke.py`, el navegador contra inventario real, la suite frontend amplia ni ningún comando que leyera o escribiera configuraciones personales. Los resultados del implementer sobre navegador, suite amplia o CLI nativa no se atribuyen a esta pasada. Este review queda fijo sobre el rango indicado y no tendrá recheck; el implementer debe registrar la disposición de los hallazgos sin editarlo.
