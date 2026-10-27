# WS-0028 · Conexiones mínimas y reautenticación

Owner 13/10/2026: simplificar Conexiones a Claude Code y Codex, estado y botón Reautenticar; enviar automáticamente el comando a la terminal. Sustituye la composición amplia anterior, documentada en WS-0028-settings-connections.md como antecedente. WS-0029 sigue activo; esta continuación de interfaz fue autorizada, sin alterar su evidencia ni pruebas.

## Recorrido y límites

Configuración → Conexiones: dos filas con proveedor, estado y Reautenticar. El clic abre una terminal integrada y ejecuta directamente `claude auth login` o `codex login`, sin pedir al modelo que ejecute un prompt y sin inferencia paga. La pantalla conserva controles de actualización, cancelación y finalización necesarios. Se quitaron de esta vista las tarjetas Lab, GaleCore, bróker/Git, sus lecturas y textos auxiliares. La vinculación de bróker y fuentes continúan en sus secciones existentes.

Estado: resultado sanitizado de `claude auth status --json` / `codex login status`. Cuenta conectada significa el estado reportado por el CLI, no una inferencia acreditada ni comprobación remota de cuota/frescura. El login oficial puede requerir interacción del usuario en el navegador. No se prueban logins reales ni se cambia de cuenta como parte de QA. El terminal no guarda su salida; al terminar/cancelar se relee el estado.

El servidor vuelve a validar proveedor y usa argv fijo, sin shell ni comandos arbitrarios. Mantiene loopback, Host local, Origin exacto, máximo de cuatro terminales y una autenticación por proveedor; no toca las sesiones Lab en :8771. El entorno de autenticación no hereda claves API/tokens y usa el almacén propio del CLI.

## Verificación ejecutada

- Jest: `CI=true npm test -- --watch=false --runInBand --testMatch '**/Connections.test.tsx' '**/AuthenticationTerminal.test.tsx' --no-cache --watchman=false`: 4 passed, 2 suites. Estados/botones/comando por proveedor, fallo, cancelación, StrictMode sin doble login y cierre antes de conectar.
- Build final CI: exit 0, `main.ab200d1f.js` / `main.05b6adfc.css`. Fallo previo de BOM de PowerShell corregido; no se acredita como verde. No dependencias/lockfile modificados.
- Node: 5 tests de helper/servidor con PTY simulada; Host/Origin, proveedor inválido, argv fijo incluso con prompt ajeno, login duplicado/cierre, binario npm Windows, parser negativo y sanitización. Fuentes/tests/review están en repo workspace, rama feature/ws0028-settings-auth.
- Chromium: `node .tmp/settings-auth-qa/check.cjs`: PASS, desktop 1400×1000 y 390px sin overflow, foco, comandos y URL de socket por proveedor, terminal/cancelación/fin/relectura, error sin éxito viejo, cero errores JS. Red bloqueada, APIs y sockets explícitamente simulados; no E2E autenticado. Capturas/resultados en WS-0028-settings-auth/ y harness en .tmp/settings-auth-qa/ del workspace.
- Probe local real de sólo lectura, exit 0: ambos CLI reportaron authenticated. Artefacto sanitizado status-probe.json; no se guardaron identidades ni stdout originales.
- Review independiente: workspace docs/engineering/reviews/WS-0028-settings-auth-codex.md, CHANGES_REQUESTED original. Corregidos los hallazgos de binario npm Codex, parser negativo y EOF; tests verdes. Sin recheck ni modificación del informe.

## Para retomar

Abrir Configuración → Conexiones y elegir Reautenticar en el proveedor deseado. Completar su acceso oficial en el navegador y comprobar el estado al terminar. Pendientes: recorrido con login real y aceptación visual del owner. No VALIDATED/CLOSED, push/PR ni cambios de ACTIVE_WORK_ITEM. Verificación posterior de sólo lectura: git merge-base --is-ancestor 93eb407 local/integracion devolvió 0 y git log -1 mostró 93eb407. La implementación ya estaba integrada antes de este registro. Terminal :8770 iniciada con puerto libre, sin reiniciar otros servicios. GET real /auth/status HTTP 200: ambos proveedores authenticated; Origin ajeno HTTP 403. Bundle :3039 HTTP 200 con vista simplificada, cero errores JS en login. Artefacto live-result.json; sin E2E autenticado ni login real.
