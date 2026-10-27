# GaleCore

Plataforma para automatización y análisis de estrategias con opciones: datos de mercado y de cuenta (Tastytrade/DXLink),
cálculos compartidos (GEX, skew, griegas), estado, riesgo, runtime SHADOW y el monitor. **No es una estrategia**: cada
estrategia es un proyecto con su prefijo, su JSON de reglas, sus endpoints y su pestaña. Dentro del ecosistema, GaleCore
pone datos y cálculos; no interpreta ni recomienda (eso es `ai/`). Este archivo es el mapa; el detalle está en `docs/REFERENCIA-DESARROLLO.md`.

## Producción y git (lo primero)

- GaleCore **corre en producción y lo usa otra persona.** Se trabaja sólo en local, en la línea `local/integracion`
  (una rama por tema, integrada ahí). **Sin push ni PR**, salvo el PR de un fix de algo que hoy está mal en producción,
  con ok del owner: rama desde `master` con sólo ese fix.
- No se toca la base, el VPS ni la configuración de producción. Nada mueve capital real.
- Trabajo local es trabajo commiteado (nada de archivos sueltos sin versionar).

## Estructura

| Ruta | Qué |
|---|---|
| `source/galecore-datafeed/` | API .NET 8 (`DataFeed.sln`: Api, Application, Infrastructure, Repositories, Tests); MediatR/CQRS; hub SignalR |
| `source/galecore-monitor/` | Monitor React 18 + TypeScript (CRA) + Tailwind; pestañas Main, Monitor, GEX, RPF, SHADOW, Agentes, Admin |
| `source/galecore-datafeed/DataFeed.Api/Files/` | `galecore_rules_core.json` (config de la plataforma) y `Files/<Prefijo>/` (JSON de cada estrategia: su fuente de verdad) |
| `dev/galecore_dev.py` | Entorno de desarrollo contra Supabase «GaleCore Dev» (misma implementación que producción, otra base) |
| `docs/` | Referencia de desarrollo, arquitectura de datos, una carpeta por estrategia (`docs/<prefijo>/`) |

Estrategias hoy: **RPF** (operativa, sugiere y nunca ejecuta) y **GEX** (informativa). Índice y convención para sumar
una: referencia, «Estrategias» y «Estrategias — convención».

## Correr en local

```bash
python dev/galecore_dev.py api        # API en :7001 contra GaleCore Dev (Swagger en /swagger)
python dev/galecore_dev.py monitor    # monitor en :3039 contra GaleCore Dev
python dev/galecore_dev.py migrate    # aplica las migraciones EF (rol galecore_ddl)
python dev/galecore_dev.py --help     # deploy/stop de una spec SHADOW con aprobación, runtime-report, init
```

Los datos de mercado son reales (credenciales de Tastytrade en user-secrets, que no se tocan ni se imprimen). Lo
generado en `dev/.local/` queda fuera de git.

## Probar

```bash
python dev/galecore_dev.py test                                          # dotnet test con la base galecore_test de Dev
dotnet test source/galecore-datafeed/DataFeed.Tests/DataFeed.Tests.csproj  # incluye los tests que congelan cada JSON de reglas
cd source/galecore-monitor && CI=true npm run build                       # el build de CI trata los warnings como errores
```

## Reglas de trabajo que no se saltean

- **Primero el JSON, después el código:** ante un cambio de lógica o parámetro de una estrategia, se actualiza su JSON
  y luego el backend o el front. El front renderiza lo que el JSON declara, sin lógica de negocio hardcodeada.
- Un secreto nunca va en `appsettings.*.json`, en docs ni en logs.
- Interfaz: skill `.agents/skills/galecore-frontend/` (tema carbón, jerarquía legible); mirar en el navegador antes
  de entregar.

## Dónde está el detalle (`docs/REFERENCIA-DESARROLLO.md`)

| Tema | Sección |
|---|---|
| Config de la plataforma y convención de estrategias | «Config de la aplicación», «Estrategias — convención» |
| Arquitectura del backend, migraciones y roles, testing y CI | «Backend DataFeed» → Arquitectura, Migraciones, Testing y CI |
| Producción (VPS Linux) y configuración por entorno | «Producción — VPS Linux», «Configuración por entorno» |
| Controllers, tags de Swagger, endpoints y rutas por estrategia | «Taxonomía de la API», «Endpoints GaleCore», «Convención de rutas» |
| GEX (por vencimiento y global), skew, símbolos OCC/DXLink | «`GammaExposureHandler`», «gex_skew», «Símbolos de opción» |
| Switches, archivos por estrategia, lógica compartida | «Regla — switch por estrategia», «Regla — archivos por estrategia», «Lógica compartida» |
| Seguridad y OAuth por operador | «Seguridad», «Regla — aplicación OAuth por operador» |
| Monitor: tecnología, variables de entorno, estructura y reglas de UI | «Frontend Monitor» |

Otros: arquitectura de datos `docs/GaleCore-arquitectura-datos.md`; runtime SHADOW: `docs/REFERENCIA-DESARROLLO.md`.
