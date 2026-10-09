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

Rama feature/front-estructura-local; build real Dev en http://localhost:3039; no usar 127.0.0.1 como origen.
Owner confirmó acceso/datos, pero rechazó experiencia como entrega; análisis integral en FRONT-GALECORE-INTEGRAL §26.
Watchlist derecha con resize/contraer y + usa feed/política existentes; gráfico primero en Mercado.
Búsqueda de secciones/símbolos arriba; Conversación sólo como acción, conserva sesión. Lab lista versiones cargadas
sin afirmar aprobación/ejecución; Seguimiento conserva runtime. Logo final no disponible; marca textual provisional.
Todavía faltan proyectos/dashboard, builder gráfico, decisión recuperable, biblioteca, configuración y performance.
No cerrar GC-0011: revisión anterior no cubre nuevo diff; QA visual pendiente (CUA sin navegador).
ACTIVE_WORK_ITEM sigue WS-0021; no se cambia el orden del plan ni se integra/pushea la exploración como entrega.

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
