# GC-0031 — Conexiones MCP locales

## Qué quedó usable
Configuración → MCP locales en http://localhost:3039. Claude/Codex separados;
Claude permite elegir contexto de proyecto y aplica el interruptor sólo allí.
Codex escribe enabled en ~/.codex/config.toml (usuario). Los MCP compartidos del
workspace se deshabilitan con disabledMcpjsonServers en .claude/settings.local.json.
Los MCP usuario/local de Claude usan projects[context].disabledMcpServers en ~/.claude.json.
El alcance de estos campos se contrastó con el código del CLI instalado; no se conectaron MCP.
No se muestran URL, comandos, argumentos, variables, headers ni credenciales.
Incluye MCP de plugins y conectores de cuenta de Claude via listado nativo del CLI.
No incluye integraciones de la app Codex ni overrides por argumentos/sesion.
Para .mcp.json, habilitar conserva la aprobación que Claude requiera; no la concede.

## Ejecución y evidencia
- Servicio sólo 127.0.0.1:8772: origen exacto http://localhost:3039, Host permitido,
  token efímero en memoria, escrituras por IDs del inventario, sin rutas enviadas por cliente.
- 15 tests Python: backend-tests.txt (hogares temporales), conservación de secretos/otros ajustes,
  comentarios TOML, reversibilidad, respaldo original, conflicto y reemplazo fallido, origen/token/Host.
- 5 tests frontend de LocalMcp: proveedores, confirmación del guardado, conflicto sin cambio falso.
- Build CI pasó: build-receipt.json referencia la ejecución y el hash del artefacto.
- Chromium: browser-run.json + capturas. Inventario real de archivos locales, **sesión Supabase
  sintética aislada al navegador de QA**; API 7002 simulada en ese contexto, servicio MCP real.
  La prueba de interruptores redirige sólo inventory/toggle a Inventory con un hogar temporal;
  no modifica MCP del usuario. No acredita login Dev real, conexión con servidores ni cambio de una sesión abierta.
- Comprobacion inicial: Codex node_repl; Claude mostraba la entrada local datafeed en C:/Users/lenzi.
  Esa entrada NO acreditaba un MCP conectado; el owner detecto la cobertura insuficiente.

## Correr y retomar
Dependencia local: python -m pip install -r dev/local_mcp_requirements.txt.
Servicio: python dev/macro_dev.py mcp (desde este worktree); alternativa:
python dev/local_mcp.py --workspace C:/Users/lenzi/OneDrive/Escritorio/GaleCore.
Monitor: python dev/macro_dev.py monitor (3039, API Macro existente 7002).
Prueba navegador reproducible: python dev/local_mcp_smoke.py.

Antes de escribir se respalda el contenido original en %LOCALAPPDATA%/GaleCore/mcp-backups (fuera del repo y OneDrive).
Permisos Windows: DACL protegida con acceso del propietario y SYSTEM. En POSIX, 0700.
Puede contener credenciales; no se publica ni se expone por HTTP.
Escritura temporal + reemplazo; SHA de archivos se revalida antes de reemplazar.
Detecta cambios previos/concurrentes observables; no hay bloqueo compartido con los CLIs,
por lo que no garantiza exclusión durante el instante final de reemplazo.
Nada se instaló o conectó en IBKR/IOL; no hay integración de broker ni órdenes.
Worktree aislado: C:/Users/lenzi/GaleCore-Local-MCP-GC-0031. No cambia ACTIVE_WORK_ITEM.
Sin push/PR, producción ni VALIDATED/CLOSED.

Suite frontend completa anterior a las correcciones del review: 25 suites pasan, 3 fallan; 86 tests pasan y 1 falla.
Fallos en Lab.test.tsx/App.test.tsx por react-markdown ESM y LabShadow.test.tsx
por expectativa de lectura fallida (archivos fuera del diff; antecedentes GC-0030).
Detalle: frontend-suite.txt. No se modificaron esos archivos de Claude.
Codex CLI instalado reconoce enabled=false/true por override de proceso, sin escribir
config ni conectar servidores: codex-cli-check.json (salida sanitizada).

## Review independiente y respuesta
Review: ../../reviews/GC-0031-independent.md, CHANGES_REQUESTED sobre aae9ceb..364b1c9.
F1 corregido: respaldos fuera del checkout, con DACL protegida antes de escribir; prueba de ruta.
F2 corregido: MCP compartidos requieren aprobacion existente (lista o aprobacion global);
sin aprobacion el switch queda apagado y no editable. Backend rechaza toggle. No se concede
aprobacion desde este panel. Pruebas positivas/negativas agregadas.
F3 registrado: sigue la ventana hash-reemplazo sin bloqueo compartido con los CLIs.
No editar simultaneamente estos archivos desde otros programas al usar un interruptor.
No se pidio recheck ni se modifica el review; no hay APPROVE/VALIDATED/CLOSED.

## Correccion de inventario: cuenta y plugins de Claude (13/10)
El owner confirmo Claude Code en esta PC. Listado real del CLI detecta 24 conectores de
cuenta y 27 MCP de plugins. Alpha Vantage, Google Drive/Calendar/Gmail e IoL conectados;
IBKR requiere autenticacion en la comprobacion registrada. Capturas account-*.png.
No se instalaron esas conexiones: existian en la cuenta y el listado anterior las omitia.
Servicio inicia/actualiza Claude mcp list en un hilo, timeout 55s. Solo publica nombres
y estados canonicos; URLs/args/headers/stdout completo nunca se guardan ni se devuelven.
Referencias historicas solo se muestran sin comprobar y no editables hasta verificar CLI.
Conectores y plugins se deshabilitan por nombre completo en disabledMcpServers del
proyecto actual; no revoca OAuth ni desconecta globalmente cuentas/brokers.
El proyecto del workspace se selecciona por defecto; datafeed queda como entrada local
del contexto anterior y no sustituye a las conexiones reales. Buscador y grupos por origen.
Navegador actualizado: browser-run.json; auth sintetica aislada, inventario CLI real,
interruptores exclusivamente con archivos temporales. 15 backend / 5 frontend / build CI.
Logs del build: build-account-discovery.txt. Review previo no cubre esta ampliacion,
no se pidio recheck ni se cambia su resultado. F3 sigue documentado.

## Filtro de habilitacion (13/10)
Todos / Habilitados / Deshabilitados, combinado con el buscador y el proyecto/CLI.
Usa el estado del interruptor, independientemente de conectado/requiere autenticacion.
Recorrido Chromium agrega checks de filtro sobre inventario real y cambio de pertenencia
al apagar/prender el fixture temporal. No cambia MCP reales ni el servicio local.
Build de esta iteracion: build-enabled-filter.txt.
