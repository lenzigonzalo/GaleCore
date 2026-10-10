---
id: GC-0011
title: Estructura integral del front — exploración local
status: CHANGES_REQUESTED
implementer: codex
reviewer: review_front_estructura (Codex independiente)
approver: user
review_result: CHANGES_REQUESTED
approval_result: PENDING
---

# GC-0011 — Estructura integral del front, exploración local

09/10/2026, owner: priorizar reordenamiento mayor desde FRONT-GALECORE-INTEGRAL, con identidad visual propia,
referencias TradingView/Unusual Whales/Robinhood y perspectiva futura. Corrige el recorte demasiado parcial GC-0010.
Rama feature/front-estructura-local desde local/integracion, worktree .worktrees/galecore/front-estructura-local.
GC-0010 queda guardado sin integrar; se detuvo su preview :3039. ACTIVE_WORK_ITEM sigue WS-0021/P1-09.
Exploración autorizada, no cierre/entrega integral de P1-10 ni cambio de plan.

## Contrato

- Navegación principal lateral única, contraíble y con nombres orientados al trabajo; sin pestañas globales duplicadas.
- Main resume cuenta real, posiciones, métricas SHADOW separadas y accesos a secciones; Claves del día lee publicaciones.
- Calendario/gráficos de performance de cuenta requieren historia/cálculos de GaleCore; no se dibujan series ficticias.
- Posiciones del bróker abren Cartera; vínculo de estrategia pendiente de atribución explícita.
- Mercado abre GEX; Estrategias reúne catálogo, RPF y SHADOW como vistas internas.
- Cartera tiene balance y Monitor; el detalle de cuenta ya no ocupa columna permanente en otras páginas.
- Biblioteca reutiliza registros actuales de Inteligencia; no presume biblioteca completa ni búsqueda inexistente.
- Agentes, Configuración y Administración conservan las vistas/acciones actuales; admin sólo visible con rol efectivo isAdmin.
- Conversación abre/oculta la terminal actual, sin reemplazar la sesión al navegar; fuente de datos y etiquetas financieras se conservan.
- Tema carbón/DM Sans, jerarquía, alineación, separación discreta; no nuevas fuentes, métricas, MCPs, Lab ni controles financieros.
- Negativo: acceso/publicación fallidos no se presentan como ausencia verificada de avisos; datos ilegibles son explícitos.
- Fuera de alcance: perfil editable nuevo, buscador global, chat propio, métricas del Lab, órdenes, LIVE, traducción/restyling completo de cada vista heredada.

## Mapa de reordenamiento

| Antes | Ahora |
|---|---|
| Main | Dashboard de cuenta, posiciones y resultados; catálogo dentro de Estrategias |
| Monitor + cuenta en columna fija | Cartera + cuenta en encabezado compacto |
| GEX bajo menú Estrategias | Mercado |
| RPF / SHADOW bajo menú global | Vistas internas de Estrategias |
| Inteligencia | Biblioteca (regímenes/informes actuales, alcance explícito) |
| Barra global de pestañas | Navegación lateral; pestañas sólo dentro de Estrategias |
| Botón flotante Claude Code | Conversación en navegación y encabezado; terminal opcional |

## Evidencia

- CI=true npm run build: exit 0, Compiled successfully (configuración de build habitual).
- Tests de WorkspaceNav y Today tras corregir el review: 6 passed, 2 suites passed. Verifican destinos, contraer, permisos y lectura fallida/ilegible.
- App.test heredado: falló por import ESM de lightweight-charts; misma falla en local/integracion intacta.
  Esa plantilla además conserva expectativa learn react; no se modificó de paso. Log base en dev/.local/app-baseline.log (no versionado).
- LayoutPreview.test: 1 passed; comprueba navegación, panel y ausencia de llamadas a Space/Me.
- git diff --check: exit 0.
- Build para preview con configuración oficial Dev: exit 0, Compiled successfully. Preview http://127.0.0.1:3040: HTTP 200. API Swagger Dev respondía HTTP 200 en esta sesión.
- QA visual y navegación autenticada pendientes: CUA inventario sin navegador y IAB no disponible.
- Datos sintéticos sólo en tests, no snapshots de mercado ni contenido de pantalla.
- Revisión independiente de una pasada: CHANGES_REQUESTED, 0 BLOCKER y 3 MAJOR; informe propio
  docs/engineering/reviews/GC-0011-20261009-codex.md. Sin rechecks ni aprobación inferida.
  Corregidos por implementer: supervisor exige alerts y last_run válido (dos negativos agregados);
  conexión describe transporte y no salud del feed; saldo identifica última lectura y stale.
  Verificación visual/auth pendiente; no se modifica el informe del reviewer.

