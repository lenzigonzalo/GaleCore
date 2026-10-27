# WS-0036 · arrastre y menús del chat

Seguimiento del owner (15/10/2026), limitado a `LabProjectList.{tsx,css,test.tsx}`.

## Qué cambia

- Chats y proyectos arrastrables sobre grupos abiertos/plegados y «Sin grupo».
  El destino se resalta; al soltar se abre el grupo y se persiste con el mecanismo existente.
  Sacar un chat del agrupador lo devuelve a su proyecto de origen; no cambia su contexto ni archivos.
  Cancelar o soltar archivos externos no modifica la organización. No se agrega reorden manual.
- Tres puntos y flechas visibles al pasar el mouse por su fila o al recibir foco de teclado.
  El disparador de un menú abierto sigue visible; en dispositivos sin hover los controles permanecen visibles.
- DM Sans/14 px usando los tokens compartidos, igual que el nav, incluidos Nuevo chat y los rótulos.
- Menú flotante de 220 px como máximo, con grupo y paleta de color. Se porta al body para evitar el recorte
  por el scroll lateral; se ajusta a los bordes de la ventana y se cierra al desplazar la barra o pulsar afuera.
  Recibe foco en su primer control; Tab recorre sus opciones y Escape devuelve el foco al disparador.
- Color propio de chat también persistente. Los menús de elementos no ofrecen Crear grupo ni Renombrar;
  se crean grupos únicamente desde el botón superior. El menú del agrupador conserva editar/eliminar.

## Ejecutado

- `focused.txt`: 3 suites / 16 tests verdes antes del último ajuste de entrada de foco.
- `tests.txt` y `suite-final.txt`: dos intentos de suite abortaron con `ERR_INTERNAL_ASSERTION`
  de Node 20.9.0 en `internalConnectMultiple`, después de tests ajenos al chat. No se cuentan como verdes.
  El flag CLI del segundo intento no se propagaba al proceso hijo de react-scripts.
- `suite-node-options.txt`: corrida con `CI=true` y `NODE_OPTIONS=--no-network-family-autoselection` para
  propagar la opción al proceso hijo: **40 suites / 182 tests verdes, exit 0**, incluidos los casos finales de foco/Tab.
- `build.txt` y `build-final.txt`: builds CI verdes. El sourcemap JS del segundo coincide con el TSX final,
  pero el CSS era anterior al último ajuste de tipografía; se repite en `build-completo.txt` para incluirlo.
  **Build completo final: exit 0, Compiled successfully**. `sourcemaps.txt` confirma coincidencia exacta
  de TSX y CSS compilados con los fuentes del commit `0e4578c` (normalizando saltos de línea).
- `git diff --check` sin errores sobre código. Sin dependencias ni cambios de backend.

## Evaluado / pendiente

Revisión del delta: `docs/engineering/reviews/ws-0036-chat-arrastre.md`.
Resultado APPROVE, implementación `0e4578c`.
Los hallazgos comunicados (entrada de foco del portal y tamaño de Nuevo chat) fueron corregidos;
el test del menú también comprueba entrada de foco, Tab a la paleta y Escape al disparador.
CUA volvió a devolver `apps: [], browsers: []`; QA visual/arrastre nativo en navegador pendiente,
sin capturas ni afirmación de recorrido real ejecutado. No VALIDATED/CLOSED ni aprobación del owner.

Para probar: arrastrar un chat al título de un grupo plegado; volver a «Sin grupo».
Pasar el mouse por una fila → tres puntos → grupo/color; crear un grupo sólo desde el botón superior.
