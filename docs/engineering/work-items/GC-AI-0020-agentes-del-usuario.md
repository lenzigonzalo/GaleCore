---
id: GC-AI-0020
title: Agentes que crea el usuario — primero, el de oportunidades (Producto 1, fase 2)
status: IN_PROGRESS
implementer: claude-code
reviewer: internal
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0020 — Agentes que crea el usuario

Roadmap §4, Producto 1, fase 2 (owner, 03/10: «dale, arrancá con la fase 2»). Rama desde `feature/GC-AI-0019`
(usa `galecore get`).

## Para qué

Que el trader describa en sus palabras un agente («cada 30 minutos revisá SPY, QQQ e IWM y anotá candidatos para un
put credit spread cuando el IV rank esté alto y no haya un evento macro cerca») y quede corriendo solo, con los datos
de GaleCore, guardando lo que encontró para consultarlo después. Es lo que permite no perder oportunidades sin estar
mirando la pantalla.

## Qué se hizo

| Pieza | Cómo |
|---|---|
| Un agente = una tarea de `market_watch` con tus instrucciones | Capacidad genérica: el `objective` de la tarea es el método (símbolos, condiciones, qué es un hallazgo). No hay que programar una capacidad por idea; una idea muy distinta se arma con `capability_builder` |
| Frecuencia `market_hours` | Cada N minutos (15–240), lunes a viernes, sólo de 9:30 a 16:00 de Nueva York. En el Programador: semanal L–V con repetición durante la sesión |
| Tareas sin estrategia | `strategy` opcional: un agente que vigila el mercado no sigue una estrategia y no corre seguimiento. El seguimiento de estrategias la sigue exigiendo |
| Modelo por capacidad | `schedulable.model` en el catálogo (`market_watch`: sonnet, 25 turnos, 12 min) para cuidar el cupo del plan |
| Hallazgos | Cada corrida es una revisión de `research:<fecha>-market-watch-<agente>`; `task status <id>` y `LATEST.md` dicen la última |

## Cómo se crea un agente

```
task create --id oportunidades --capability market_watch --frequency market_hours --minutes 30 \
  --timezone America/New_York --objective "<tus instrucciones>" --expected "candidatos que cumplen, los que \
  quedaron cerca y qué faltó" --source "GaleCore (galecore get)" --prompt "<lo que pediste>"
task pause|resume|cancel oportunidades --prompt "..."
task status oportunidades          # última corrida, frescura, dónde leer el resultado
```

## Non-goals

Avisos con sonido en el monitor (fase 5); varios agentes coordinados; órdenes; un evaluador por código de condiciones.

## Acceptance criteria

- [x] **AC-01 — Frecuencia en horario de mercado** con validación, horarios de corrida correctos y registro en el
  Programador. Tests: `tests/unit/test_market_watch.py`.
- [x] **AC-02 — Agente sin estrategia:** se crea y corre sin seguimiento; el seguimiento de estrategias sigue exigiendo una.
- [x] **AC-03 — Modelo por capacidad** llega al comando de `claude`.
- [x] **AC-04 — Ejemplo interno:** un agente real creado desde el CLI y corrido una vez a pedido, con hallazgos guardados.
  **Evidencia 03/10:** tarea `oportunidades` (SPY, QQQ, IWM; PCS 30–45 días con short cerca de delta 0,20 si IV rank > 30,
  sin evento macro en 3 días hábiles y dentro del límite del perfil), creada y **pausada**. Corrida manual: `OK` en
  92 s, 15/25 turnos, `claude-sonnet-5-5`, 5 evidencias guardadas, una ronda de corrección (dos referencias mal
  escritas), `research:2026-10-03-market-watch-oportunidades` rev 1: ninguno cumple (IV rank < 30 en los tres); no
  pidió cadenas porque sin IV rank no hay candidato. Costo estimado prendido: ~13 corridas/día × ~1,5 min de Sonnet.
- [ ] **AC-05 — Revisión:** interna (no mueve plata ni toca validadores de aceptación; el modelo sin supervisión ya pasó
  por Codex en 0017); utilidad y cierre, vos.
