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
- Hoy lee publicaciones existentes de supervisor/agentes, con fecha y faltantes; no llama al modelo ni inventa KPIs.
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
| Main | Catálogo dentro de Estrategias; Hoy es lectura de publicaciones reales |
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

## Arranque del preview

Se eligió compilación con configuración oficial Dev + servidor estático Python en 127.0.0.1:3040.
El intento HOST=127.0.0.1 de CRA falló por allowedHosts vacío. Auto-review rechazó HOST=0.0.0.0
por ampliar superficie de red fuera de localhost; no se pidió ampliar acceso ni se eludió el rechazo.
La alternativa sirve exclusivamente en loopback y no cambia configuración de producción ni controles de host.
La compilación usa cmd_monitor del runner oficial, reemplazando su comando npm start por npm run build,
con CI=true y MONITOR apuntando al worktree; eso conserva API y autenticación Dev sin imprimir credenciales.

## Para retomar

Rama feature/front-estructura-local; diff contra local/integracion. Primer recorte es marco integral, no watchlist.
Preview directo sin login en http://localhost:3040, con REACT_APP_LAYOUT_PREVIEW=true sólo al compilar esta copia.
El owner pidió ver el diseño sin autenticarse (Failed to fetch reportado; no se diagnosticó el origen de ese fallo).
LayoutPreview no monta AuthenticatedApp ni las vistas operacionales: composición con vacíos rotulados,
sin consultas a cuenta/API, sesiones de modelo ni acciones financieras. No se creó usuario demo ni se cambiaron permisos.
Con flag ausente el front conserva autenticación/vistas reales. La preview usa 127.0.0.1:3040 y build Dev, HTTP 200.
Build final preview: exit 0, Compiled successfully, bundle main.dfb4b555.js servido por el monitor estático.
Mirar navegación, jerarquía, espacio del centro y cuenta/conversación. QA visual pendiente antes de aprobar.
Continuar afinando Hoy/Estrategias y el contenido de cada vista; watchlist lateral viene después del marco.
No integrar ni marcar VALIDATED/CLOSED sin review y aprobación del owner. No push/PR de GaleCore.
