# WS-0036 v2 — entrega del front

Rama `feature/GC-0036-panel`; worktree `C:\Users\lenzi\GaleCore-Panel-GC-0036`. Sin push.
Backend de Claude `43805b8` integrado por fast-forward desde `local/integracion`.
Commit del front: `9910141`. No hay cambios propios de backend respecto de `43805b8`.

Seguimiento SHADOW ahora abre una lista (una fila y un panel por spec); clic abre sólo esa estrategia.
Detalle: barra y filtros → cinco cifras → evolución → calendario ET → abiertas → salidas →
calidad/riesgo → régimen/versión → «Qué falta». Runtime queda plegado y carga sólo la estrategia elegida.
Los valores vienen de la API; los null son n/d y sus motivos quedan deduplicados al final.
Del perfil propio sólo se envía capital numérico USD. WorkspaceNav, App.tsx y LabShadow no cambiaron.

Build CI y npm test: exit 0; 31 suites / 118 tests ([salida](verification.txt)).
Recorrido real en :3039: demo → Lab → Configuración → Seguimiento SHADOW → spy_prima_varianza_30_45d.
[Una captura](strategy-dev.png), [respuesta real](panel-dev.json) y [pedido sin tokens](request.json).
La API Dev devolvió un día con cierres, 4 abiertas y 2 cerradas; legs se muestra como texto guardado.
Captura inspeccionada a 1536 px de ancho, página completa; Runtime permanece plegado.
Reproducir: `python docs/engineering/evidence/gc-0036-panel-v2/capture.py` con Playwright/Edge y config local Dev.

Revisión independiente: APPROVE, sin hallazgos ([review](../../reviews/WS-0036-panel-v2-codex.md)).
Fuera: navegación nueva, Eventos y rendimiento real. Pendiente aceptación del owner; sin VALIDATED/CLOSED.
