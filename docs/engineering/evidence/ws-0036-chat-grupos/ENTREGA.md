# WS-0036 · agrupadores del chat

Pedido del owner del 14/10/2026. Implementación limitada a la lista lateral del Lab:
`Lab.tsx` delega la lista en `components/lab/LabProjectList.tsx` y su CSS.

## Resultado

- Crear grupos sin límite artificial, editar nombre/color y plegar/desplegar.
- Tres puntos por grupo, proyecto y chat. Mover, sacar y crear un grupo desde un elemento.
- El chat agrupado muestra su proyecto de origen y lo conserva al abrirse; agrupar no llama al backend.
- Paleta de seis colores para el título del grupo y las carpetas, con color opcional por proyecto.
- Eliminar un grupo devuelve los proyectos a «Sin grupo» y los chats a su proyecto, sin borrar contenido.
- `galecore:lab:groups:v1` conserva organización y pliegue en este navegador, con tolerancia a datos inválidos
  y aviso si no se puede guardar. Los alias, archivos, mensajes y contexto real no se modifican.

## Recorrido para probar

Chat → icono «Crear grupo» junto a Proyectos → nombre y color → Crear grupo.
Tres puntos de un proyecto o chat → Mover a grupo. Flecha del grupo para plegar/desplegar.
Desde los tres puntos se puede sacar un elemento, cambiar color/nombre o eliminar sólo el grupo.

## Ejecutado y evaluado

- Tests previos del Lab y de su barra: 2 suites / 6 tests verdes.
- Tests propios de agrupadores: 1 suite / 6 tests verdes (`groups-tests.txt`). Cubren varios grupos,
  movimiento, contexto del chat, extracción, persistencia, edición, eliminación y storage inválido/no disponible.
- Build inicial: `CI=true npm run build`, exit 0, «Compiled successfully». Build final sobre `3c7baf1`,
  `CI=true node node_modules/react-scripts/bin/react-scripts.js build`, exit 0 (`build.txt`).
  El segundo comando ejecuta exactamente el script `build` de package.json. Aviso no bloqueante de Browserslist viejo.
- Suite completa: 40 suites / 178 tests verdes, exit 0 (`suite.txt`), incluidos los casos de agrupadores
  después de los ajustes de foco. Hay avisos de `act(...)` en tests de otras áreas; no fallan assertions.
- `git diff --check`: sin errores. Sin dependencias nuevas ni cambios en módulos grandes.
- Revisión independiente: `docs/engineering/reviews/ws-0036-chat-grupos-independent.md`, APPROVE sin bloqueantes.
  Un detalle menor de foco al cerrar por clic externo fue comunicado y corregido.

## Pendiente

QA visual con datos reales, escritorio y 760 px: CUA devolvió `apps: [], browsers: []`;
`createBrowserTab('iab', 'http://localhost:3039', {visible:true})` devolvió `Browser is not available: iab`.
No se generaron capturas ni se acredita el recorrido visual como ejecutado.
Aceptación del owner pendiente; WS-0036 sigue IN_PROGRESS. Sin push ni PR.
