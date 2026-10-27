# GC-0036 — revisión independiente de conexiones de datos y bróker

Fecha: 22/10/2026. Reviewer independiente: Codex. Una sola pasada; este informe no aprueba ni cierra el work item.

## Alcance y snapshot

Revisé estáticamente el diff sin commit contra `HEAD` en la rama `feature/GC-0036-conexiones-datos`, dentro del checkout `C:/Users/lenzi/OneDrive/Escritorio/GaleCore/GaleCore`. `HEAD` y `local/integracion` apuntaban a `30028ad081d052d7b4707ef89b52bae6937b448d`.

El árbol estaba **dirty**: `api/account.ts`, `Connections.{tsx,test.tsx}` y `Settings.tsx` modificados; `BrokerAccountCard.{tsx,test.tsx}`, `ApiConnections.tsx`, `SettingsConnections.test.tsx`, el work item y `docs/engineering/evidence/GC-0036/` sin trackear. Este informe se agrega también sin commit. No modifiqué la implementación.

Contrasté el cambio con el contrato de GC-0036 y con los endpoints existentes: ubicación independiente para API y claves; Cuenta de bróker con lectura, vinculación, actualización y desvinculación; secretos limitados al request autenticado; Skills fuera del proveedor; estados negativos y advertencia de cuenta de sistema. También comparé el formulario recuperado con la versión anterior a `6d5ff12`. No hubo navegador disponible, por lo que la apariencia no quedó evaluada en esta pasada.

**Resultado: CHANGES_REQUESTED por F1.** No corresponde marcar GC-0036 `VALIDATED` ni `CLOSED`.

## F1 — P1: una relectura fallida conserva y vuelve a mostrar una vinculación obsoleta, incluso después de borrarla

Ubicación: `source/galecore-monitor/src/components/account/BrokerAccountCard.tsx:49-62,90-110,170-190,296-339` y `source/galecore-monitor/src/components/account/BrokerAccountCard.test.tsx:30-55`.

`load()` limpia el error, pero no invalida `state` al iniciar ni en el `catch`. Si una lectura anterior devolvió una cuenta vinculada y luego «Releer» falla, al terminar `loading` la pantalla vuelve a renderizar el número de cuenta, la aplicación OAuth, la marca de sistema y el control «Desvincular» junto con el error. Por lo tanto, una lectura fallida sigue afirmando visualmente una conexión que ya no pudo comprobar.

El caso más delicado ocurre después de un DELETE exitoso: `handleUnlink` limpia los inputs y muestra «Cuenta desvinculada», pero conserva el objeto `state` hasta que termine el GET posterior. Si ese GET falla, `state.linked` sigue en `true`; la pantalla muestra el número borrado y permite iniciar otra desvinculación de una cuenta que el endpoint ya eliminó. Esto contradice los negativos «lectura fallida no afirma conexión» y «no repite datos borrados», y mezcla simultáneamente éxito de borrado, error de lectura y estado viejo.

Las pruebas cubren sólo un fallo en la primera lectura y fuerzan un GET verde después del DELETE, por eso no detectan ninguno de los dos recorridos. El estado comprobado debe invalidarse al comenzar una relectura o al fallar, y la respuesta exitosa del DELETE debe reflejarse inmediatamente como no vinculada antes de cualquier GET de confirmación. Hace falta cubrir: (1) cuenta vinculada seguida de relectura fallida; (2) DELETE exitoso seguido de GET fallido, verificando que no aparecen número, badges ni control de desvinculación.

## Evaluación restante

- El formulario reutiliza `GET/POST/DELETE /App/GaleCore/Account`. Los endpoints exigen usuario autenticado; el UUID sale del JWT y no del body. El POST cifra refresh token y client secret antes de guardar, el GET devuelve sólo metadatos y el backend no registra los valores secretos.
- Refresh token y client secret usan inputs `password`, no pasan a stores, preferencias, `localStorage` ni `sessionStorage`, y se limpian después de un POST exitoso. El número y el refresh token son obligatorios; el client secret es opcional y la pantalla advierte que dejarlo vacío reemplaza una aplicación OAuth propia por la de GaleCore.
- La desvinculación requiere una segunda acción explícita, presenta el número afectado y destaca el impacto cuando es la cuenta de sistema. F1 cubre el estado posterior si falla la comprobación.
- El callback de cambio limpia el store de saldos y posiciones tras vincular o desvincular, evitando conservar datos de la cuenta anterior en memoria.
- «API y claves» no ofrece inputs ni simula persistencia inexistente: explica acceso por sesión, FRED configurado en el servidor y Alpha Vantage vía MCP cuando corresponda, y declara pendiente el almacenamiento de claves personales.
- Skills queda en una sola sección general. Claude Code y Codex conservan únicamente Cuenta, Permisos y Servidores MCP.
- Los mensajes de error de cuenta existentes ahora apuntan a la ruta visible `Configuración › Cuenta de bróker`. No vi cambios de backend, migraciones, credenciales reales, producción ni operaciones de broker en el diff.

## Verificación y límites

- Ejecuté `git diff --check`: terminó sin errores.
- No ejecuté tests ni build en esta pasada de lectura. La evidencia de la sesión principal registra 3 suites focalizadas / 7 tests verdes y build CI exitoso; la suite completa seguía en curso al fijar este snapshot. Esos resultados pertenecen al implementer y no cubren F1.
- No llamé los endpoints, no vinculé ni desvinculé cuentas y no leí ni escribí credenciales.
- No hubo navegador disponible. Los mocks JSDOM no acreditan apariencia, recorrido real ni persistencia contra la API. El owner conserva la decisión de aceptación y cierre.
