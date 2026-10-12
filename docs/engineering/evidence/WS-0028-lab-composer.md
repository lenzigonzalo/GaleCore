# WS-0028 — Primera tajada del handoff: caja, ancho y foco

Pedido del owner del 12/10/2026: retomar el handoff de Astra con Sol 6.1. Continuación visual aislada;
WS-0029 sigue activo en el workspace. Fuente: `docs/engineering/HANDOFF-WS-0028-LAB-UX-Y-ARTEFACTOS.md`
del workspace. No acredita cierre de P1-10 ni del recorrido C12.

## Contrato de esta tajada

- Entrada: Lab → conversación, nuevo proyecto y renombrado.
- Resultado: compositor centrado de 800 px, lectura de 880 px, caja de dos líneas que crece hasta seis,
  foco neutro visible y scroll que conserva el lugar mientras se leen mensajes anteriores.
- Aceptación positiva: mouse y Tab/Shift+Tab; textarea/input/select; texto largo; tabla ancha;
  sidebar abierto/cerrado; 900/390 px; borradores separados por proyecto/conversación conservados al cambiar.
- Aceptación negativa: sin desborde de página, sin resize manual, sin doble ring de Tailwind/forms,
  sin salto al final por polling mientras se lee el historial.
- Fuera: puente, modelo/esfuerzo efectivo, adjuntos, dictado, artefactos financieros y ampliación SHADOW.
  No se modifican permisos, contexto, configuración del Lab ni procesos de prueba.
- Revisión: diff por otro agente; estado y aprobación del item quedan pendientes del owner.

## Implementación

- `Lab.css`: ancho de lectura y compositor, foco del textarea en su superficie, crecimiento limitado,
  responsive y «Ir al último mensaje». Tablas mantienen su scroll horizontal y tamaño de letra.
- `Lab.tsx`: altura según contenido; seguimiento del final sólo cuando el usuario está cerca o envía;
  navegación al último mensaje explícita. Borradores existentes siguen separados por chat/proyecto.
- `index.css`: token `--focus-ring` gris y eliminación del ring adicional de Tailwind/forms en campos.
  Foco de botones y summary visible por teclado. No se cambian colores de ganancias, pérdidas o errores.

## Verificación

- `CI=true npm run build`: exit 0, versión final con ResizeObserver compilada correctamente.
  Aviso informativo existente de Browserslist desactualizado; no se actualizaron dependencias.
- `git diff --check`: exit 0.
- Chromium aislado con el componente `Lab` real y CSS compilado con Tailwind/forms: exit 0.
  Textarea inicial 56 px, sin resize manual, hasta 168 px; foco gris `rgb(182, 182, 176)`,
  box-shadow adicional `none`; input con el mismo foco. Sin errores JavaScript.
- Borrador largo, cambios de ancho/sidebar, conservación de borradores separados al navegar,
  actualización de polling mientras se lee arriba, regreso explícito al final y Tab/Shift+Tab: PASS.
- 1600 px, 900 px y 390 px, sidebar abierto/cerrado, respuesta guardada con tabla: sin desborde de página.
  Capturas de escritorio, campos y anchos 900/390 inspeccionadas visualmente por el implementer.
- Guion permanente: `docs/engineering/evidence/lab-composer-qa/check.cjs`.
  Desde la raíz del workspace: `node .worktrees/galecore/WS-0028/docs/engineering/evidence/lab-composer-qa/check.cjs`.
  Reutiliza esbuild/Playwright de `.tmp/lab-ui-qa/node_modules`, dependencias del monitor del worktree
  y Chromium instalado en `C:/Users/lenzi/AppData/Local/ms-playwright/chromium-1091/chrome-win/chrome.exe`.
- Artefactos locales: `C:/Users/lenzi/OneDrive/Escritorio/GaleCore/.tmp/lab-composer-qa/`:
  `result.json`, `desktop.png`, `fields.png`, `width-900.png`, `width-390.png`,
  `collapsed-900.png`, `collapsed-390.png` y preview `index.html`.
- Fuente de lectura: respuesta original guardada en el chat local `53992633-8f70-4837-8681-bbe3b5dfebab`.
  Es reproducción histórica para presentación, no evaluación de los números ni estado financiero actual.
  Los otros mensajes/proyectos son fixtures explícitos de QA. API sustituida y red bloqueada:
  no se escribieron proyectos ni se enviaron consultas al modelo. No acredita E2E autenticado.
- Revisión de otro agente Sol 6.1 (no Sonnet): `docs/engineering/reviews/WS-0028-lab-composer-review.md`.
  Snapshot inicial CHANGES_REQUESTED por F1: altura no recalculada al cambiar ancho.
  Corregido por implementer con ResizeObserver; QA/build finales verdes, sin recheck independiente.
  No se modifica el review ni se presenta como APPROVE.
- Lockfile idéntico al del worktree previo; dependencias reutilizadas mediante junction al worktree
  `ws0028-lab-chat`, sin instalaciones ni cambios en node_modules del monitor en ejecución.

## Integración local y vista disponible

Commit de implementación `9b5be7e`, integrado por fast-forward en `local/integracion`, sin push/PR.
No se reiniciaron monitor, API ni puente. El archivo Runtime no versionado ajeno se conservó intacto.
`ACTIVE_WORK_ITEM` continúa apuntando a WS-0029 y su documento no se modificó.

Comprobación posterior: monitor `http://localhost:3039/`, login visible; bundle HTTP 200 con
`lab-jump-latest` y ResizeObserver del cambio, errores JavaScript `[]`. No se inició sesión ni una
conversación: sigue pendiente QA autenticada. Primera comprobación del texto acentuado en el bundle
dio falso negativo por su representación; se repitió con el identificador CSS estable, exit 0.

Preview interactiva aislada en `http://127.0.0.1:3041/`, servida con Python desde
`.tmp/lab-composer-qa/` (PID inicial 33744, puerto nuevo). Comprobada visible en Chromium.
No conecta al Lab; CSP bloquea conexiones y el adaptador de QA rechaza escrituras. Presenta proyectos
de QA y una respuesta histórica, no estado actual ni soporte de envío real.
Resultados adicionales locales: `live-result.json`; guion `lab-composer-qa/check-live.cjs` en esta carpeta.

Para probar: en el Lab local, escribir varias líneas y usar Tab; cambiar de proyecto/chat y volver
al borrador; subir en el historial y usar «Ir al último mensaje». Para mirar el diseño sin efectos,
abrir la preview aislada. Adjuntos y micrófono no se ofrecen todavía.

## Para retomar

Tajada visual implementada y comprobada en aislamiento. F1 corregido y probado por el implementer.
No marcar VALIDATED/CLOSED. QA autenticada real pendiente; el owner puede ver el Lab del monitor local
y juzgar ancho/foco/caja, o abrir la preview aislada sin efectos.
Adjuntos, modelo/esfuerzo, artefactos y SHADOW siguen el handoff y sus dependencias con WS-0029;
no están implementados por este cambio. WS-0029 permanece activo; no se editó su work item.