## Corrección del owner y evidencia del 09/10/2026

El owner rechaza la preview vacía, el nombre Hoy y el cambio de puerto. D-0004 registra Main como inicio.
Diagnóstico ejecutado: OPTIONS /App/GaleCore/Auth/Login devuelve 204 en tres orígenes; sólo
http://localhost:3039 recibe access-control-allow-origin. :3040 y 127.0.0.1:3039 no están autorizados.
No se modificó la API ni CORS. Se eliminó LayoutPreview y su flag de App, restaurando el login y consultas reales.

Main reutiliza AccountSummary/store; muestra instrumentos reales recibidos y consulta Runtime/Metrics cada 30 s.
Claves del día conserva publicaciones de supervisor/agentes. Cuenta y SHADOW permanecen separados.
Resultados parciales sin valuación se indican; nulos no se presentan como cero. No se atribuye estrategia al bróker.
El adaptador account valida campos numéricos y lista de posiciones: lectura incompleta falla en vez de inventar
ceros o una fecha de fuente. Se retiran logs de cuenta. Fecha de recepción permanece en el store.

- Build oficial Dev + CI=true: exit 0, Compiled successfully; main.658809c6.js.
- Tests Main, account, Today y WorkspaceNav: 11 passed, 4 suites; fallos de lectura, campos incompletos,
  pérdida monetaria, valuación parcial, cero real y destinos. Fixtures sintéticos sólo en tests.
- HTTP http://localhost:3039 y asset main.658809c6.js: 200; preflight API permite ese origen.
- Servidor estático sólo loopback, port 3039; servidor 3040 detenido. No mock/demo ni credencial nueva.
- CUA getState: apps y browsers vacíos. Visual/auth del owner no comprobados; no se afirma recepción de su saldo.
- La pasada independiente anterior no cubre este nuevo diff. Estado CHANGES_REQUESTED y aprobación pendiente.
- PerformanceReport (GaleCore base) contiene portfolio, agregados y trades SHADOW; Balances/Positions no
  exponen historia completa de patrimonio ni resultados diarios de cuenta. Calendario de cuenta queda pendiente.

## Para retomar

Demo visual temporal autorizada por el owner: ?main=demo, selector local y fixtures MainDemo.*.
RETIRADA OBLIGATORIA de archivos/flags/tests demo antes de Main final; checklist en sección Demo visual temporal autorizada.
Primera iteración autorizada: Gestión real separada de Trabajo/Lab (D-0006).
Main: cuenta real en franja financiera, posiciones y faltantes explícitos de historia/noticias; sin métricas o publicaciones SHADOW.
Lab: resumen SHADOW por versión, versiones cargadas y actividad; subtabs Resumen/Estrategias/Ejecuciones SHADOW.
Sidebar Gestión/Trabajo/Compartido; Mercado/Biblioteca compartidos. Asistente persiste al navegar.
Supervisor emergente SHADOW sólo en Trabajo; no se habilitaron órdenes, LIVE ni nuevos cálculos.
Iteración actual: Main centrado en Estrategias activas; expandir posiciones, abrir workspace contextual, conservar borrador/consultas por estrategia mientras la demo sigue montada. Hallazgos y agenda separados; watchlist abre vista Mercado del símbolo. Harness aún sin integrar; no respuestas simuladas.
Preview localhost:3039 usa CRA con recarga automática (launcher local start-visual-preview.ps1, PID 13484); ?main=demo abre mocks, URL sin query cuenta real Dev.
ACTIVE_WORK_ITEM sigue WS-0021. GC-0011 sigue exploración CHANGES_REQUESTED por revisión integral anterior.
Pendientes: vincular cuenta en formulario existente, historia/performance/avisos reales, logo final y QA visual.
No integrar como entrega ni pushear ni marcar VALIDATED/CLOSED sin revisión/aprobación correspondientes.

## Iteración solicitada por owner — 09/10/2026

Antes de continuar: análisis de divergencia en FRONT-GALECORE-INTEGRAL §26. Aceptación de esta iteración:
- Mercado: watchlist derecha contraíble/redimensionable por mouse y teclado, mismo universo/feed/suscripciones, + abre búsqueda real y respeta ad_hoc_search; sin persistencia ficticia.
- Encabezado: búsqueda de secciones y símbolos reales; errores visibles, no búsqueda de documentos/conversaciones sin contrato.
- Conversación: acción del encabezado, sin falso destino de navegación; misma terminal y sesión al ocultar.
- Sidebar legible: sin grupos confusos; marca textual hasta disponer del asset acordado.
- Separar Lab/construcción de seguimiento de ejecuciones; no agregar comandos Deploy/Stop ni builder gráfico no soportado.
- Menos microtexto: contexto esencial visible, procedencia/detalle secundario desplegable; conservar modo, fecha y errores.
- Mantener origen3039/APIDev y worktree aislado; no modificar WS-0021 ni orden del plan.

