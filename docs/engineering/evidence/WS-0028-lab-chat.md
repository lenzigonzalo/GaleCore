# WS-0028 — Presentación del chat del Lab (12/10/2026)

Pedido del owner: Markdown y tablas legibles, quitar el placeholder «Acá vamos a trabajar…», preparar selección de
modelo/esfuerzo y dejar adjuntos/micrófono para después. Restricción: no interrumpir las pruebas de Claude.

## Cambio y alcance

- Respuestas del asistente con `react-markdown` + GFM: tablas, negritas, listas, código y enlaces. HTML sin ejecutar e
  imágenes externas sin cargar. Texto original conservado; no se reescribieron respuestas ni conocimiento.
- Tema carbón y tipografía existente, tablas con desplazamiento horizontal y foco accesible; caja de consulta sin placeholder.
- Controles de modelo/esfuerzo por conversación nueva. Sólo envían opciones si el servicio anuncia soporte; conversaciones
  existentes mantienen su selección. El estado heredado no se presenta como modelo efectivo comprobado.
- Se encontró **una** respuesta con el comienzo «Como idea vale» en el registro local (una ocurrencia, 2.207 caracteres).
  No se deduplicó historial basándose en el texto repetido del pedido.
- Sin cambios en datos financieros, aprobaciones, mandatos, instrucciones del harness o permisos del servicio activo.

## Verificado

- `CI=true npm run build`, worktree `feature/ws0028-lab-chat`: exit 0, compilación correcta.
- `git diff --check`: exit 0.
- Chromium aislado mediante Playwright, usando los componentes reales y la respuesta local ya guardada: tabla de cuatro
  filas, negritas, dos listas ordenadas, textarea sin placeholder; script/URL javascript/imagen externa no ejecutados ni
  cargados. Sin desborde de página a 390 px; selector modelo/esfuerzo y reset de esfuerzo al elegir Haiku comprobados.
- Inspección visual de las capturas de escritorio y móvil. El fixture de seguridad es sintético y está separado del
  texto financiero real; no es una evaluación de la calidad financiera de esa respuesta.
- El navegador aislado abre el monitor real en login. No se usaron credenciales, no se enviaron mensajes ni se
  escribieron proyectos. Esto verifica componentes; **no acredita una sesión autenticada E2E**.
- La herramienta de navegador integrada no arrancó por error del sandbox; se usó Chromium headless separado.

Las capturas y el guion de comprobación quedan en el workspace, `.tmp/lab-ui-qa/` (artefactos locales, fuera del commit).
No se marca VALIDATED/CLOSED este item ni C12.

## Integración local y recuperación del monitor

Frontend integrado en `local/integracion` (commit `a931964`), sin push/PR. La instalación inicial sin modificar lockfile
resolvió también versiones transitivas; se sincronizó inmediatamente la instalación con el lockfile exacto del build.
Comparación de todas las versiones instaladas: `missing: []`, `changed: []`; lockfile idéntico al compilado.

El servidor React en caliente retuvo errores de módulos durante esa instalación. Se intentó invalidación por archivos;
persistió una caché inválida. Se reinició **sólo el servidor visual :3039** mediante el arranque canónico
`python dev/galecore_dev.py monitor`, con ventana oculta. La caché `node_modules/.cache/webpack` se renombró dentro del
mismo directorio a `webpack-pre-lab-chat-20261012` (no se borró). Esta intervención no ejecutó reinicios del Lab :8771,
de la API ni detuvo conversaciones/procesos del modelo. El Lab fue observado con PID 19096 y luego 6444 durante el
trabajo concurrente; no se atribuye continuidad de ese proceso a esta verificación. La interrupción del servidor visual no se presenta como E2E
sin fricción ni como parte de la evaluación de Claude.

Comprobación después de recuperar el monitor: página de login accesible, bundle HTTP 200 con el renderizador nuevo,
sin errores JavaScript (`errors: []`) en Chromium aislado. El soporte del selector sigue sin integrar en el puente.

## Modelo/esfuerzo: continuación sin interrumpir Claude

Soporte del puente preparado en el repo **workspace**, rama `feature/ws0028-lab-options`, commit `0dfe4b6`;
worktree `.worktrees/workspace/ws0028-lab-options`. No se integró en el proceso activo.

- El servicio anuncia opciones, valida modelo/esfuerzo y las persiste por chat. Pasa flags al CLI sin cambiar permisos.
- Doce tests acotados (`node --test tools/terminal/lab-chat-options.test.js tools/terminal/lab-workspaces.test.js`) pasan,
  incluido rechazo de flags inyectados, persistencia por chat y preservación de argumentos de conversaciones previas.
- Flags comprobados en `claude --help` y `codex exec --help` locales. No se hizo una inferencia paga de prueba ni se
  acreditó que cualquier modelo/esfuerzo esté habilitado en la cuenta. El CLI puede rechazar una combinación.
- **Cuando terminen las pruebas**: revisar/integrar ese commit preservando el cambio local ajeno de modelo por defecto
  en `tools/terminal/lab-workspaces.js`; el helper reemplaza el flag de modelo sólo si se seleccionó uno explícito.
  Reiniciar el puente únicamente con las sesiones desocupadas y después comprobar selección → nuevo chat → CLI efectivo.
- No incluir los cambios ajenos de presupuesto, evidencia del harness o work item en el commit de este ajuste.

Adjuntos y dictado por micrófono quedan sin implementar para una siguiente iteración. No se muestran botones que
simulen funciones disponibles. Este ajuste no altera la crítica financiera ni resuelve el permiso de escritura mencionado
por esa respuesta; eso pertenece a la corrida del harness que está haciendo Claude.
