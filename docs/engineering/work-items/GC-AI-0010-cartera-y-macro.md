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

## Reorientación (owner, 27/09/2026)

Owner: «¿Es necesario que ponga mi cuenta de bróker? Inventame plata y listo si necesitas… lo tengo que conectar en produ
después y tengo 2.5k usd nomás… no te pierdas en eso, acordate del objetivo final».

- **No se vincula la cuenta de bróker ahora.** Queda para cuando se conecte producción.
- **No se inventan posiciones ni saldos** (regla del owner: datos siempre reales). La «cartera» de esta entrega es lo que ya
  está en riesgo con datos reales en GaleCore: las posiciones SHADOW (1.0.3 y la posición remanente de v2). El capital de
  referencia es un **parámetro declarado** por el owner, no un dato de cuenta.
- El contexto macro se elige por esa exposición (puts de SPY a 30–45 días), reutilizando `context_research` y las fuentes con
  acceso comprobado (FRED, FMP, Alpha Vantage).

## Primer informe (28/09/2026)

Owner: «lo macro lo podés hacer ahora? … cap de referencia poné 10000 usd no sé».

- **Capital de referencia declarado:** 10.000 USD (parámetro, no dato de cuenta).
- **Informe:** `research:2026-09-28-cartera-shadow-contexto-macro` (método `context_research`), 20 evidencias
  `evidence:2026-09-28-cartera-ctx-*` (GaleCore Dev, FRED, FMP). Exposición: PCS SPY 731/726 vto. 06/11 (v2, riesgo 456 USD =
  4,6 %) + hasta 500 USD de la 1.0.3 (peor caso conjunto ≈ 9,6 %, mismo factor). Hallazgos: la suba del 10 años del 22–24/09
  fue toda tasa real (breakeven plano) → pierde el escenario A del 25/09; HY OAS +27 pb en 4 sesiones; la implícita repreció
  el 28/09 (VIX +10 %, VVIX > 90). Atención: semana 27–29/10 (FOMC a confirmar, PBI, resultados de MSFT/GOOGL/META/AAPL/AMZN);
  empleo el mismo día del vencimiento.
- **Faltantes:** calendario del FOMC con fuente (FMP denegado, FRED 101 no sirve); FMP `quote` denegado por plan.
- Avance contra AC: AC-03 con primera demostración (sin revisión); AC-02 sólo el capital, faltan objetivos (retorno, drawdown,
  horizonte) — se piden si el owner considera útil el informe; AC-01 queda reemplazado por la reorientación (sin cuenta).

## Revisión técnica del informe (28/09) — separada de la utilidad

**Revisión técnica interna** (agente `reviewer`, solo lectura, sobre r1): CHANGES_REQUESTED sin BLOCKER. Recalculó todos los
valores desde los payloads: coinciden, salvo el techo conjunto (≤ 946 USD, no ~956). MAJOR: (1) comparado contra el
antecedente r1 en vez de r5 (r3 ya había separado tasa real/breakeven, r4 tenía NVDA 18/11, r5 el estudio insuficiente);
(2) faltaban las reglas de salida de v2 y 1.0.3 en la cadena exposición → riesgo → atención; (3) el tope de 500 USD sin
citar la spec y leído como pérdida y no como cota; (4) los objetivos del owner no figuraban como faltantes. MINOR: ventanas
de HY y breakeven desalineadas, afirmaciones más firmes que su respaldo, skew leído en otro vencimiento, RoC de IV30 sin
explicar, bancos 13–15/10 omitidos.

**Corrección:** revisión r2 (`reason=correction`) de `research:2026-09-28-cartera-shadow-contexto-macro` resuelve los cuatro
MAJOR y los MINOR que cambiaban conclusiones. Cambio principal: con las salidas, el riesgo relevante pasa de un techo de
9,5 % a stops del orden de 1,7 % del capital, con la condición de que la API de GaleCore Dev esté levantada en horario de
mercado; la v2 sale por tiempo el 30/10 (expuesta a los resultados del 28–29/10, no al empleo del 06/11). Pendiente:
recheck acotado de r2 (interno o Codex).

**Utilidad (owner):** pendiente — se registra acá, aparte, cuando la evalúes.