### Evidencia de la iteración

- Build oficial Dev + CI=true: exit 0, Compiled successfully; main.4c2a64cc.js.
- Tests del recorte: 21 passed, 8 suites; búsqueda real/fallo, destinos, resize con puntero/teclado,
  conservación del contenido al contraer, alcance SHADOW y sesión existente al abrir Lab.
- git diff --check: exit 0.
- localhost:3039 y asset main.4c2a64cc.js: HTTP 200. Mismo servidor estático loopback de la iteración anterior.
- CUA inventario: apps/browsers vacíos. No se afirma QA visual, E2E de búsqueda real ni resultado de la sesión owner.
- Inspección: Specs y Specs/{name} del AppController; tienda GEX/política JSON, mercado/terminal y componentes.
  Lab sólo GET Specs; no nueva mutación, aprobación ni despliegue. Feed y suscripciones conservados en TickerGrid/GEX.
- Una falla TS por props retiradas, opcionales del contrato y warning de cleanup se corrigieron antes del build verde;
  test heredado de nota se corrigió conservando la distinción recepción/origen en detalle.
- Marca: pregunta al owner por variante/asset pendiente; no símbolo nuevo generado.

## Iteración enfocada Main + marca — feedback owner 09/10/2026

- Owner rechaza experiencia general y pide más claridad. Se limita el cambio a Main, marca elegida y acceso de vinculación de bróker. Mercado se conserva para una iteración propia.
- Main prioriza cuenta, performance y posiciones; claves secundarias. Un estado de cuenta sin vincular es una acción de conexión, no cascada de errores ni balance cero.
- Resultados SHADOW separados; vista inicial compacta, sin hashes ni tabla de todas las versiones en portada. Estados vacíos/parciales siguen honestos.
- Acceso Vincular cuenta abre configuración en bróker; no copiar credenciales/DB de producción. El owner ingresa OAuth en formulario existente.
- Owner elige logo adjunto; recolor al acento #a3d86c, sin cambio de geometría. Asset final en repo, transparencia.
- Aceptación negativa: cuenta no vinculada no genera error de posiciones repetido; falla genérica conserva diagnóstico/reintento; SHADOW no representa saldo real.

### Continuación de UI — 09/10/2026

Owner pide retirar la herramienta externa de diseño. Se eliminan sus referencias de esta exploración y de la
propuesta; el diseño continúa directamente sobre React con galecore-frontend. Primer recorte: Main, estados
reales y revisión visual antes de extender la composición. Sin cierre, integración ni QA visual inferidos.

La compilación Main anterior y el estado de vinculación quedan registrados arriba. Asset limpio del logo y
rediseño completo de Main siguen pendientes. ACTIVE_WORK_ITEM conserva WS-0021; GC-0011 es exploración local.

## Ajuste de Main y retirada de herramienta — 09/10/2026

- Retiradas referencias vigentes de propuesta/work item, artefactos locales de setup y entradas de marketplace/plugin/MCP en C:/Users/lenzi/.codex/config.toml. Búsqueda de referencias en workspace, GaleCore-AI y este worktree sin coincidencias; knowledge versionado sin coincidencias. Historial git conservado.
- Main: instrumentos en tabla comparable; resultados SHADOW por versión en detalle cerrado inicialmente. No cambia cálculos, consultas ni controles. Acción Ver con nombre accesible y área de 44 px.
- Pruebas de Main: 4 passed, 1 suite, exit 0. Comando efectivo: CI=true npm test -- --watchAll=false --runInBand --testMatch **/Main.test.tsx (PowerShell). CRA genera glob con separadores mixtos en esta ruta; el glob explícito permitió ejecutar las pruebas.
- Build final Dev CI=true: exit 0, Compiled successfully, main.d3f1bf4b.js y main.ae09a15d.css. HTTP localhost:3039 y asset: 200; index referencia el asset final. Servidor loopback PID 28296 sirve dev/.local/main-ui-final-build. El build sobre main-connect-build falló EBUSY; se usó carpeta nueva. Dentro del sandbox Node falló EPERM: ejecución autorizada fuera del sandbox.
- git diff --check: exit 0 antes de guardar. Revisión independiente APPROVE con P3 corregido, sin recheck: ../reviews/GC-0011-main-tabla-20261009-codex.md.
- CUA: apps/browsers vacíos. QA visual pendiente, sin aprobación de cierre. GC-0011 conserva CHANGES_REQUESTED por alcance integral anterior.

