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

Owner rechaza la experiencia integral actual. Comparar dos composiciones Main antes de seguir aplicando cambios.
OpenDesign 0.24.1 instalado por owner; plugin open-design@open-design 0.5.3 y MCP local habilitados/stdio comprobado.
Modo elegido Local Codex; sesión CLI activa. No generación probada. Nueva tarea carga plugin/MCP; brief en FRONT-GALECORE-INTEGRAL §27.
Root ACTIVE_WORK_ITEM sigue WS-0021; GC-0011 exploración CHANGES_REQUESTED, sin cierre/review de nuevo diff ni cambio de plan.
Front actual localhost:3039, servidor loopback sirve dev/.local/main-connect-build de este worktree; datos Dev.
Vincular cuenta abre Settings en bróker y consolidó falta de vínculo; credenciales sólo en formulario, no copiar producción.
Logo elegido por owner, verde #a3d86c; asset limpio pendiente, imagegen de esta sesión produjo artefactos y no se integró.
Quedan dashboard/proyectos, builder gráfico, decisión recuperable, biblioteca/config/performance y QA visual con datos.
No integrar/pushear exploración como entrega ni marcar VALIDATED/CLOSED. Evidencia de setup al final de este item.

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

### Cambio de conversación: probar OpenDesign sin eludir SmartScreen

Owner aporta open-design.ai y repo nexu-io/open-design para mejorar revisión visual antes de implementar. Se recomienda comparar dos composiciones de Main con mismo contenido y decidir la dirección. No se instaló OpenDesign ni MCP.
Verificado instalador Descargas open-design-0.24.1-win-x64-setup.exe, 438224539 bytes: SHA256 3a544dca7a5f078029d55f272e218278e52edac55efbfb292d56258113e8a441 coincide con digest de GitHub Releases open-design-v0.24.1. Authenticode NotSigned; owner muestra SmartScreen unrecognized app/Unknown publisher. No detección de malware inferida ni ausencia certificada. Bitdefender figura en SecurityCenter; no se ejecutó análisis antivirus. Windows 11 Home, WindowsSandbox.exe ausente. No eludir advertencia ni registrar MCP mientras owner evalúa.
Código acotado antes de la consulta: estado de vinculación en Main sin cascada de error de posiciones; Vincular abre Settings initial=broker; guardar credencial pide releer cuenta. Sin copia de Supabase producción ni credenciales. Tests Main/account: 6 passed; build estándar bloqueó por EBUSY en asset servido; compilación alternativa dev/.local/main-connect-build: exit 0, Compiled successfully, main.a19a4dbf.js. Servidor 3039 apunta a ese directorio.
Logo adjunto seleccionado por owner, verde #a3d86c: dos ediciones imagegen tuvieron artefactos en wordmark; no se integran como asset final. Identidad elegida, limpieza pendiente. Main completo no rediseñado aún: propuesta de comparar diseños antes de seguir cambiando páginas.

## OpenDesign conectado — 09/10/2026

Owner instaló 0.24.1, autorizó setup Codex y eligió Local Codex. Brief de prueba A/B Main en FRONT-GALECORE-INTEGRAL §27.
- codex-cli 0.154.0. Marketplace nexu-io/open-design-agent-plugins añadido, plugin open-design@open-design 0.5.3 instalado/habilitado. No colisión ni eliminación de otros plugins/MCPs.
- App en AppData/Local/Programs/Open Design; licencia core/plugin Apache-2.0. Templates/assets no auditados ni copiados.
- GUI Electron y sidecars esperados en rutas instaladas; puertos observados ligados a 127.0.0.1. Sin firma digital; no escaneo antivirus ni garantía de ausencia de malware/otras instalaciones.
- Packaged --headless --mcp-install codex primero falló por ELECTRON_RUN_AS_NODE heredado. Segundo falló por discovery: desktop no healthy daemon. No modificación MCP en esos intentos.
- GET install-info del daemon real respondió 200. Registro con su POST /api/mcp/install/codex (operación usada por packaged/Settings) respondió ok=true. CLI get open-design verificó enabled=true/stdio, ejecutable/entry absolutos y sólo env de discovery/bootstrap/data/Electron; ningún token/key del proveedor embebido.
- Smoke real via JSON-RPC stdio: initialize -> server open-design 0.2.0; tools/list 22, resources/list 317; list_agents sin error contiene codex. codex login status exit 0, identidad/credenciales no impresas.
- Script diagnóstico dev/.local/open-design-setup/mcp-smoke.cjs (ignorado) y logs de intentos (ignorados). No generación ni billing; Local Codex explícito, no cambio a Cloud/BYOK.
- Necesita nueva tarea de Codex para cargar plugin/MCP. Estado GC-0011 sigue CHANGES_REQUESTED y no se cambia WS-0021/P1-09, plan, producción ni capital.
