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

Primera iteración autorizada: Gestión real separada de Trabajo/Lab (D-0006).
Main: cuenta real en franja financiera, posiciones y faltantes explícitos de historia/noticias; sin métricas o publicaciones SHADOW.
Lab: resumen SHADOW por versión, versiones cargadas y actividad; subtabs Resumen/Estrategias/Ejecuciones SHADOW.
Sidebar Gestión/Trabajo/Compartido; Mercado/Biblioteca compartidos. Asistente persiste al navegar.
Supervisor emergente SHADOW sólo en Trabajo; no se habilitaron órdenes, LIVE ni nuevos cálculos.
Preview localhost:3039 usa dev/.local/spaces-reviewed-build de este worktree al entregar; datos Dev.
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
