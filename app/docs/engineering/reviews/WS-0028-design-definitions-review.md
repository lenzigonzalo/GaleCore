# WS-0028 — Review independiente de Diseño por definiciones

Fecha: 13/10/2026. Reviewer: Codex / Sol 6.1, solicitado por el owner. Una pasada estática; sin revisión Sonnet ni aceptación/cierre del item.

## Alcance y estado

Revisión de diffs sin commit y contexto en tres worktrees:

- Frontend `.worktrees/galecore/WS-0028`, HEAD `5c23087678c7737a96d6f0fc583c4e6f96f2ac76`: nueve archivos modificados al iniciar, 161 inserciones y 85 eliminaciones. Snapshot inicial incluye `LabStrategySheet.tsx` blob `720af35`, `LabShadow.tsx` `5f09bec`, App `d91b881`, WorkspaceHeader `a100c0e`, AccountMenu `660d053`, LiveWatchlist `d179b20`, LiveWatchlist.css `ebddfda`, index.css `8a60b78` y el diff Lab.css de definiciones.
- Harness `.worktrees/galecore-ai/WS-0028-design`, HEAD `6225b85ad1bd7c67b9a47d08f29008c8aad10df4`: `application/project.py` blob `9bd42249fb70eefff069dd7739a240f47fc225f3`, `adapters/cli.py` `2075dbd73547b0a324d980bc0ead8b7aa1536226`; test nuevo `test_project_design.py` leído.
- Puente `.worktrees/workspace/WS-0028-view`, HEAD `d25e89dcedb48eb4c23bb3969d6ad7f947a677e1`: `tools/terminal/lab-workspaces.js` blob `7ea60646547721a76fff15398bca539748028a36`; test nuevo `lab-strategy-read.test.js` leído.

Alcance autorizado: ficha de definiciones sin botones de chat, parámetros/gestión/evaluación/controles existentes, ausencia explícita de datos, origen GaleCore y lectura más rápida sin modelo ni cálculos financieros. Steering adicional: encabezado común, barra derecha transversal y cuenta abajo a la derecha. Contexto ENGINEERING/CLAUDE ya leído; snapshot real `.tmp/design-iwm.json` inspeccionado sin tratar sus cifras como mercado actual. Se contrastaron contratos/selección, FileStrategyStore, controls.classify y origen de candidatos en RuntimeMarketData/CreditSpreadCandidateBuilder.

**Resultado sobre snapshot inicial: CHANGES_REQUESTED por F1 y F2, ambos P2; F3 es P3.** Hallazgos comunicados al implementer antes de emitir. Durante registro de hashes se detectaron ediciones concurrentes en la ficha y CSS; no constituyen una segunda pasada ni validación independiente de los fixes. Los estados VALIDATED/CLOSED y aceptación siguen siendo del owner.

## Hallazgos

### F1 — P2: omisión de definiciones existentes de captura e inputs del owner

La nueva ficha recibe pero no renderiza `hypothesis.capture` ni `evaluation_plan.owner_inputs`. La captura era visible en la ficha anterior. El snapshot real de IWM tiene una captura explícita y tres inputs del owner; la nueva proyección backend conserva esos campos completos. La UI presenta hipótesis/objetivo y plan de evaluación, pero estos datos desaparecen de la lectura.

Corregir mostrando cómo se captura la hipótesis y los inputs/decisiones exigidos por el plan, respetando su contenido guardado y declarando ausencia cuando corresponda. No deducirlos de reglas ni inventar una respuesta.

### F2 — P2: mover cuenta al dock altera el botón de contraseña

AccountMenu monta Modal y MyPasswordCard inline, sin portal, como descendientes de `.lw-tools`. La regla existente `.lw-tools button` impone `display:grid`, `width:37px` y `height:40px` a todos los botones descendientes. El nuevo override cubre sólo `[role="menu"]`; el submit «Cambiar contraseña» de MyPasswordCard, con clase btn e inline únicamente alignSelf, sigue recibiendo las medidas de botón de icono. El texto/formulario queda comprimido después de este cambio transversal.

Acotar el selector a los botones propios del dock o aislar el modal. Verificar abrir «Mi contraseña» sin enviar cambios: submit con ancho de texto y cierre visible. No hace falta tocar credenciales para comprobarlo.

### F3 — P3: token de aviso inexistente

