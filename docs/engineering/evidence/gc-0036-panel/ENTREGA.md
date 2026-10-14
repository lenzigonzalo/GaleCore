# WS-0036 tajada 1 — entrega local

14/10/2026. Rama `feature/GC-0036-panel`, desde `local/integracion` (`456dee0`).
Worktree: `C:\Users\lenzi\GaleCore-Panel-GC-0036`. Sin push, PR ni merge.

Commits de código:
- `a94b2f7`: panel, cliente/tipos, selector y filtros, fixtures y tests.
- `65d3b95`: compatibilidad Jest con ESM/CSS y actualización de tests antiguos del monitor.
- `0c4ca18`: stub de autenticación compatible con resetMocks de CRA.
- `a9bf569`: panel independiente del refresco antiguo y estilos del gráfico acotados.

Quedó: encabezado SHADOW, resultado/curva/caída/referencias, calidad, riesgo,
regímenes/reglas/versiones, hipótesis y ejecución. Filtros por versión y período UTC.
El front muestra valores de la API; los Metric nulos muestran reason (vacío: «sin dato»).
Del perfil propio sólo se envía referenceCapital numérico en USD. Sin defaults,
parseo de risk_limits ni envío de tasas/límites/criterio de hipótesis.
WorkspaceNav.tsx, App.tsx y LabShadow.tsx no tienen cambios.

Verificación ejecutada: `CI=true npm run build` y `CI=true npm test -- --watchAll=false --runInBand`:
exit 0; 30 suites y 113 tests. Resumen literal: [verification.txt](verification.txt).
Los dos fixtures son copias de gc-0033-panel; el ilustrativo sólo se usa en tests.
Se corrigieron fallos previos de la suite: transformación de dependencias ESM y mapas de exports,
ResizeObserver en el test de Lab, el escenario de error de LabShadow y el test placeholder de CRA.

Recorrido ejecutado en Edge/Playwright, monitor iniciado con `python dev/galecore_dev.py monitor`
en :3039 contra Dev: login demo → Lab → Configuración → barra Lab / Seguimiento SHADOW →
`spy_prima_varianza_30_45d`. Este acceso hace visible la barra existente: el Lab de proyectos
oculta WorkspaceNav; también existe la entrada del proyecto Shadow / Abrir seguimiento completo.
No se cambió esa navegación. Se cerró el popup global de Avisos para las capturas.

Datos reales: [panel-dev.json](panel-dev.json), respuesta HTTP 200 del navegador;
[panel-ui-request.json](panel-ui-request.json) registra URL y status, sin tokens.
2 cerradas / 4 abiertas. El capital USD procede del perfil real; no se enviaron límites ni tasas.
Capturas inspeccionadas: [encabezado](panel-dev.png), [resultado](panel-dev-resultado.png),
[calidad](panel-dev-calidad.png), [riesgo](panel-dev-riesgo.png), [regímenes](panel-dev-regimen.png),
[hipótesis](panel-dev-hipotesis.png), [ejecución](panel-dev-ejecucion.png).
Reproducción: `python docs/engineering/evidence/gc-0036-panel/capture.py` (requiere Playwright/Edge
instalados y dev/.local/env.json de Dev; no guarda ni imprime contraseñas).

Hallazgos corregidos al verificar: los estilos de tablas quedaron restringidos a las tablas de datos
para no afectar las internas de lightweight-charts; el canvas tiene altura fija. Un timeout del
seguimiento antiguo ya no desmonta el panel ni descarta su respuesta válida; hay test de regresión.
El runtime antiguo sigue pudiendo mostrar su propio timeout y reintentar a los 30 s.
La contraseña local vigente se recuperó del worktree WS-0019: login HTTP 200. Se restauró sólo el
campo demo_password en las configuraciones locales del worktree y checkout base (ignoradas por git).
No se cambió la cuenta de Auth. La automatización nativa no pudo arrancar su helper; se usó Playwright.

Fuera: Eventos (sin API), navegación nueva, rendimiento real, cambios de backend/perfil.
Los límites/tasas/criterios que faltan se muestran con los motivos de la API.
Pendiente: revisión de Claude/reviewer y aceptación del owner. No se marcó VALIDATED ni CLOSED.
