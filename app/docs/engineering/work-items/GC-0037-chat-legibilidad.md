---
id: GC-0037
title: Tamaño del chat y selector de modelos visible
status: READY_FOR_REVIEW
approver: user
---

Pedido directo del owner, 23/10/2026, capturas Screenshot (28) y (29). Pieza local acotada; no cambia WS-0055.
Rama: `local/chat-legibilidad`. Presupuesto estándar de ENGINEERING.md.

## Contrato

- Configuración → General → Cuenta permite elegir el tamaño de mensajes y escritura (14–22 px), persistido como preferencia privada.
- Conservar por defecto los tamaños existentes (mensajes 18 px escritorio / 16 px móvil, escritura 16 px): corrección explícita del owner durante la implementación.
- Desde el cuadro del chat, abrir el selector muestra sus opciones dentro de la ventana; teclado y cierre siguen funcionando.
- Preferencia ausente o inválida conserva el tamaño predeterminado; fallo al guardar se muestra sin afirmar éxito.
- Fuera de alcance: cambiar catálogos, autenticación de motores o acceso por suscripción. Se informa el funcionamiento observado.
- Recorrido: Cuenta → elegir tamaño → volver al chat y recargar; abrir selector al pie de la pantalla y elegir un modelo en chat nuevo.
- Verificación: tests del área, build CI, diff check y QA visual local. Revisión independiente pendiente; no se cierra sin owner.

## Hallazgo sobre modelos

`tools/terminal/lab-workspaces.js` publica `installed` desde la presencia de los binarios.
`tools/terminal/lab-models.js` ofrece alias de Claude (sonnet/opus/haiku y modelo configurado), y Codex desde `~/.codex/models_cache.json`.
El picker habilita por `installed`; no consulta el login ni acredita acceso efectivo al modelo por suscripción.

## Evidencia y para retomar

23/10/2026: implementado en local. Preferencia privada `preference/tamano-chat` con tamaños 14/16/18/20/22 y opción predeterminada sin modificar los tamaños existentes. Cambio efectivo en el chat montado y lectura desde el espacio al montar.

Selector en portal de `document.body`, posición fija dentro de la ventana; abre hacia el lado con más espacio y se reposiciona al redimensionar/desplazar. Conserva Escape, foco, navegación y cierre por clic externo.

Ejecutado en `source/galecore-monitor`:
- `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/components/lab/LabModelPicker.test.tsx src/components/settings/SettingsModal.test.tsx src/pages/SettingsConnections.test.tsx`: exit 0, 6 tests.
- Tras agregar pruebas, `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/components/lab/LabModelPicker.test.tsx src/components/settings/ChatFontSetting.test.tsx`: exit 0, 7 tests (10 únicos entre ambas corridas).
- `CI=true npm run build`: primer intento sandbox `spawn EPERM`; repetición autorizada fuera del sandbox exit 0, Compiled successfully.
- `git diff --check`: exit 0.

QA visual y recorrido real pendientes: `cua.getState()` no encontró navegadores; intento de abrir `http://localhost:3039` con `cua.createBrowserTab('iab', ...)` devolvió `Browser is not available: iab`. Los tests de geometría acreditan posición calculada y portal, no apariencia real ni persistencia de extremo a extremo.

Para retomar: comprobar Cuenta → Tamaño → chat y recarga, revisar menú en escritorio y móvil, revisión independiente y aprobación del owner. No VALIDATED/CLOSED. WS-0055 conserva su estado y pendientes propios.

23/10/2026, seguimiento: el owner reportó TS2307 sobre `ChatFontSetting`. Archivo presente, árbol limpio y `npx tsc --noEmit` exit 0. Se identificó el monitor activo en la misma carpeta y se reinició sólo su proceso Dev con `python dev/galecore_dev.py monitor`. Resultado real: `webpack compiled successfully` y `No issues found.` en `dev/.local/monitor-font-restart.stdout.log` (stderr separado en el mismo directorio). Compatible con resolución obsoleta del verificador en caliente; no requirió cambiar código. No acredita QA visual.
