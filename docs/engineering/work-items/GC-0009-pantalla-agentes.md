---
id: GC-0009
title: Pantalla Agentes y barra reordenada
status: IN_PROGRESS
implementer: claude-code
reviewer: internal
approver: user
review_result: PENDING
approval_result: PENDING
---

# GC-0009 — Pantalla Agentes

Producto 1 (roadmap §4), siguiente entrega del handoff del 03/10: pantalla de trabajo de los agentes del trader
y barra reordenada. Rama local `feature/GC-0009-agentes` desde `feature/GC-0008-tema-carbon` (`02cdc9d`), para salir con
el tema carbón sin tocar el checkout donde trabaja GC-0008. Sin push, PR ni despliegue. Par en GaleCore-AI: GC-AI-0023.

## Para qué

Ver desde el monitor si cada agente está prendido, si su último resultado está al día, cuándo corrió y cuándo corre, qué
encontró, y prenderlo o apagarlo sin abrir la consola.

## Qué se hizo

- `pages/Agentes.tsx`: lista de agentes (estado, al día / se saltó / falló, última y próxima corrida, corridas) y
  detalle (qué le pediste, la última corrida, qué encontró en markdown). Se refresca cada minuto.
- Prender/apagar: el monitor no llega a la PC donde corren; escribe un pedido en la pieza `agent` del espacio
  (`request: {status, at}`) con el `PUT /App/GaleCore/Space` existente y muestra «Prendiendo…/Apagando…» hasta que
  GaleCore-AI lo aplica (≤ 5 min, tarea `GaleCore-AI\espacio-agentes`). Un pedido rechazado se muestra con el motivo.
- `TabNav.tsx`: Main · Monitor · **Estrategias ▾** (GEX, RPF, SHADOW) · Inteligencia · **Agentes**. El menú se marca
  como activo con la pantalla abierta («Estrategias · GEX»).
- Configuración > Agentes apunta a la pestaña nueva. Sin cambios de API ni de base: el espacio (GC-0007) ya admite
  contenidos de hasta 200 000 caracteres.

## Criterios

- [x] **AC-01 — Pantalla con datos reales (04/10):** GaleCore-AI publicó los 3 agentes del usuario demo en GaleCore
  Dev (`space agents`); el monitor (build del worktree en :3041 detrás de un proxy local a la API Dev, sesión del
  usuario demo) muestra atencion-diaria-spy «Se saltó una corrida» (2/10 sin PC), seguimiento-spy-prima-varianza «Al
  día», oportunidades «Pausado» con botón Prender, y el detalle con resultado, modelo, duración y hallazgos.
- [x] **AC-02 — Barra:** menú Estrategias con GEX, RPF y SHADOW, visto en el navegador.
- [x] **AC-03 — Build:** `CI=true npm run build` exit 0 («Compiled successfully»); `tsc --noEmit` exit 0. Jest:
  20 tests pasan; `App.test.tsx` falla igual en el checkout principal (import ESM de lightweight-charts, previo).
- [ ] **AC-04 — Prender/apagar en vivo:** probado con tests en GaleCore-AI (pedido → pausa/reanuda en el
  Programador, evento con «Pedido desde el monitor por demo»); no se tocó ningún agente real. Lo prueba el owner
  con `oportunidades` (hoy pausado a pedido suyo) cuando quiera prenderlo.
- [ ] **AC-05 — Cierre:** owner.
