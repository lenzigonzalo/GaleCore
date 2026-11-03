# Instalar GaleCore en tu PC (Windows)

## Qué hace

Instala lo necesario (Git, .NET 8, Node, Python 3.12 y Claude Code) y deja GaleCore andando en tu PC:
el Lab contra producción (acceso **GaleCore**) y tu entorno de desarrollo (acceso **GaleCore Dev**: tu propia API,
el monitor y un Lab de Dev, conectados a la base **GaleCore Dev** en la nube). Ver «Iniciar y detener».
Claude Code es el motor del Lab y queda como el predeterminado en tu PC (el instalador fija la variable de usuario
`GALECORE_LAB_PROVIDER=claude`; podés elegir otro motor desde el selector del chat). Un solo comando; si lo volvés a correr, actualiza.

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
`refresh token` y `client secret`. Sirven para los datos de mercado; tu cuenta real se vincula aparte, desde el monitor (abajo).

La `ApiKey` local la genera el instalador y sólo vive en tu PC, igual que la clave con la que se cifra tu cuenta del
broker.

**Tu cuenta real:** después de instalar, en el monitor → **Configuración** → cuenta de bróker, pegá el refresh token de
tu cuenta de Tastytrade y vinculala. Desde ahí el Lab y el monitor leen tu cuenta (sólo lectura).

## Iniciar y detener

Hay dos accesos directos en el escritorio, uno por entorno; se pueden tener abiertos los dos a la vez:

| Acceso | Qué arranca | Contra qué | Se usa desde |
|---|---|---|---|
| **GaleCore** (`iniciar.ps1`) | Lab (`:8771`) y login de los motores | producción, con `GALECORE_LAB_USERNAME` / `_PASSWORD` / `_API_KEY` | `galecore.vercel.app` |
| **GaleCore Dev** (`iniciar.ps1 -Entorno dev`) | API (`:7001`), monitor (`:3039`), Lab de Dev (`:8781`) y login de los motores | GaleCore Dev, con `GALECORE_USERNAME` / `_PASSWORD` | `localhost:3039` |

- Arrancan ocultos, esperan a que respondan y abren la web. La primera vez Dev tarda unos minutos.
- Detener: **Detener GaleCore** / **Detener GaleCore Dev** en el menú Inicio (o `install\detener.ps1 [-Entorno dev]`).
  Cada uno corta sólo lo que inició su acceso.
- Si algo no arranca, los registros están en `%LOCALAPPDATA%\GaleCore\logs`.
- Agentes y avisos: el instalador deja la tarea de Windows `GaleCore-AI\espacio-agentes`, que cada 5 minutos aplica lo
  que hagas en **Agentes** del monitor y revisa tus avisos (watch y SHADOW). Corre aunque GaleCore esté detenido;
  sus errores van a `%LOCALAPPDATA%\GaleCore-AI\space_sync.log`.

## Dónde quedan tus datos

- Tus proyectos, memoria y chats del Lab: `%USERPROFILE%\GaleCore-datos\knowledge` (se crea la primera vez que arranca el Lab).
- El código: `%USERPROFILE%\GaleCore` (no guardes tus cosas ahí).
- Tu configuración local: `galecore-app\dev\.local\env.json` y los *user-secrets* de la API; las variables
  `GALECORE_API_KEY`, `GALECORE_BASE_URL`, `GALECORE_LAB_PROVIDER`, `GALECORE_USERNAME` y `GALECORE_PASSWORD` quedan en tus variables de usuario de Windows.
  Nada de eso se sube a Git.

## Actualizar

Volvé a correr `instalar.ps1` (o `install\instalar.ps1` dentro de la carpeta). Trae el código nuevo y reinstala
dependencias sólo si cambiaron. Conserva lo ya cargado; con `-Reconfigurar` te vuelve a pedir los valores.

## Qué no hace

- No sube nada a la nube salvo los proyectos que vos compartas.
- **SHADOW es tuyo, RPF queda apagado.** Tus estrategias SHADOW corren en tu PC mientras GaleCore está iniciado;
  las de Gonzalo corren en la suya; no se mezclan. RPF queda apagado.
  (El instalador guarda tu usuario como `runtime_owner_username` en tu `env.json`, y deja
  `Files\Rpf\rpf_switch_state.json` con `enabled: false`; ambos están ignorados por Git.)
- No opera: la cuenta que vincules se lee, nunca se envían órdenes.
