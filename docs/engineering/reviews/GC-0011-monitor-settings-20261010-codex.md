# GC-0011 — Review independiente de Monitor y Configuración

- Fecha: 2026-10-10
- Reviewer: Codex
- Modelo: `gpt-5.6-sol`
- Esfuerzo: high
- Resultado: **CHANGES_REQUESTED**
- Modalidad: una única pasada de sólo lectura; sin rechecks

## Alcance y evidencia

Se revisó el snapshot local del frontend demo en el worktree
`.worktrees/galecore/front-estructura-local`, concentrado en la composición de Monitor y Configuración:

- `MainDemo.tsx`
- `WorkspaceDemo.tsx` y `WorkspaceDemo.css`
- `WorkspaceHeader.tsx`
- `MonitorOverview.tsx` y `MonitorOverview.css`
- `SettingsDemo.tsx`, `SettingsDemo.css`, `SettingsDemo.fixture.ts` y `SettingsDemo.test.tsx`

La pasada evaluó errores de comportamiento, jerarquía de navegación, consistencia financiera de los mocks y efectos
fuera del alcance autorizado. No se modificó implementación, no se tocó el harness y no se ejecutaron suites. El
resultado de compilación y las pruebas verdes fueron informados por el implementer; no constituyen evidencia ejecutada
por este reviewer.

## Hallazgos

### 1. MAJOR — Resumen y Cartera colapsan en el mismo destino y el drill-down pierde su origen

`WorkspaceNav.tsx:25` presenta `Resumen` y `Cartera` como destinos globales distintos. Sin embargo,
`WorkspaceDemo.tsx:39` sólo traduce esos destinos a las vistas internas `main` y `account`, y `MainDemo.tsx:58` une
ambas en la misma rama que renderiza `MonitorOverview` sin diferencias de contenido.

Además, al abrir una estrategia o un símbolo desde Cartera, el único regreso ejecuta `setView('main')`
(`MainDemo.tsx:57`). El contenido vuelve a Resumen mientras la navegación lateral continúa marcando Cartera. La
jerarquía no conserva el origen del drill-down y los dos destinos dejan de representar espacios diferenciados.

### 2. MAJOR — “Probar en Lab” promete una continuidad que no existe

El detalle de una habilidad ficticia ofrece `Probar en Lab` (`SettingsDemo.tsx:64`), mientras el propio contenido
aclara que es ilustrativo y no modifica las skills existentes del harness (`SettingsDemo.tsx:66`;
`SettingsDemo.fixture.ts:1-3`). El callback sólo navega al Lab real mediante `WorkspaceDemo.tsx:60`: no pasa la
habilidad seleccionada, un proyecto ni contexto, y tampoco instala o habilita esa habilidad.

El usuario llega a un workspace genérico donde la capacidad elegida no está disponible. Esto presenta como funcional
un puente demo → Lab real que no fue implementado y que no estaba autorizado como integración con el harness.

### 3. MAJOR — Las lecturas mensuales de performance no reconcilian

En la vista predeterminada de 1M, el gráfico calcula el cambio de las últimas 20 observaciones de `demoEquity`
(`MonitorOverview.tsx:23,30,45`), que resulta en **+$1.510,80**. En la misma pantalla, el Calendario P&L
(`MonitorOverview.tsx:66`) usa `visualCalendar` (`WorkspaceDemo.fixture.ts:8`), cuyos valores suman
**+$3.417,80**.

La interfaz no presenta depósitos, retiros ni una definición alternativa del P&L que explique los **$1.907,00** de
diferencia. Dos componentes que cuentan el mismo período mensual sostienen historias financieras incompatibles.

### 4. MINOR — Plugins conserva controles activos que no afectan el contenido

El selector `Tuyos` / `Descubrir` y la búsqueda permanecen visibles en la barra común (`SettingsDemo.tsx:52`), pero
la rama de Plugins ignora ambos estados (`SettingsDemo.tsx:60`). El usuario puede activar controles que no producen
ningún cambio ni explican que no aplican a esa categoría.

### 5. MINOR — El diálogo de tareas no contenía el foco ni respondía a Escape en el snapshot revisado

El diálogo declaraba `aria-modal="true"` en `SettingsDemo.tsx:72`, pero no movía o retenía el foco y no ofrecía cierre
con Escape. Un usuario de teclado podía continuar tabulando por la página detrás del overlay y sólo cerrar al llegar al
botón Cancelar.

## Cambios posteriores fuera de la pasada

Después de emitido el informe, el implementer informó correcciones para los hallazgos 1–4. También informó un cambio
posterior de gestión de foco, Tab, Escape y restauración de foco para el hallazgo 5. Por la regla de una única pasada sin
rechecks, ninguno de esos cambios fue inspeccionado y este informe no los certifica, no retira hallazgos ni infiere
`APPROVE`.

El resultado permanece **CHANGES_REQUESTED** para el snapshot revisado. Cualquier estado posterior depende de la
evidencia y aprobación previstas en el work item; este review no marca el trabajo `VALIDATED` ni `CLOSED`.
