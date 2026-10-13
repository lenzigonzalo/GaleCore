# WS-0028 · Configuración: conexiones primero

Owner 13/10/2026: «Armalo en el front dale», después de repasar primer acceso, autenticación Claude/Codex, Git y APIs. Continuación acotada de P1-10/U-57 autorizada; WS-0029 continúa activo y WS-0028 mantiene su pausa formal. No modifica el harness, sus pruebas, permisos ni el puente.

## Contrato y recorrido

Entrada: Monitor o Lab → Configuración → Conexiones. Mostrar dependencias reales antes de pedir una consulta: proveedor instalado, acceso al Lab, lectura del espacio GaleCore, cuenta de bróker vinculada e historial local. Reintentar sin conservar éxito obsoleto. Navegar al formulario real de bróker, fuentes y Lab. Conservar perfil, objetivos, convenciones, memoria, métodos, agentes y cuenta.

Negativo: Lab caído no oculta el acceso a GaleCore; bróker vinculado no se presenta como credencial válida; ejecutable instalado no se presenta como sesión autenticada; lectura de Git no acredita nueva escritura ni respaldo remoto. Sin secretos en logs, almacenamiento del navegador o chats.

Fuera de alcance: endpoints nuevos de autenticación, login iniciado desde el navegador, inferencias pagas, reconfiguración de servicios, sincronización remota, fuentes nuevas y órdenes. La reautenticación es una guía desplegable con copia del comando verificado en la ayuda del CLI instalado (`claude auth login` / `codex login`). Se indica explícitamente que se ejecuta en la terminal del equipo y que el front no comprueba esa sesión.

## Implementación

- `Settings` abre Conexiones; navegación por Empezar, Mi trading, Conocimiento, Cuenta y equipo. Tema/tipografía compartidos, selección clara, lectura y responsive.
- `Connections`: sólo GET a `/state`, `/projects/portfolio`, espacio y cuenta de bróker. Comprobaciones independientes, marca de hora, reintento; sin tocar sesiones.
- `App`: acceso a Configuración con el nuevo default y retorno al Lab.
- Git explicado como historial local; no se exige cuenta GitHub ni se añade una conexión falsa.

## Verificación

- Jest: `CI=true npm test -- --watch=false --runInBand --testMatch '**/Connections.test.tsx' --no-cache --watchman=false`: **2 passed**, 1 suite. Comprobaciones de estados honestos, navegación, guía sin crear sesiones y reintento con fallas independientes. Primeros intentos con `--runTestsByPath` no detectaron archivos; `--showConfig` mostró el patrón Windows mixto antes de `.worktrees`. No se cuentan como pruebas pasadas.
- Chromium aislado: `node .tmp/settings-qa/check.cjs`, **PASS**. Desktop 1500×1100, móvil 390×900 sin overflow; guía, foco y Tab/Shift+Tab, navegación bróker/Lab, fallas/reintento, cero errores JS. APIs simuladas explícitamente y red bloqueada: **no E2E autenticado**. Mock de bróker sin escrituras.
- Capturas observadas: `.tmp/settings-qa/desktop.png`, `auth-guide.png`, `mobile.png`, `offline.png`; resultado `.tmp/settings-qa/result.json`. Copia permanente de capturas/resultado en `WS-0028-settings-connections/` junto a este archivo.
- Build aislado CI: ambas compilaciones exit 0; final `main.256193a3.js` / `main.8e6d738b.css` después del ajuste explícito de foco. Sin instalar dependencias ni cambiar lockfile; junction a dependencias existentes.
- Integración local por fast-forward del commit `0841b9b`. Monitor :3039 sirve el bundle nuevo: `node .tmp/settings-qa/check-live.cjs`, exit 0, HTTP 200, componentes presentes y cero errores JS en login. No E2E autenticado. Primer chequeo del bundle falló por comparar literalmente un acento escapado por Webpack; corregido a texto ASCII estable. Sin reiniciar servicios. Resultado permanente: `WS-0028-settings-connections/live-result.json`.

## Para retomar

Probar Configuración → Conexiones; desplegar guía Claude/Codex, releer estados y abrir bróker. Revisar visualmente en el monitor autenticado. Siguiente dependencia para completar el onboarding: contrato del host para estado de autenticación sanitizado e inicio del flujo oficial del proveedor, sin inferencias ni exponer secretos. No se resuelve con CSS.

Revisión independiente y aceptación del owner pendientes. Sin VALIDATED/CLOSED, push/PR, cambios de ACTIVE_WORK_ITEM ni modificaciones a specs ajenas.
