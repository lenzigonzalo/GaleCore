# WS-0036 — barra única y Datos

Rama `feature/GC-0036-panel`, worktree `C:/Users/lenzi/GaleCore-Panel-GC-0036`.
Integración local incorporada hasta `0e10e60` (incluye `757e03d` y el endpoint Datos).
Implementación: `25c3af3`. Sólo frontend; commits locales, sin push ni PR.

## Qué quedó

- Una lateral permanente: Inicio, Mercado, Posiciones, Estrategias, Chat, Agentes; Configuración y Usuario abajo. Los mismos nombres en Ctrl K. Biblioteca oculta.
- Estrategias incorpora proyectos en diseño y RPF/Hoy, con enlaces de ida y vuelta al proyecto del chat; conserva la lista al regresar.
- Configuración como ventana con General, Conexiones, Mi trading, Conocimiento y Equipo. Asistente de tres pasos cuando falta confirmada de IA y perfil; JSON legible y perfil editable sin interpretar límites.
- Watchlist, Calendario y Avisos en el dock; ClaudeTerminal en pantalla dividida, ajustable y con sesión conservada al ocultarlo.
- Datos después de Diseño, consulta sólo al abrir. Tabla del contrato, estados como ✓/✗/sin dato, nota en title y fechas ET; 404 explicado. Calidad de datos movida y texto de reglas fuera del runtime renombrado.
- Se corrigió la carga de Mercado independiente de abrir Watchlist, el ancho legado que interfería en 760 px y Cancelar del perfil que dejaba valores sin guardar visibles.

## Verificación

Desde `source/galecore-monitor`, PowerShell:

```powershell
$env:CI='true'
npm.cmd run build
npm.cmd test -- --watchAll=false --runInBand
```

Ambos exit 0; 38 suites, 165 tests en verde. Salidas reales en `build.log` y `tests.log`.
Review independiente APPROVE: `docs/engineering/reviews/WS-0036-menu-20261014.md`.

Dev `:3039`, con `python dev/galecore_dev.py monitor`, API Dev `:7001`: recorrido completo de Inicio → Avisos → Posiciones → Estrategias → spy_prima_varianza_30_45d → Abrir en el chat → Ver seguimiento → Configuración → Mercado/chat dividido → Ctrl K.
En 1280 y 760 px: una lateral, sin desborde del documento ni pageErrors. En 760 px el contenido conserva 280 px y el chat 368 px después de ajustar. `Performance/Data` respondió HTTP 200. Ver `recorrido.json`, `recorrido.log` y capturas pequeñas; ninguna captura adicional de Datos.

Reproducir desde la raíz del worktree:

```powershell
python docs/engineering/evidence/WS-0036/menu/recorrido.py
```

Usa las credenciales locales ignoradas de `dev/.local/env.json`, sin imprimirlas. El recorrido no envía mensajes ni cambia configuración o switches.

## Alcance pendiente

Bróker queda como próximamente; Biblioteca espera contenido servido por el back. Preferencias de paneles de Mercado y visibilidad de estrategias por usuario quedan para el back, según el handoff. La captura de Mercado acredita cotización y layout mientras el barrido estaba en curso; no acredita la completitud de la cadena. El asistente y la edición/cancelación del perfil se verificaron con tests, sin modificar el perfil real de demo.
No se tocó producción ni se marcó VALIDATED/CLOSED.
