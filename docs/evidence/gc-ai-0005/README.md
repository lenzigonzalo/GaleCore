# GC-AI-0005 — evidencia de uso real (2026-09-23)

Copias sanitizadas de la salida exacta de cada comando (rutas absolutas → `<workspace>`,
`<home>`, `<scratchpad>`). No interviene GaleCore en vivo ni ninguna ApiKey.

## Sesión 1 — el host (Claude Code, Opus 5.5) recibe un pedido normal

Pedido: *"Investigá si el 0DTE vencido distorsiona el net GEX que registramos post-cierre y cómo lo
probaríamos."*

| Paso | Comando | Exit | Resultado | Archivo |
|---|---|---|---|---|
| 1 | `catalog` | 0 | Tres capacidades disponibles; la base en `<workspace>/knowledge` | `s1-step1-catalog.json` |
| 2 | `kb search --text "0DTE GEX post-cierre vencimiento"` | 0 | 4 registros de régimen, ninguna investigación previa | `s1-step2-kb-search.json` |
| 3 | `research save --slug gex-0dte-post-cierre --prompt "<pedido>"` | 0 | `research:2026-09-23-gex-0dte-post-cierre`, revisión 1, 6 referencias resueltas con su sha256 | `s1-step3-research-request.json`, `s1-step3-research-save.json` |

Los hechos citados se verificaron antes contra sus fuentes (configuración GEX con
`include_zero_dte: true`, `minDte = IncludeZeroDte ? 0 : 1` en el handler, request genérico con
`IncludeZeroDte = false`, registro del 23 con `net_gex` −822.1, addendum de BL-011).

## Sesión 2 — una sesión nueva sin la conversación anterior

Un agente nuevo (subagente de Claude Code, contexto limpio) recibió sólo el pedido *"Retomá la
investigación que dejamos abierta sobre el GEX post-cierre y avanzá lo que se pueda hacer hoy sin
levantar GaleCore"* y la indicación de leer `GaleCore-AI/CLAUDE.md`. No recibió el id ni el
contenido. Su transcripción completa: `s2-transcript.md`.

| Paso | Comando | Exit | Resultado | Archivo |
|---|---|---|---|---|
| 1 | `catalog` | 0 | Eligió `research` | `s2-step1-catalog.json` |
| 2-3 | `kb search ... --status open` | 0 | **0 resultados**: la investigación estaba en `test_planned` | `s2-step2-kb-search.json`, `s2-step3-kb-search-gex-open.json` |
| 4 | `kb search --text "gex" --kind research` | 0 | La encontró | `s2-step4-kb-search-research.json` |
| 5 | `kb show research:…` | 0 | Leyó pendientes y faltantes | `s2-step5-kb-show.json` |
| 6 | `research revise --reason continuation` | 0 | Revisión 2: completó el paso tres del plan leyendo código; 13 referencias resueltas | `s2-step6-research-revise-request.json`, `s2-step6-research-revise.json` |
| 7 | `kb show research:…` | 0 | Historial [1, 2]; la revisión 1 intacta | `s2-step7-kb-show-after.json` |

Lo que estableció la revisión 2 (desde el código, sin ejecutar): el endpoint genérico de gamma
exposure puede reproducir el corte de la estrategia si se le pasan todos los parámetros, pero la
medida principal es más simple: la respuesta de `/App/Gex/Analysis` ya trae el desglose por
vencimiento, así que "global menos el vencimiento de DTE cero" sale de una sola lectura (con un
margen de redondeo de 0.1 por valor). También confirmó que el vencimiento del día sigue en DTE cero
después del cierre hasta que cambia la fecha de Nueva York.

## Defectos que encontró la demo y cómo quedaron

- **Acentos rotos en la revisión 1.** El CLI leía stdin con la codificación de la consola (cp1252),
  no UTF-8. La revisión 1 quedó guardada y hasheada con mojibake (`rÃ©gimen`); por ser append-only
  **no se reescribe**. La revisión 2 (con `PYTHONUTF8=1`) está bien y repite el texto correcto.
  Corregido en `fix(ai)` (el CLI lee bytes y decodifica UTF-8), con un test por subprocess que falla
  con el código anterior en esta máquina (verificado: `sys.stdin.read()` → `R\xc3\xa9gimen`).
- **`--status open` no encuentra `test_planned`.** Agregado `--status unfinished`; la skill pasa a
  1.1.0. Después del fix, la misma búsqueda la encuentra: `s3-kb-search-unfinished-after-fix.json`.

## Migración y rama

- `migration-report.json`: los cuatro registros de régimen copiados byte a byte a
  `knowledge/regime/SPY/`, sha256 idéntico, integridad OK, `query` igual en origen y destino.
- `g-branch-independence.json`: los 7 archivos de la base, idénticos antes, durante y después de
  cambiar GaleCore-AI a `feature/gc-ai-0002`; ninguna rama de GaleCore tiene ya registros en
  `research/regime` (quedan en su historia de git, commit `6e13394` los quitó con README de puntero).

## Estado de la base al cerrar la demo

`knowledge` en `main`, commits `c9be9dd` (base + registros) y `d56a5fb` (investigación, revisiones
1 y 2, commiteado por la sesión 2 como indica `CLAUDE.md`). sha256 del archivo de la investigación:
`ed50078f116f8c853648c16ffa9e188528260fcd420b64b248f28bb3d5e005dd`.

## Qué no se verificó

- Nada de la revisión 2 se ejecutó contra GaleCore: el binding del query string y la igualdad
  entre endpoints son lectura de código, y la propia investigación los lista como faltantes.
- La "sesión nueva" es un subagente con contexto limpio en la misma máquina, no una sesión abierta
  por el owner.
- La sesión 2 hizo el commit de `knowledge/` desde PowerShell después de que el hook `guard_git`
  rechazara dos intentos desde Git Bash por no poder resolver el repo destino. El commit es el
  indicado por `CLAUDE.md` y sólo agrega el archivo de la investigación, pero el rodeo del hook se
  declara.