Lab.css usa `var(--warning)` para `.lab-design-attention` y el borde de `.lab-design-warning`. No se encontró definición de ese token en el CSS del monitor leído; el token semántico existente es `--yellow-gc`. Sin fallback el color queda inválido y el borde pierde la presentación prevista. Reutilizar el token existente.

## Evaluación del resto

- Integridad/versiones: strategy_design_view reutiliza `_versions` y selección aprobada/latest; FileStrategyStore verifica contratos, content_hash y correspondencia de referencia. Añade comprobación del spec_hash aprobado contra el documento seleccionado, crítica verificada y log seguro. Los daños se declaran en integrity_failed y el frontend bloquea la ficha. No se escriben ni modifican propuestas/aprobaciones. Ref, spec_hash y fecha se conservan en procedencia; las propuestas posteriores no se presentan como aprobadas.
- Datos del método: parameters, management, evaluation_plan, crítica y reglas provienen del model_dump real, no de generación. Los campos parámetros existentes se muestran completos (valor/unidad/rango/dependencias/fundamento/fuentes/reglas). Las tablas no suman ni recalculan métricas financieras. `closed_trade_review` se trata como string. F1 registra dos omisiones concretas del render, sin afirmar completitud de todos los campos de la spec.
- Origen: runtime_sources es inventario separado de implementación, con rutas de dispatcher y advertencia de que no acredita disponibilidad en vivo ni todas las reglas. Cadenas, deltas vía GammaExposure y quotes coinciden con las dependencias leídas del constructor real de candidatos. La ficha declara explícitamente inventario incompleto, mercado/plaza ausente y campos estructurados legacy faltantes; no modifica retroactivamente la propuesta para completar esos vacíos.
- Lectura rápida: project design lee versiones/log/crítica local y clasificación determinista; omite graph de research, feedback, followup y resolve_ref. No solicita modelo ni mercado. Diseño llama su endpoint con `?view=design` y mantiene guard `mode==='shadow'` para las APIs runtime. No envía mensajes, aprueba ni despliega.
- Cache: fingerprint de nombres y bytes de proposals/approvals/critiques y log detecta cambios aunque tamaño/mtime coincidan. Entradas por strategyName coalescen solicitudes iguales. El fingerprint se vuelve a comprobar tras el subprocess; una lectura con archivos cambiados rechaza con 409. Una promesa rechazada elimina sólo su propia entrada, evitando que borre una lectura posterior. Cambio/borrado de archivos invalida cache en el siguiente request. No hay cache temporal que publique un resultado bajo fingerprint diferente.
- Barra/header: elimina la variante compacta Lab del mode bar y muestra StatusBar en los tres modos. El dock se mantiene montado transversalmente, reserva espacio y mueve cuenta al fondo. La carga de reglas de watchlist se difiere hasta abrirla; las suscripciones extra conservan dueño/cleanup existentes, ahora con enabled transversal. F2 cubre el efecto CSS confirmado sobre cuenta.
- Accesibilidad/responsive: se conservan disclosures nativos y regiones de tablas enfocados por teclado, scroll horizontal propio y grids móviles. Los avisos de faltantes son texto legible aunque F3 afecta su color/borde. QA visual del header/barra/cuenta y anchos reales permanece a cargo del implementer.

## Evidencia y límites

El reviewer ejecutó sólo lecturas, git status/rev-parse/diff/stat/hash-object y búsquedas de contexto. No ejecutó tests, build, navegador, red, scripts de QA ni control de procesos; no editó implementación, items o informes anteriores. Los tests leídos cubren lectura local completa, daño de documento/crítica, cache por bytes, coalescing, retry/race y separación entre proyectos; su lectura no acredita PASS ni reemplaza pruebas reales.

Al registrar identidad final se observó la ficha en blob `9e30ed5fddb16ae58605ed49dc1e59e6f7263c16`, Lab.css `50b05c99c8db8d9db7399eb0fe2c3638ad1d118a` y LiveWatchlist.css `63bf4cd374c818369d4e825f7f1753124f3b8c8b`, distintos del snapshot inicial. Se informa sólo la existencia de edición concurrente. El implementer debe registrar disposición de F1/F2/F3, resultados realmente ejecutados y límites de evidencia, sin editar este review ni presentar sus fixes como recheck independiente.