## Primera iteración Gestión / Trabajo — 09/10/2026

Instrucción explícita del owner: Main sólo gestión real; Lab con dashboard de trabajo y seguimiento SHADOW.
Aceptación: Main sin consultas/resultados/publicaciones SHADOW; Lab reúne versiones cargadas, métricas por versión y publicaciones existentes; sidebar distingue Gestión, Trabajo y Compartido. Seguimiento SHADOW pertenece a Lab, asistente conserva sesión al navegar. No se inventan avisos/noticias, performance histórica ni ejecución LIVE. El supervisor emergente se ofrece en Trabajo, no en Main/Cartera.
Fuera de alcance: nuevos contratos API, órdenes, builder, despliegues, cálculos o historia de cuenta. Revisión independiente del diff y pruebas Main/Lab/navegación. Mantiene exploración local y WS-0021.

### Verificación de Gestión / Trabajo

- Pruebas efectivas: CI=true npm test -- --watchAll=false --runInBand --testMatch **/Main.test.tsx **/Lab.test.tsx **/ShadowOverview.test.tsx **/WorkspaceNav.test.tsx **/Today.test.tsx. 14 passed, 5 suites, exit 0. Una expectativa antigua de Main requería métricas trasladadas a Lab: corregida antes de la corrida verde.
- Negativos: Main no consulta métricas SHADOW, error/ausencia de vínculo no implica cuenta vacía, métricas conservan pérdidas y valuación parcial, versiones no implican aprobación; conversación mantiene la sesión al abrir. Navegación SHADOW selecciona Lab.
- Primer build Dev CI=true: exit 0. Build final, review y HTTP se completan al entregar. git diff --check: exit 0. CUA apps/browsers vacíos: QA visual pendiente.

- Review independiente de una pasada: CHANGES_REQUESTED, 0 blocker/2 major, ../reviews/GC-0011-gestion-lab-20261009-codex.md. Implementer corrige saldo real en Agentes mediante condición separada workSection, agrega test de encabezado y oculta etiquetas del sidebar a <=700px. Sin recheck ni aprobación inferida; dictamen original conservado.

- Corrida final tras correcciones: 16 passed, 6 suites, exit 0; mismo comando de tests incluyendo **/WorkspaceHeader.test.tsx. Verifica saldo real ausente en Lab/Agentes, subnav SHADOW ausente en Gestión y destinos de encabezado.

- Build final Dev CI=true tras correcciones: exit 0, Compiled successfully, main.8c28b1a0.js y main.36e9805a.css. Preview localhost:3039 y JS: HTTP 200; index referencia asset final. Servidor Python loopback PID 10548 sirve dev/.local/spaces-reviewed-build. Sin QA visual/autenticada inferida.

## Diagnóstico de cuenta vacía — 09/10/2026

- Login Dev existente (demo), GET /App/GaleCore/Account: linked=false. Balances y Positions: HTTP 409, code broker_account_not_linked. Admin/Users: 1 usuario, 0 cuentas vinculadas, 0 cuentas de sistema en Dev. Se imprimieron sólo metadatos, sin credenciales, identificadores de cuenta ni saldos.
- Código: AccountBalancesHandler.GetForUser exige vínculo personal; TastytradeCredentialStore.GetSystem puede usar configuración local para el feed. Conexion abierta no acredita acceso a la cuenta personal. No se cambia ese aislamiento.
- Config local tiene refresh token y client secret; no se tocaron ni imprimieron secretos. Vincular una cuenta al usuario Dev requiere definir explícitamente la asociación; no se copió DB ni credencial de producción.

## Vinculación de cuenta Dev autorizada — 09/10/2026

Owner proporcionó el número de cuenta para vincularlo a demo con OAuth local existente. POST inicial: HTTP 500. Lectura del error en memoria confirmó Falta Security:TokenProtectionKey; se imprimieron sólo indicadores, sin cuerpo/secretos.

Fix dev/galecore_dev.py: genera 32 bytes aleatorios Base64 sólo cuando falta clave Dev y la conserva en dev/.local/env.json ignorado; api_env la pasa por variable de entorno. No modifica user-secrets ni producción. Review independiente APPROVE: ../reviews/GC-0011-dev-cifrado-20261009-codex.md. Ruff check: All checks passed. unittest: 2 tests PASS.

