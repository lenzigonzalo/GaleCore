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

## Iteración del owner — caja más compacta y lateral ajustable (12/10)

Feedback: «La caja sigue siendo muy grandota, la barra lateral debería ser achicable o agrandable,
me gusta el tamaño de la letra». Reemplaza el requisito de dos líneas iniciales de esta tajada:
una línea inicial, crecimiento al escribir hasta seis, letra conservada y una sola barra de controles.
Modelo/esfuerzo se abre encima de la caja, sin aumentar su altura; el atajo permanece descrito para
lectores de pantalla y en el tooltip del textarea.

Sidebar ajustable por su borde, de 200 a 480 px cuando hay espacio; reserva al menos 420 px al chat
en escritorio. Flechas cambian 10 px, Shift+flecha 40 px, Home/End llevan a los límites; doble clic
restablece 310 px. Preferencia local persistida. El botón de colapsar conserva el ancho elegido.
En anchos de hasta 700 px se mantiene la adaptación móvil y se oculta el separador de ancho.

Aceptación: altura total inicial <=100 px, texto de entrada 16 px y lectura 18 px como antes;
drag, teclado, límites, persistencia, colapsar/reabrir, cambios de ventana, borrador largo y settings.
Sin desborde de página a 900/390 px ni aumento de caja al abrir settings. Sólo interfaz local;
sin nuevos contratos, inferencias, permisos ni cambios de WS-0029.

Verificación de esta iteración:

- Chromium aislado, guion actualizado: exit 0. Caja inicial medida de **92 px × 760 px**, textarea
  de 28 px/16 px de letra; lectura conserva 18 px. La caja anterior medía aproximadamente 194 px
  en la captura inicial. Settings abierto no aumenta la altura de la caja.
- Arrastre 310→400 px; recarga real de la página conserva 400 px; flechas, Shift+flecha, Home/End,
  límites 200/480 px, colapsado a 64 px y reapertura al ancho elegido, doble clic para restablecer: PASS.
- Cancelación sintética de pointer durante un arrastre real libera captura y evita seguir cambiando
  ancho al mover el mouse. Panel abierto con Enter y cerrado con Escape; panel a 900/390 px
  dentro de la ventana, sin aumentar caja: PASS. No equivale a una prueba de hardware táctil.
- Pruebas previas de foco, borradores, polling, caja larga y responsive también verdes; errores JS `[]`.
  Capturas de escritorio, settings y móvil inspeccionadas. La preview y los artefactos locales de
  `.tmp/lab-composer-qa/` se regeneran con la versión más reciente; no son snapshots inmutables.
- Review estático de otro agente Sol 6.1: `docs/engineering/reviews/WS-0028-lab-composer-sidebar-review.md`,
  APPROVE sin hallazgos bloqueantes sobre el diff identificado allí. Sus límites de evidencia se
  completaron después con recarga, cancelación y panel móvil; no se modificó ni reabrió ese review.
  Escape, cancelación explícita y agarradera visual se consolidaron después de su snapshot.
- Intento de las tres regresiones Jest existentes del Lab, incluido reintento con `--watchman=false`:
  exit 1 «No tests found / No files found» en el worktree. No se presentaron como aprobadas ni se
  usó `--passWithNoTests`. Los recorridos del cambio fueron comprobados en Chromium con el componente
  real; el fallo de descubrimiento de Jest queda pendiente, fuera de este ajuste de interfaz.

`CI=true npm run build` de la versión final consolidada: exit 0, compilación correcta.
`git diff --check`: exit 0. Commit `a90eb5e` integrado por fast-forward en `local/integracion`.
Comprobación final del monitor servido: exit 0, bundle HTTP 200, `compactToolbar: true`,
`resizableSidebar: true`, `resizeObserver: true`, errores JS `[]`; preview `:3041` visible.
Sin reinicios ni instalaciones. No se ejecutó un E2E autenticado ni se enviaron mensajes reales.

Para probar esta versión: abrir el Lab y escribir; la caja parte de una línea y crece al necesitarlo.
Arrastrar la agarradera gris del borde de proyectos para achicar o agrandar; recargar conserva el ancho.
Doble clic restablece el ancho inicial. Letra sin cambios. WS-0029 sigue activo y no se marca cierre.

## Ajuste de ancho solicitado por el owner (12/10)

«Más largo, no tan alto»: se elimina el límite de 760 px del compositor. Ocupa el ancho disponible
del chat dejando 28 px por lado en escritorio y 14 px en móvil. Se conserva la altura compacta,
crecimiento al escribir, letra, columna de lectura y lateral ajustable. Ajuste exclusivamente CSS;
preview y verificación proporcional según D-0010, sin nuevo review por esta iteración visual.
Guion actualizado para comprobar ancho igual al área de chat menos los márgenes, altura y tipografía.

Chromium aislado: exit 0; en viewport 1600 px, caja medida **1234 × 92 px**, frente a 760 × 92 px
de la iteración anterior. Letra de entrada 16 px, lectura 18 px; foco, sidebar, borradores, scroll
y responsive siguen verdes. Captura `desktop.png` inspeccionada y preview `:3041` regenerada.
`git diff --check` y `CI=true npm run build`: exit 0. Commit `cecaf9e` integrado en
`local/integracion`, sin reinicios. Bundle servido HTTP 200 con `wideComposer: true`;
errores JS `[]`, preview visible. Comprobación de login/bundle, sin E2E autenticado.

## Iteración: conversación ancha y barras compactas (12/10)

Feedback: «Y qué pasó con la letra y el ancho… la barra de arriba que tiene el título ocupa mucho
espacio… parece que el chat ocupa poco». Se comprobó la causa: caja ancha ya integrada, pero los
mensajes seguían con columna limitada a 880 px; la preview anterior tampoco incluía la barra
general Monitor/Operativa/Lab, que ocupa otros 76 px en el monitor real.

Se amplían los mensajes al mismo ancho disponible del chat, con 28 px de margen por lado; letra
sin cambios (18 px escritorio, 16 px móvil; entrada 16 px). Barra del proyecto de 48 px, título y
tipo en línea cuando entran; barra general compacta sólo dentro del Lab. Controles y menú de cuenta
conservados; sin recorte del menú. La preview ahora incluye `WorkspaceHeader` real además de `Lab`.

Aceptación visual: ambas barras <=52 px en escritorio; mensajes y caja igual al ancho del chat
menos los márgenes; letra conservada; responsive, menú de cuenta y teclado. D-0010, ajuste visual
acotado sin review adicional. Sin contratos de datos, puente, permisos ni cambios de WS-0029.
Chromium aislado: exit 0; barra general medida de 50 px, título de 48 px; mensajes y caja de
1234 px de ancho en viewport 1600 px. Letra de mensajes 18 px y entrada 16 px; caja inicial 92 px
de alto. Menú de cuenta abierto/cerrado por teclado, contenido dentro de la ventana en escritorio
y móvil, sin clipping. Borradores, scroll, sidebar y settings siguen verdes; errores JS `[]`.
Captura completa de escritorio inspeccionada con las dos barras reales. Preview `:3041` regenerada.
`git diff --check`: exit 0. Build final en curso.
