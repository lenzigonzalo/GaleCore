# WS-0028 — Review de la primera tajada del compositor

Fecha: 12/10/2026. Reviewer independiente: Codex / Sol 6.1, solicitado por el owner para esta sesión. No es un review Sonnet ni acredita el cierre del work item.

## Alcance y estado revisado

- Modo: una pasada de revisión estática del diff sin commit y su contexto; sin editar implementación ni work item.
- Worktree: `.worktrees/galecore/WS-0028`.
- HEAD/base: `474f8f2d33f789ec15c85356caac158550891e1d`.
- Árbol inicial: modificados `source/galecore-monitor/src/index.css`, `source/galecore-monitor/src/pages/Lab.css`, `source/galecore-monitor/src/pages/Lab.tsx`; contrato no versionado `docs/engineering/evidence/WS-0028-lab-composer.md`.
- Snapshot inicialmente leído: blobs del diff `8a60b78` (index.css), `38ba353` (Lab.css), `4411875` (Lab.tsx); 60 inserciones y 16 eliminaciones.
- Contrato: `docs/engineering/evidence/WS-0028-lab-composer.md`. Contexto: `ENGINEERING.md`, `CLAUDE.md`, `LabMarkdown.tsx`, estilos completos y reset local de `@tailwindcss/forms`.

**Resultado del snapshot inicial: CHANGES_REQUESTED**, por F1. Sin otros hallazgos bloqueantes en esta pasada. Durante la emisión, el implementer aplicó una corrección y confirmó que repetirá QA/build. Este documento registra esa disposición, sin una segunda pasada ni aprobación de la corrección. `VALIDATED`/`CLOSED` y aceptación siguen siendo del owner.

## Hallazgo

### F1 — P2: autoheight no acompaña cambios de ancho

Ubicación inicial: `source/galecore-monitor/src/pages/Lab.tsx:77–84`, efecto de altura dependiente sólo de `[draft, view]`.

Con un borrador que ocupa dos o tres líneas en ancho amplio, cerrar/abrir el sidebar o cambiar 900 → 390 px modifica las líneas por wrapping sin modificar `draft` ni `view`. La altura inline permanece calculada para el ancho anterior: puede aparecer scroll interno antes de llegar a seis líneas; al ampliar, puede conservar espacio vacío de más. El límite de 168 px y `resize:none` no recalculan esa altura. Incumple la combinación de autoheight y responsive del contrato.

Reproducción propuesta para QA: escribir un párrafo que ocupe menos de seis líneas, variar viewport/sidebar sin editarlo, observar que la altura acompaña el wrapping hasta 168 px y luego conserva scroll interno.

Disposición: comunicado al implementer antes de emitir. El implementer informó corrección mediante `ResizeObserver` sensible al ancho y repetición de QA/build. Al registrar identidad del árbol se observó el cambio concurrente de Lab.tsx al blob `51240a2154ba4a6e220b31c848b2be241e05d619`; esto identifica el fix presente y no acredita una verificación independiente de su comportamiento. CSS permanecía en `8a60b78fdcff9a4c7d155ee5f0f2ace1915e834b` y `38ba353aa1a16d97dd98849a4830e179a27d9d4e`.

## Evaluación del resto del diff

- Accesibilidad: el textarea conserva nombre accesible y añade descripción del atajo; Enter/Shift+Enter mantiene protección de composición IME. La acción explícita para volver al final es un botón nativo. El foco neutral de botones, summary y tablas es consistente; input/select conservan outline y el textarea lo traslada a su superficie mediante `:has`.
- Tailwind/forms: la regla con `:root` supera el reset para outline y box-shadow; el textarea tiene una excepción más específica. El ring adicional se elimina sin quitar el indicador exterior. Esta conclusión es estática; mouse/Tab/Shift+Tab y estilo computado corresponden al QA del implementer.
- Responsive y lectura: compositor máximo de 800 px y lectura de 880 px trazan al contrato; columnas `minmax(0, 1fr)` y el apilado móvil evitan forzar ancho mínimo del contenido. Tablas conservan contenedor de scroll horizontal y tipografía. No se afirma ausencia de desborde sin inspección visual.
- Scroll/polling: la nueva referencia `followBottom` permite que el polling actualice datos sin escribir scrollTop cuando el lector se aleja del final; envío, cambio de conversación y acción explícita recuperan seguimiento. El umbral de 80 px permite seguir el final cuando se permanece cerca. Se elimina el desplazamiento suave global. Falta acreditar el caso en navegador con polling y mensajes reales/fixture identificado.
- Borradores: la clave continúa siendo `projectId + '/' + (chatId || 'new')`; el diff no modifica su almacenamiento, selección ni limpieza tras envío. No se observa mezcla introducida entre proyectos o conversaciones.
- Alcance: ajustes de caja, foco global, responsive y navegación del historial trazan al contrato. No se observan cambios de puente, modelos/esfuerzo efectivo, adjuntos, SHADOW, permisos ni operaciones financieras. El foco compartido sí alcanza otros campos del monitor; es el alcance transversal declarado en el contrato.

## Evidencia ejecutada y límites

El reviewer ejecutó lecturas de contexto, `git status --short`, `git rev-parse HEAD`, `git diff`, `git hash-object` y `git diff --check`. Este último terminó con exit code 0, sin salida. No ejecutó build, tests, automatización de navegador ni control de procesos: QA y build estaban a cargo del implementer. No se atribuyen capturas, resultados de pruebas ni aceptación que no se ejecutaron en esta revisión.

La entrega debe enlazar evidencia final de los recorridos de foco, texto largo, tabla ancha, 900/390 px, sidebar, borradores y polling, incluida F1 con el fix. El review no cambia el estado de WS-0028 ni el de WS-0029.