Commit de sólo helper/tests 9b0f32b, integrado por cherry-pick 5ffaa4a en GaleCore local/integracion; no se integró la UI exploratoria. API Dev reiniciada por launcher PID 21996, contra mismo proyecto Dev; arranque genera/persiste clave de 32 bytes. Logs locales ignorados GaleCore/dev/.local/api-account-link.stdout.log y stderr.log, no incorporados como evidencia pública.

POST /App/GaleCore/Account: linked=true, coincide con la cuenta indicada. GET Balances y Positions: HTTP 200. Campos netLiquidatingValue, derivativeBuyingPower y cashBalance presentes y compatibles con parseBalances. Lista positions vacía: 0 posiciones abiertas recibidas, no es error ni fallback. Primera salida contó el wrapper como 1; comprobación posterior contó correctamente positions=0. No se imprimieron saldos, números de cuenta, tokens ni secrets.

Para verlo: recargar localhost:3039 (Ctrl+F5) para releer cuenta y limpiar el estado anterior sin vínculo. Lectura autenticada verificada por API como demo, no se afirma E2E visual. GC-0011 mantiene estado previo y QA visual pendiente.

## Demo visual temporal autorizada — 09/10/2026

Owner permite mock data para ver Main completo y exige eliminarla después. Alcance: demo local explícita con capital, atención, watchlist, posiciones y performance; fixtures aisladas, sin writes en stores/DB ni llamadas de ejecución. Alternar demo/cuenta real; detalles de demo permanecen en el prototipo. Cabecera no mezcla saldo/conexión reales con datos ficticios. Revisión y tests de aislamiento.

- [ ] RETIRADA OBLIGATORIA antes de entregar Main final: borrar MainDemo.tsx, MainDemo.fixture.ts, MainDemo.css y su test; retirar flags/props/selector demo en Main, App, WorkspaceHeader y sus tests. Reusar únicamente composición aprobada con fuentes reales; comprobar búsqueda de MainDemo/mainDemo/demo fixtures sin coincidencias. No marcar Main final listo hasta completar esta retirada.

### Verificación de demo temporal

- CI=true npm test -- --watchAll=false --runInBand --testMatch **/Main.test.tsx **/MainDemo.test.tsx **/WorkspaceHeader.test.tsx: 9 passed, 3 suites, exit 0. Pruebas: interactions no modifican Account/GEX/Terminal stores, salida a cuenta real, pérdida visible, suma ficticia consistente y rangos cambian número de sesiones; cabecera demo sin saldo/buscador real.
- git diff --check: exit 0. CUA: apps/browsers vacíos; QA visual pendiente. Build/review/HTTP se registran al terminar.

- Build final Dev CI=true: exit 0, Compiled successfully, main.2d748727.js y main.0e9f3fcb.css. Enlace localhost:3039/?main=demo y JS: HTTP 200, index apunta asset correcto; servidor loopback PID 29372, dev/.local/main-demo-build.
- Review independiente APPROVE para recorte temporal, 0 BLOCKER/0 MAJOR/1 MINOR: ../reviews/GC-0011-main-demo-20261009-codex.md. Minor no bloqueante: hover de punto de gráfico sólo mouse; no se afirma control táctil/teclado de cada punto. Períodos sí accesibles. QA visual pendiente.
- Demo no usa datos reales ni muta stores; App continúa las lecturas reales existentes para poder volver a cuenta. Los detalles demo permanecen dentro del prototipo, no enrutan posiciones ficticias hacia vistas reales. Cuenta real sigue disponible sin query o mediante Ver cuenta real.

## Iteración visual compacta — feedback owner 09/10/2026

Owner pide una sola marca demo discreta, sin microtextos/encabezados redundantes; capital/curva compactos, P&L diario explícito, tres avisos completos, posiciones vinculadas a proyectos de estrategia y watchlist derecha. Se reemplaza layout de demo sin alturas fijas/scroll vertical interno; todo el contenido crece visible. Cabecera global oculta sólo en demo, fixtures siguen aislados. Estrategias como workspaces/sesiones quedan para otra iteración. Se aplica excepción visual de ENGINEERING §12: preview/build necesario, sin suites/review por este ajuste. Retirada obligatoria de mocks vigente.

