---
id: GC-AI-0010
title: Contexto de cartera de sólo lectura y análisis macro útil para decisiones reales
status: DRAFT
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0010 — Cartera de sólo lectura + macro (roadmap §4, entrega 3)

Origen: owner, 27/09/2026 — «Vamos con tus recomendaciones, y usa tastytrade via galecore. IBKR e IOL todavía no».
Fuente de la cartera: **Tastytrade vía GaleCore**, sólo lectura. Fuera: IBKR, IoL, plataforma de conectores, ejecución.

## Acuerdo breve

- **Problema:** GaleCore-AI analiza estrategias y contexto, pero no conoce tus objetivos ni tus posiciones: el contexto macro
  no se puede elegir por lo que realmente tenés en riesgo.
- **Qué vas a poder hacer:** declarar tus objetivos (retorno buscado, drawdown aceptable, horizonte, liquidez) y pedir «mostrame
  mi cartera y qué contexto macro importa para ella»: posiciones leídas de tu cuenta por GaleCore, exposiciones, factores
  macro elegidos por esas exposiciones (reutilizando `context_research` con FRED/FMP/Alpha Vantage), evidencia guardada y
  «qué merece tu atención»; delegable con la misma tarea recurrente de GC-AI-0009.
- **Primera demostración:** tus posiciones reales leídas por la API de GaleCore Dev, guardadas como evidencia, con un informe
  de exposiciones y contexto.
- **Qué falta para correrla (bloqueo verificado 27/09):** `GET /Data/Tastytrade/Account/Balances|Positions` en GaleCore Dev →
  **409 «El usuario autenticado no tiene una cuenta de bróker vinculada»** (tabla `accounts` de Dev vacía). Se destraba
  vinculando tu cuenta desde la tarjeta de cuenta del monitor de desarrollo (http://localhost:3039, usuario de prueba): número
  de cuenta + refresh token de Tastytrade, cifrados por la API (AES-GCM); nunca por el chat. Después puede aparecer el 403 de
  `BL-015` (visto con la credencial de sistema); se diagnostica con el primer intento real.
- **Método reutilizable:** si el informe macro resulta útil, su método se guarda como la primera skill creada desde la
  conversación (versionada, descubrible, ejecutable con datos nuevos) — roadmap §4 fila 4, entrega chica.
- **Fuera:** asignación automática, órdenes, otras cuentas, pantallas nuevas.

## Acceptance criteria (borrador, se fijan al destrabar el acceso)

- [ ] **AC-01 — Acceso comprobado:** lectura real de balances y posiciones por la API de GaleCore, guardada como evidencia.
- [ ] **AC-02 — Objetivos:** declarados por el owner y guardados; cada informe los usa.
- [ ] **AC-03 — Informe:** exposiciones, factores macro elegidos por ellas con fuentes comprobadas, tipos de afirmación
  separados, «qué merece tu atención»; sin recomendaciones de operar.
- [ ] **AC-04 — Delegable:** la tarea recurrente puede correr este informe.
- [ ] **AC-05 — Método como skill** (si el owner lo encuentra útil).
- [ ] **AC-06 — Revisión:** interna y Codex; utilidad y cierre, el owner.
