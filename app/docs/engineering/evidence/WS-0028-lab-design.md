# WS-0028 · Ficha de diseño en el Lab

Continuación autorizada por el owner («Y dale», 12/10/2026) de U-29/U-52, BL-005 y el handoff de artefactos. WS-0029 sigue activo bajo Claude; WS-0028 conserva su pausa formal. Este registro documenta la tajada autorizada, no cambia el plan ni aprueba un cierre.

## Alcance y aceptación

Diseño muestra la propuesta canónica del proyecto: hipótesis, nueve bloques de reglas, parámetros declarados en reglas, decisiones, pendientes y limitaciones. Distingue propuesta/aprobación SHADOW Dev; informa cuando existen versiones posteriores sin aprobar. El endpoint existente selecciona la última aprobada o, si no existe, la última propuesta. La ficha respeta esa elección y la declara. No infiere reglas del chat ni evalúa rentabilidad/completitud.

«Trabajar en chat» prepara texto editable con la referencia y regla, conservando el borrador del chat seleccionado. No envía, guarda versiones, aprueba ni despliega. Si el texto supera 12000 caracteres conserva el borrador entero y explica cómo continuar. Diseño no consulta runtime ni usa modelo. Edición directa estructurada, selector de versión posterior y sincronización automática durante una respuesta quedan fuera de esta tajada: la ficha relee al volver o actualizar.

Negativos: propuesta ausente muestra un inicio útil; integridad fallida oculta ficha; un fallo del runtime no afecta Diseño; cambiar proyecto no arrastra su borrador. Valores/unidades son texto canónico de las reglas, no una exposición del contrato estructurado Parameter.

## Evidencia ejecutada

- Lectura real de `python -B -m galecore_ai.adapters.cli project show strategy:tlt_put_spread_simple_30_45d`, PYTHONPATH local GaleCore-AI/src, exit 0. Snapshot sin credenciales: `lab-composer-qa/design-real.json`; fecha de aprobación interna conservada. Sin modelo ni escrituras financieras.
- `node docs/engineering/evidence/lab-composer-qa/check.cjs` desde el workspace usando la ruta del worktree: Chromium real monta Lab/WorkspaceHeader, red bloqueada y APIs sustituidas. Casos con snapshot real: todas las reglas exactas, referencia en mensaje, borrador previo, límite 12000, aislamiento por proyecto, ausencia, versión posterior, 390px sin overflow e integridad fallida. Regresión de SHADOW y compositor incluida. No equivale a E2E autenticado ni lectura live del runtime. Resultado y capturas se conservan junto al harness.
- Build final `CI=true npm run build`: exit 0, `main.c371dada.js` y `main.a6120fb5.css`. `git diff --check`: exit 0. Integración local por fast-forward del commit `bba017a`, sin push/PR. Monitor :3039 responde 200 y sirve la ficha nueva; login y bundle sin errores JS, no E2E autenticado. Resultado: `lab-composer-qa/design-live-result.json`.
- Review independiente estático: `../reviews/WS-0028-lab-design-review.md`. APPROVE como insumo; P3 de codificación corregido. Límite de borrador cubierto con protección y caso negativo. No recheck ni estado VALIDATED/CLOSED.

## Para retomar

Abrir un proyecto de estrategia en Lab → Diseño; revisar una regla y comprobar el mensaje preparado en Chat. La ficha visual real queda disponible en el monitor integrado local. Falta validación del owner en su sesión autenticada. La próxima evolución del artifact requiere decidir edición directa y selección explícita de borradores más nuevos; no está implementada en esta tajada.