- Preview ágil: launcher local dev/.local/start-visual-preview.ps1 usa API/Supabase Dev explícitos y HOST loopback. CRA inicial falló allowedHosts por proxy heredado a producción con host loopback; se retira proxy de package.json (sólo servidor dev; build no lo usa). Todas las consultas mantienen REACT_APP_API_BASE_URL explícita. Sin desactivar validación de host.

- Preview CRA loopback: Compiled successfully, webpack compiled successfully, No issues found. Bundle HTTP 200, contiene P&L hoy y SPY Income. Primera petición index durante compilación expiró; repetición tras compilar HTTP 200. Tests ajustados a rótulos nuevos sin ejecutarlos, sin review por esta iteración visual (excepción owner ENGINEERING §12).
- Cabecera de demo retirada; única marca Datos demo compacta. Sin alturas fijas ni overflow vertical interno. A anchos pequeños se apila y permite scroll de página para no ocultar contenido; tablas admiten desplazamiento horizontal sólo si no caben. No se afirma QA visual automatizada por navegador no conectado.


## Recorrido por estrategia — 09/10/2026

Owner confirma recuperar FRONT-GALECORE-INTEGRAL §§2, 7 y 14: Main → estrategia activa → posiciones → conversación contextual. Se modifica sólo el prototipo MainDemo, conservando separación real/Main y trabajo/Lab. Aceptación local: lista compacta con estado, resultado diario/abierto, posición y vencimiento; expandir posiciones; título abre listado, nombre abre workspace con Posiciones/Conversación/Actividad; borradores y consultas independientes por proyecto al volver a Main. Watchlist navega al contexto Mercado con estrategias vinculadas. Cuenta abre detalle demo. Agenda contiene eventos fechados; hallazgos muestran objeto afectado, evidencia y revisión.

Fuera de alcance: sesión persistente del harness, respuesta AI, datos reales/atribución real, ejecución, órdenes, contratos API. Conversación guarda consultas en estado local y declara integración pendiente después de guardar; no fabrica respuestas del harness. Retirada obligatoria de mocks vigente.

- Verificación proporcional: CI=true npm test -- --watchAll=false --runInBand --testMatch **/MainDemo.test.tsx: 3 passed, 1 suite, exit 0. Casos: aislamiento Account/GEX/Terminal, contexto de Mercado; expansión y preservación/separación de borradores entre estrategias; guardar consulta sin respuesta ficticia; hallazgo abre evidencia/conversación y conserva pérdidas/períodos.
- Preview CRA: Compiled successfully / No issues found. HTTP localhost:3039/?main=demo: 200. Sin build de producción por excepción visual ENGINEERING §12. CUA apps/browsers vacíos: QA visual pendiente.

- Review independiente acotado: 2 P2/1 P3, corregidos por implementer sin recheck: ../reviews/GC-0011-strategy-workspace-20261009-codex.md. Se quita etiqueta cuenta real en mocks, se conserva timestamp de cada hallazgo y CTA se llama Abrir workspace. Sin APPROVE inferido ni cierre.


## Demo integral Monitor / Operativa / Lab — 09/10/2026

Owner autoriza poblar TODO el front con mocks temporales para iterar como una sesión de trabajo activa; pide retirar frases de presentación. Continúa excepción de trabajo con Codex, sin tests ni build separado.

- Demo integral activa por defecto sólo en localhost; ?demo=off o «Salir de la demo» muestra las vistas reales. Selector de demo visible y exclusivo en local. Autenticación existente conservada.
- Se reutilizan MainDemo y fixtures; WorkspaceDemo agrega Operativa con posiciones/órdenes/revisión local, Lab con conversaciones y respuestas predefinidas rotuladas, SHADOW, agentes/tareas, biblioteca y configuración ficticia. Todos los efectos demo son useState; no invocan servicios, no escriben stores ni DB. App conserva sus lecturas reales de inicio, pero vistas operacionales, alertas y terminal reales no se montan en demo.
- Selector global conserva el último destino de cada espacio; datos ficticios identificados en una barra común. Los cambios de demo se pierden al recargar.
- Evidencia ejecutada: servidor CRA :3039 devolvió estado WebSocket ok después de los cambios; no se corrieron tests ni build de producción. QA visual pendiente por navegador no conectado; no se declara validación visual.

### Retirada obligatoria ampliada

- [ ] Antes de consolidar con datos reales: borrar WorkspaceDemo.tsx, WorkspaceDemo.fixture.ts, WorkspaceDemo.css, MainDemo.tsx, MainDemo.fixture.ts, MainDemo.css y tests exclusivos de mocks; retirar imports, flags locales, barra/selector demo, ramas de render y props demo de App/Main/WorkspaceHeader. Reemplazar únicamente las composiciones aprobadas con contratos reales. Buscar WorkspaceDemo, MainDemo, mainDemo y fixtures demo para confirmar que no queden referencias. No cambiar estados de aprobación/cierre por esta exploración.

