# GC-0008 — Revisión interna del tema carbón

- Fecha: 2026-10-03.
- Modo: `uncommitted`, revisión completa y recheck acotado de la corrección indicada abajo.
- Base y HEAD: `99fea8f867f6b8c5268e99bd76de6661e937158f`, rama `feature/GC-0008-tema-carbon`.
- Árbol: sucio; 36 archivos tracked modificados del monitor y work item GC-0008 nuevo. El JSON Runtime `pcs_spy_16d_v1.json` es preexistente, no trackeado y queda fuera de esta entrega.
- Reviewer: subagente de revisión de esta sesión Codex, distinto del implementer. Sonnet indicado por la tabla de ENGINEERING.md no está disponible en este runtime; se declara esta limitación. No representa una revisión de otra familia de modelo.
- Alcance: todo el diff tracked contra la base, work item, variables CSS/Tailwind, legibilidad estática, navegación, semántica de colores y cambios funcionales accidentales.
- Comandos ejecutados: `git status --short`, `git rev-parse HEAD`, `git diff --stat 99fea8f`, `git diff --numstat 99fea8f`, `git diff 99fea8f -- source/galecore-monitor`, lecturas acotadas por archivo, `git diff --check 99fea8f`, búsquedas `rg` de familias tipográficas, variables y clases con modificadores de opacidad.
- Gates: el build lo ejecuta el implementer; su resultado no se atribuye a este reviewer. No se ejecutó navegador, comparación visual ni recorrido de edición con backend. La disponibilidad de navegador bloqueada fue comunicada por el implementer.

## Resultado

APPROVE para el diff de implementación inspeccionado tras la corrección, con QA visual pendiente. No autoriza VALIDATED/CLOSED ni sustituye la aprobación del owner.

## Hallazgo y recheck

**MAJOR, corregido — el menú Mi Cuenta se recortaba en pantallas de hasta 900 px.** La regla nueva `.dashboard-nav { overflow-x: auto; }` convertía el overflow vertical visible en auto; el menú absoluto de `AccountMenu.tsx`, situado debajo del nav de 52 px (`top: '100%'`), quedaba dentro de su área de recorte. Se informó al implementer sin editar la implementación. Recheck: el CSS final elimina esa regla de overflow y conserva solamente el ajuste de ancho de sidebar. El contenedor vuelve a permitir el menú por fuera de la barra. Comprobación estática; no se afirma reproducción visual.

## Comprobaciones

- El diff mantiene handlers, permisos, solicitudes, stores y reglas de trading. Las modificaciones corresponden a estilo y layout; la resolución de la fuente del gráfico es la única expresión JS nueva relacionada con el tema.
- `GexChart` final obtiene la familia con `getComputedStyle(el).getPropertyValue('--font-sans').trim()`. Es apropiado para la API canvas; el código instalado de lightweight-charts construye la fuente y la asigna a `ctx.font`, sin resolver variables CSS. La versión inicial con `var()` fue corregida por el implementer antes del resultado final de esta revisión.
- Los colores CALL/PUT permanecen en `optionSideColors.ts`; las reglas de dirección, riesgo y referencia no se invierten. El verde semántico pasa a lima y el rojo a coral sin alterar sus condiciones. Los acentos informativos existentes permanecen separados de esos estados.
- Las variables usadas por el tema y Tailwind están declaradas. No aparecen usos de clases de los colores modificados con opacidad `/...` que dependan de interpolación RGB al cambiar a `var()`.
- La paleta aumenta el contraste de texto muted respecto de la anterior; las pestañas activas tienen fondo claro y texto oscuro, y los controles reciben foco visible. Esto es evaluación estática, no certificación de accesibilidad ni de ajuste en todas las resoluciones.
- `git diff --check 99fea8f` terminó con exit 0. Git emite advertencias de acceso denegado al ignore global, sin afectar la inspección del diff.

## Limitaciones y observaciones no bloqueantes

- Sin navegador no se verifica carga efectiva de DM Sans, ajuste de títulos/tarjetas, overflow horizontal residual ni fidelidad visual frente a la referencia del owner.
- Las fuentes continúan dependiendo de Google Fonts, como antes; existe fallback Segoe UI/sans-serif.
- El work item nuevo contiene caracteres `?` en lugar de algunas letras acentuadas en el contenido leído; conviene corregir su codificación antes de la entrega documental. No afecta al frontend.
- Existen usos preexistentes de `var(--green-gc)` en AccountPositionsList, sin declaración en index.css. No los introdujo este cambio y no se exige expandir el alcance para corregirlos.
