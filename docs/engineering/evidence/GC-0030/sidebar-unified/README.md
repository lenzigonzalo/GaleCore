# Lateral única con formato de Lab — 13/10/2026

Pedido del owner: quitar la lateral duplicada en Lab, unificar la apariencia del resto con la de Lab,
quitar el logo interno de Lab y conservar el logo global. Iteración `frontend` de WS-0030 / GC-0030.
Monitor permanece en http://localhost:3039/. Sin backend, harness, archivos de proyectos, producción ni push/PR.

Cambios: App monta navegación general sólo fuera del workspace Lab; en Lab deja la barra de proyectos.
El control superior oculta/restaura la lateral correspondiente con una sola selección compartida.
Lab recibe sólo props de presentación; se retira el logo interno y el control duplicado. La vista, proyecto,
conversaciones, proveedor, borradores, polling y callbacks de envío permanecen en el mismo componente.
La navegación general adopta fondo carbón secundario, ancho 310 px, filas y selección de Lab.
Se adapta al móvil con una lateral apilada como la de Lab. Fuera del shell, Lab conserva su control standalone.

Ejecutado:
- `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/pages/LabSidebar.test.tsx src/components/layout/WorkspaceNav.test.tsx src/components/layout/WorkspaceHeader.test.tsx`: exit 0, 5 tests / 3 suites.
- `CI=true npm run build`: exit 0; artefacto build.txt.
- `python -m ruff check dev/macro_visual_smoke.py`: exit 0.
- `python dev/macro_visual_smoke.py --saved-data --sidebar-only`: exit 0; browser-run.json y PNG.
- `git diff --check`: exit 0.

Evaluado: una sola lateral en Lab y Monitor, un solo logo, formato común, control superior funcional;
ocultar/mostrar conserva borrador; no se envió ningún mensaje ni se creó chat/proyecto. Móvil 390 px sin overflow.
Los PNG fueron inspeccionados. QA en Chromium 120 con sesión Supabase sintética explícita y datos Macro reales
guardados, como en la vuelta anterior; el Lab leyó sus proyectos del puente local existente, sin modificarlo.
No se acredita login real: continúa pendiente con credencial vigente o sesión accesible al agente.
Esta vuelta aplica D-0010: cambios pequeños de presentación con tests proporcionales de la interacción compartida.
Sin nueva aprobación/cierre. El work item activo del harness se conserva; commits locales en local/integracion.