### Para continuar la iteración visual

Abrir localhost:3039 y recargar. Recorrer Monitor → Operativa → Lab; ejemplos incluyen selección de posiciones, pausa local de entradas, revisión ficticia de orden, conversación predefinida, filtros de SHADOW, on/off de agentes, documentos y edición de perfil demo. Próximo paso: feedback del owner sobre distribución y densidad. Los tests anteriores en este archivo son históricos; no validan esta versión nueva.


## Recuperación de la sesión interrumpida — 10/10/2026

Último pedido recuperado del registro local: retirar mocks de Lab y usar los CLIs locales Codex/Claude con proyectos y memoria reales. Monitor/Operativa conservan la demo visual. No corresponde a WS-0021 ni retoma su implementación pendiente de Claude Code.

- Código existente: Lab.tsx/xterm, api/lab.ts y tools/terminal/lab-server.js. Proyectos desde knowledge; sesiones separadas del socket; historial local de metadatos; contexto con archivos/commits. Preparar guardado pega un pedido revisable, no confirma un commit por sí solo.
- Comprobado en esta recuperación: HTTP 200 en front :3039, Swagger Dev :7001, bootstrap y state del Lab :8771; state informa ambos motores instalados, 3 proyectos y 2 sesiones terminadas. Sin iniciar ni escribir en sesiones ni modificar estrategias.
- Ajustes sólo de presentación: texto secundario de demo/Lab con mínimo de 12 px, paneles y barra demo permiten envolver, encabezado conserva selector y perfil a <=500 px. No cambian contratos, ejecución ni guardado.
- Última compilación previa encontrada en visual-preview.stdout.log: Compiled successfully / No issues found. Edición actual: recarga CRA Compiled successfully / No issues found; preview HTTP 200 y git diff --check limpio.
- CUA sin browsers; IAB no disponible. QA visual no ejecutada. Reviews/tests históricos no cubren el puente nuevo. No se declara Lab final validado ni cierre aprobado.

Para retomar: recorrer localhost:3039, comprobar composición de Monitor/Operativa y Lab real. Pendiente funcional de consolidación del puente: revisión y caso de guardar memoria/commit/retomar, sin confundirlo con la iteración visual. Retirada de mocks Monitor/Operativa sigue pendiente antes de conectar composición final con datos reales. ACTIVE_WORK_ITEM y WS-0021 intactos.


## Lab centrado en chat — pedido owner 10/10/2026

Aceptación autorizada: proyectos personal/análisis/estrategia como workspaces con archivos/memoria/convenciones; conversaciones agrupadas a la izquierda, chat principal, Files como explorer desplegable, bootstrap mediante harness y vista Shadow del proyecto. Reutilizar strategy_design/datos/riesgo; no desarrollar WS-0021.

- UI: una columna de proyectos, nuevo proyecto/chat, borradores separados, proveedor por conversación, historial recuperable; sin terminal, memoria permanente derecha ni encabezados duplicados. Files muestra árbol y contenido de texto del workspace. Personal separado; Cartera no navega sus archivos.
- Chat real mediante salida JSON de CLIs locales, sin API keys del proveedor ni bypass de permisos. Chats/metadatos quedan en tools/terminal/.local (ignorados), documentos en knowledge. Escrituras del agente sujetas al CLI; los bloqueos de permisos se muestran, no se omiten.
- Skill del host: tools/terminal/skills/lab-strategy-bootstrap/SKILL.md; se entrega explícitamente en instrucciones del chat no personal. Coordina capacidades vigentes, no altera el catálogo ni el trabajo pendiente de GaleCore-AI. Crear carpeta no crea propuesta/aprobación; guía tesis, diseño/check/save, crítica, aprobación exacta y SHADOW Dev.
- Shadow lee project show del harness y Runtime Status/Metrics; agrega sólo presentación. Lifecycle de versión actual por hash exacto; métricas históricas por versión y cantidades de instancias visibles. Sin Deploy/Stop/órdenes desde esta UI.
- Personal creado con README.md, AGENTS.md, workspace.json y carpetas files/memory; el descriptor conserva nombre/tipo al recuperar archivos sin índice local. Ninguna estrategia existente modificada. Pruebas de chat sin herramientas ni lectura/escritura de archivos; Codex respondió y retomó realmente; Claude informó límite semanal.
- Build Dev verde y revisión independiente de una pasada, con dos hallazgos corregidos sin recheck. Evidencia permanente: ../evidence/GC-0011-lab-chat-20261010.json. QA visual y bootstrap financiero E2E pendientes; no aprobación o cierre inferidos.

