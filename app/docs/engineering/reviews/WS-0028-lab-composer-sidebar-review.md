# WS-0028 — Review de caja compacta y sidebar ajustable

Fecha: 12/10/2026. Reviewer independiente: Codex / Sol 6.1, solicitado por el owner. Una pasada estática del diff; no es review Sonnet ni aceptación/cierre del work item.

## Alcance e identidad

Worktree: `.worktrees/galecore/WS-0028`. HEAD/base: `9807f557a9e87bd408dfcd8fa29877a31b4a91a9`. Árbol sin commit: cinco archivos modificados, 107 inserciones y 19 eliminaciones al iniciar la lectura:

- `source/galecore-monitor/src/pages/Lab.tsx`: blob `231942f2ac58219e8821d879982db56815780777`.
- `source/galecore-monitor/src/pages/Lab.css`: blob `5d0f3f753767556ac6d022bae667c797ebef2202`.
- `source/galecore-monitor/src/components/lab/LabChatSettings.tsx`: blob `7f5dc5cea3b398b1e00f5d0c29aebdaa4f745c17`.
- `docs/engineering/evidence/lab-composer-qa/check.cjs`: blob `967dac0c4badf18627d54bd1f75c2dd16c73165e`.
- `docs/engineering/evidence/WS-0028-lab-composer.md`: contrato y registro de esta iteración, leído completo; la sección final documenta el feedback explícito del owner que reemplaza las dos líneas iniciales.

Contexto de trabajo: ENGINEERING.md y CLAUDE.md ya leídos en la revisión anterior. Esta pasada cubre únicamente la nueva iteración desde el HEAD indicado y no modifica el review anterior.

**Resultado: APPROVE del diff en revisión estática. Sin hallazgos bloqueantes.** Build y QA final están en curso por el implementer; este resultado no acredita su ejecución ni autoriza VALIDATED/CLOSED, integración o producción por sí mismo.

## Evaluación

- Caja: una línea inicial (`rows=1`, mínimo 28 px), máximo de seis (168 px), barra única, tipografía de entrada conservada en 16 px y lectura conservada. Settings sale del flujo normal, por lo que abrirlo no aumenta la altura de la caja. El atajo conserva descripción accesible y tooltip. El observer de autoheight existente responde al ancho del textarea, incluido el cambio del sidebar.
- Drag y captura: sólo el botón principal inicia captura; movimiento sólo aplica con captura del mismo pointer; pointerup la libera. La captura nativa permite seguir arrastrando fuera del área del separador y el navegador la libera por cancelación de pointer. La posición se calcula respecto del workspace, evitando asumir que su borde izquierdo sea cero.
- Límites: la única función de clamp se reutiliza en inicialización, drag, teclado, reset, resize de ventana y máximo ARIA. En escritorio limita 200–480 px y reserva 420 px al chat cuando hay ese espacio. Los límites no dependen del tamaño previo del sidebar.
- Teclado/ARIA: separador enfocable con nombre, orientación vertical, valores mínimo/máximo/actual y referencia al sidebar. Flechas, Shift+flecha y Home/End previenen el desplazamiento de la página y aplican el mismo clamp. Doble clic restablece el ancho predeterminado dentro de los límites disponibles. Foco visible por CSS.
- Persistencia: lectura inicial valida finitud y mínimo del valor almacenado; el clamp aplica el máximo. La escritura está encapsulada en try/catch, por lo que storage no disponible permite usarlo en la sesión. Colapsar no reemplaza el ancho elegido por 64 px; ese ancho pertenece a CSS. Reducir la ventana en escritorio puede ajustar y persistir un ancho menor; no se implementa una segunda preferencia independiente del ancho aplicado, lo cual no bloquea el contrato de esta iteración.
- Responsive: hasta 700 px el separador se oculta por CSS y deja de estar en la navegación de teclado. Se mantienen las columnas/adaptación móvil previas y el apilado a 480 px. En móvil el control de settings queda como icono con nombre accesible explícito. El panel permite scroll propio y se acota al 40vh; la caja sigue usando ancho relativo con máximo.
- Panel: conserva disclosure nativo `details/summary` y la navegación de teclado del navegador; input/select mantienen sus labels y bloqueo previo. No se presenta como diálogo modal ni necesita trap de foco. La posición absoluta es relativa a la caja. No cambia selección efectiva de modelos, llamadas al backend ni contratos del Lab.
- Alcance: todos los cambios de implementación trazan al feedback de caja compacta y lateral ajustable. No se observan cambios de datos financieros, permisos, inferencias, puente ni WS-0029.

## Evidencia y límites

Se ejecutaron únicamente lecturas, `git status --short`, `git rev-parse HEAD`, `git diff --stat`, `git diff` y `git hash-object`. No se ejecutaron tests, build, navegador ni control de procesos; tampoco se editó implementación ni work item.

El guion ampliado contiene assertions de altura <=100 px, letra conservada, drag, teclado, límites, escritura de preferencia en localStorage, colapsar/reabrir, reset y settings sin agrandar caja. Su lectura no demuestra que pasen. La assertion de persistencia comprueba escritura, pero no una recarga/remount; la restauración existe en el código. El guion no agrega escenarios de cancelación del pointer ni recorrido del panel por teclado en móvil. Son límites de evidencia, sin bug confirmado en esta pasada.

La entrega debe enlazar los resultados y capturas finales realmente ejecutados por el implementer, distinguir aislamiento de QA autenticada y conservar la aprobación/cierre en manos del owner.