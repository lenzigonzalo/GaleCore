# Instalar GaleCore en tu PC (Windows)

## Qué hace

Instala lo necesario (Git, .NET 8, Node, Python 3.12 y Claude Code) y deja GaleCore andando en tu PC:
tu propia API (`:7001`), el monitor (`:3039`) y el Lab (`:8771`), conectados a la base **GaleCore Dev** en la nube.
Claude Code es el motor del Lab. Un solo comando; si lo volvés a correr, actualiza.

## Antes de empezar

1. Gonzalo te da acceso al repositorio en GitHub (tu cuenta). Cuando Git pida iniciar sesión, entrá con esa cuenta.
2. Tené a mano los valores de la lista de abajo.
3. Tené una suscripción de Claude (la primera vez abrís `claude` en una terminal y entrás con tu cuenta).

## Instalar

Abrí PowerShell y corré (te lo pasa Gonzalo, junto con el archivo `instalar.ps1`):

```powershell
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

Para ver qué haría sin instalar nada: agregá `-DryRun`.
Si Windows pide permiso de administrador durante la instalación de programas, aceptalo.

## Qué datos te pasa Gonzalo (por un canal seguro, nunca por mail común)

El instalador te los pide uno por uno; lo que es secreto no se muestra al escribirlo.

| Valor | Para qué |
|---|---|
| Clave pública (`anon key`) de GaleCore Dev | que el monitor y la API puedan iniciar sesión |
| Host del pooler (termina en `pooler.supabase.com`) | dónde está la base |
| Contraseña de la base para el rol `galecore_api` | que tu API lea y escriba filas en Dev |
| Tu usuario y contraseña de GaleCore Dev | entrar al monitor, al Lab y al harness como vos |

Y vos traés tus **credenciales de Tastytrade** (de tu propia aplicación OAuth en Tastytrade):
`refresh token` y `client secret`. Sirven sólo para los datos de mercado; tu cuenta de bróker **no** está cargada en Dev.

La `ApiKey` local la genera el instalador y sólo vive en tu PC.

## Iniciar y detener

- Iniciar: acceso directo **GaleCore** del escritorio (o `install\iniciar.ps1`). Arranca todo oculto, espera a que
  responda y abre el monitor en el navegador. La primera vez tarda unos minutos.
- Detener: **Detener GaleCore** en el menú Inicio (o `install\detener.ps1`). Sólo corta lo que inició GaleCore.
- Si algo no arranca, los registros están en `%LOCALAPPDATA%\GaleCore\logs`.

## Dónde quedan tus datos

- Tus proyectos, memoria y chats del Lab: `%USERPROFILE%\GaleCore-datos\knowledge` (se crea la primera vez que arranca el Lab).
- El código: `%USERPROFILE%\GaleCore` (no guardes tus cosas ahí).
- Tu configuración local: `galecore-app\dev\.local\env.json` y los *user-secrets* de la API; las variables
  `GALECORE_API_KEY`, `GALECORE_BASE_URL`, `GALECORE_USERNAME` y `GALECORE_PASSWORD` quedan en tus variables de usuario de Windows.
  Nada de eso se sube a Git.

## Actualizar

Volvé a correr `instalar.ps1` (o `install\instalar.ps1` dentro de la carpeta). Trae el código nuevo y reinstala
dependencias sólo si cambiaron. Conserva lo ya cargado; con `-Reconfigurar` te vuelve a pedir los valores.

## Qué no hace

- No sube nada a la nube salvo los proyectos que vos compartas.
- **SHADOW y RPF quedan apagados en tu API.** Sólo la API de Gonzalo corre las estrategias SHADOW contra Dev.
  El instalador lo deja así de tres formas, todas locales: `runtime_persistence: false` en tu `env.json`
  (tu API no recupera ni valúa las posiciones de Gonzalo y no puede desplegar estrategias), y los archivos de
  estado `Files\Rpf\rpf_switch_state.json` y `Files\platform_services_switch_state.json` con `enabled: false`
  (están ignorados por Git). No los prendas desde el monitor.
- No carga tu cuenta de bróker ni opera: los datos de mercado vienen de tus credenciales de Tastytrade.
