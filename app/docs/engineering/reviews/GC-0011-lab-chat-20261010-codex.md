# GC-0011 — revisión independiente Lab chat

**Dictamen: CHANGES_REQUESTED** — 0 blocker, 1 major, 1 minor.

## Alcance

- Revisión independiente de una pasada, sólo lectura salvo este informe.
- Front comparado con `2db001c` en el worktree `feature/front-estructura-local`: `App.tsx`, `WorkspaceHeader.tsx`, `index.css`, `api/lab.ts`, `Lab.tsx`, `Lab.css`, `LabShadow.tsx` y tests Lab/Shadow.
- Servicio local comparado con `91619d6`: `tools/terminal/lab-server.js`, `lab-workspaces.js`, su test y `tools/terminal/skills/lab-strategy-bootstrap/SKILL.md`.
- Revisados: aislamiento de proyectos/Files, persistencia e interrupción de chats, reanudación por ID nativo, eventos JSON de Codex/Claude, límites de permisos, ausencia de endpoints de aprobación/deploy y lectura de SHADOW por `specName`.
- Ambos árboles estaban sucios. No se revisaron los archivos ajenos `%SystemDrive%/`, `scratch_105.json` ni `scratch_story.json`. No se tocó el work item ni WS-0021.

## Hallazgos

### MAJOR — “En Shadow” mezcla el estado de la versión actual con cualquier versión histórica del mismo proyecto

`source/galecore-monitor/src/pages/LabShadow.tsx:22` marca el paso **En Shadow** si existe cualquier instancia `RUNNING` con el mismo `specName`. El contrato ya trae `current.spec_hash` (`LabShadow.tsx:6`) y cada instancia trae `versionHash`, pero no se comparan. Si la versión A sigue corriendo y la versión actual es B, la secuencia presenta Propuesta/Aprobación de B junto con En Shadow de A. Tampoco se muestra el hash en la lista de ejecuciones, por lo que el usuario no puede distinguir la versión desplegada.

Esto contradice el límite declarado por el bootstrap: mostrar hechos de SHADOW por spec/versión y no inferir despliegue de la versión actual. Las métricas históricas sí pueden seguir agrupadas y filtradas por `specName`; el paso de lifecycle debe usar `instance.versionHash === current.spec_hash`, y la lista de ejecuciones debe exponer versión/hash. Falta un test con dos hashes bajo el mismo `specName`.

### MINOR — el contrato acepta 12.000 caracteres, pero HTTP corta el cuerpo antes de 8.192

`tools/terminal/lab-workspaces.js:126` declara mensajes válidos de 1 a 12.000 caracteres y la UI no impone un máximo menor. Sin embargo, `tools/terminal/lab-server.js:167` rechaza y destruye cualquier request cuyo JSON completo supere 8.192 caracteres. Un mensaje válido de aproximadamente 8 KB a 12 KB nunca alcanza la validación específica y falla como pedido demasiado grande. Hay que alinear ambos límites, contando además el envoltorio JSON, y cubrir el borde mediante la ruta HTTP real.

## Evidencia y límites

- Ejecutado durante esta pasada: `node --test tools/terminal/lab-workspaces.test.js` — 4/4 PASS.
- Ejecutado durante esta pasada, antes de que se agregaran los tests Shadow concurrentes: `CI=true npm test -- --watchAll=false --runInBand --testMatch **/Lab.test.tsx` — 3/3 PASS.
- El implementer reportó después 6 tests UI PASS (Lab + LabShadow), compilación CRA sin warnings, intercambio Codex real con `nativeId` persistido y segundo turno reanudado. No se repitieron como recheck; el límite semanal informado por Claude no demuestra una falla de integración.
- Consulta sanitaria a `:8771`, sin imprimir token, títulos ni mensajes: scope `local-os-user`; 4 proyectos (`personal:1`, `analysis:1`, `strategy:2`); chats `idle:1`, `failed:1`; Codex y Claude detectados.
- El recorrido está correctamente limitado a loopback/orígenes explícitos, token efímero, lectura Files dentro del `realpath` del proyecto, exclusión de symlinks/nombres privados y previews de texto acotadas. Los chats se persisten por proyecto; un job activo bloquea otro sobre el mismo proyecto/cartera; al reiniciar, un job `running` pasa a `interrupted`; no hay ruta HTTP de approve o deploy.
- No se ejecutaron modelos, no se abrieron mensajes reales, no se leyeron secretos, no se modificaron estrategias y no se hizo deploy. No hubo QA visual por navegador ni prueba independiente de Claude por su límite externo.

Este dictamen cubre sólo el hito Lab chat descrito arriba. No valida ni cierra GC-0011 y no implica aprobación del owner.