### Para retomar (Lab, hito anterior)

Abrir localhost:3039 → Lab y recargar. Elegir Personal o estrategia existente; + en Proyectos crea workspace por tipo. Nuevo chat usa Codex/Claude local; Claude hoy informó límite semanal. Files abre explorer. Shadow muestra propuesta/estado y métricas sólo del proyecto. Bootstrap de estrategia queda conectado como instrucción del host, pero su recorrido financiero completo aún no fue ejecutado. Mantener mocks de Monitor/Operativa hasta su propia consolidación. WS-0021 y ACTIVE_WORK_ITEM intactos.

## UX de Monitor y Configuración — 10/10/2026

Pedido owner: continuar exclusivamente la exploración de UX/frontend; no tocar más el harness ni el trabajo pendiente de Claude. Referencias autorizadas: capturas del owner de dashboards financieros/Claude web y páginas oficiales de Robinhood, tastytrade e IBKR. Excepción visual ENGINEERING §12 vigente. No cambia contratos, catálogo, plan ni estado de aprobación.

- Monitor demo: patrimonio y curva dominante (1S/1M/3M, cursor y flechas), cuenta/distribución, tabla de estrategias y columna de watchlist/agenda/contexto. Se retiran paneles extra duplicados. P&L por sesión usa la misma serie mensual que la curva, con primera observación como base; valores de celdas redondeados y total exacto. Cuenta y poder de compra conservan distinta definición.
- Resumen y Cartera diferenciados: Resumen muestra estrategias/hallazgos/P&L por sesión; Cartera muestra estructuras, contratos, valuación, vencimientos y saldos. Drill-down vuelve al destino inicial.
- Configuración demo: General, Perfil y objetivos, Memoria y convenciones, Habilidades y conexiones, Tareas programadas. Skills/Conectores/Plugins, Tuyos/Descubrir y búsqueda sólo donde aplican; detalle Resumen/Contenido con árbol y texto/código. Catálogo y contenido explícitamente ilustrativos, sin leer ni modificar skills reales.
- Campos/estado en useState, conservados al navegar dentro de Configuración y perdidos al recargar. Tareas son propuestas locales sin scheduling. Diálogo con foco, Tab/Escape y restauración. «Abrir Lab» sólo navega, sin prometer transferir/probar una skill ficticia.
- Encabezado demo compacto y sin título global duplicado en inicio/monitor/config/admin. Vistas reales, autenticación, APIs, broker, Lab/harness y bootstrap no modificados.
- Nuevos mocks a retirar antes de consolidación: MonitorOverview.tsx/css, SettingsDemo.tsx/css/fixture/test. También modificaciones de MainDemo/WorkspaceDemo/WorkspaceHeader y sus pruebas demo. No instalar ni conectar estas propuestas como si fueran configuración real.
- Review de una pasada: ../reviews/GC-0011-monitor-settings-20261010-codex.md, CHANGES_REQUESTED. Hallazgos corregidos por implementer sin recheck; no se infiere APPROVE ni cierre.
- QA visual pendiente: CUA sin navegador disponible. La compilación y tests no certifican composición observada a distintos tamaños.

### Para retomar (vigente: UX)

Recargar http://localhost:3039 con demo local activa. Recorrer Monitor → Resumen/Cartera y Configuración → Habilidades y conexiones → una habilidad → Contenido. La demo visual conserva datos de ejemplo; salir de demo recupera vistas reales anteriores. Ajustar densidad/contraste con feedback del owner antes de conectar datos reales. Harness y skill bootstrap quedan exclusivamente para revisión posterior con Claude, ya anotada en WS-0021; esta iteración no editó ese item ni ACTIVE_WORK_ITEM. GC-0011 permanece CHANGES_REQUESTED, aprobación pendiente.

Verificación ejecutada del hito: preview CRA Compiled successfully / No issues found; MainDemo 4 pruebas verdes, SettingsDemo 2 y WorkspaceHeader 3 (corridas del área, sin suite integral). Un intento previo del nuevo caso de Cartera falló por selector ambiguo; etiqueta de retorno diferenciada y rerun verde. Comprobación de serie mensual: curva y sumatoria de P&L 1.510,80 USD. Evidencia: ../evidence/GC-0011-monitor-settings-20261010.json. Sin build de producción ni QA visual observada.
