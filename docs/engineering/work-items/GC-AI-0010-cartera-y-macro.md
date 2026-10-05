---
id: GC-AI-0010
title: Contexto de cartera de sólo lectura y análisis macro útil para decisiones reales
status: CLOSED
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: false
review_result: PENDING
approval_result: APPROVED
---

# GC-AI-0010 — Método de contexto de exposición SHADOW (roadmap §4, recorrido C)

> **Cerrado 05/10/2026 como absorbido** (F0-3, WS-0005, ok del owner): su alcance quedó cubierto por las piezas posteriores del roadmap. Sin trabajo pendiente en la rama.

Origen: owner, 27/09/2026 — «Vamos con tus recomendaciones, y usa tastytrade via galecore. IBKR e IOL todavía no».
Alcance vigente tras la reorientación del 27/09 y la revisión aplicada el 28/09: **exposición SHADOW vía GaleCore**,
capital de referencia declarado de 10.000 USD, sin cuenta de bróker. El roadmap §4 fija la secuencia C → H.

## Acuerdo breve

- **Problema:** el informe ya existe, pero el método y las correcciones todavía no se reutilizan de forma demostrada;
  la vista guardada contiene números y texto escritos a mano.
- **Qué vas a poder hacer:** pedir contexto de tu exposición SHADOW, obtener una vista práctica con respaldo trazable,
  corregir el método y comprobar que el análisis siguiente aplica esa corrección sin repetirla.
- **Primera demostración de valor:** retomar antecedentes y correcciones existentes, leer exposición y salidas, elegir
  factores/fuentes y mostrar una vista pequeña con datos nuevos. Puede ser supervisada y parcialmente manual, con ese
  límite visible; no esperar la skill terminada ni la revisión de cierre para comprobar si ayuda.
- **Después de esa prueba:** completar el método versionado y la generación reproducible de registro + vista. Una
  corrección concreta basada en feedback se incorpora al método y se aplica desde otra sesión (roadmap pasos 4–7).
- **Qué falta:** skill concreta, generación de toda la vista desde registro/evidencia y vínculo feedback → versión →
  ejecución posterior. Reutilizar `context_research` y `docs/evidence/gc-ai-0010/vista-practica/`; verificar acceso mínimo
  a las fuentes necesarias. La falta de cuenta de bróker no bloquea esta entrega.
- **Fuera:** cuenta real, recurrencia de este informe (0009 sólo ejecuta `strategy_followup`), asignación automática,
  órdenes, pantallas nuevas y plataforma general de creación de skills.

## Acceptance criteria vigentes (alineados con roadmap C, 28/09)

- [ ] **AC-01 — Exposición comprobada:** posiciones y estado SHADOW por la API de GaleCore, con versión, reglas de salida
  y evidencia. No presentar fills simulados como operaciones reales ni capital de referencia como saldo de cuenta.
- [ ] **AC-02 — Contexto del usuario:** usar el capital declarado y los objetivos disponibles. Los objetivos aún no
  declarados se muestran como faltantes; sólo se preguntan cuando cambian una conclusión concreta, sin inventarlos.
- [ ] **AC-03 — Informe:** exposiciones, factores macro elegidos por ellas con fuentes comprobadas, tipos de afirmación
  separados, «qué merece tu atención»; registro + vista práctica generada por código desde registro/evidencia, sin
  valores o conclusiones de la captura anterior incrustados como si fueran actuales; sin recomendaciones de operar.
- [ ] **AC-04 — Mejora reutilizada:** feedback vinculado a resultado y versión → cambio explícito del método → ejecución
  posterior desde sesión nueva que aplique la corrección. Registrar cuál se aplicó y qué intervención siguió haciendo
  falta. Casos existentes: antecedente pertinente, reglas de salida y formato práctico. No basta guardar el comentario.
- [ ] **AC-05 — Método como skill:** versionado, descubrible por catálogo y ejecutado con datos nuevos; conservar
  procedencia y versión utilizada. H reutiliza este método y su feedback; no se exige aquí una entrada general del host.
- [ ] **AC-06 — Revisión:** interna y Codex; utilidad y cierre, el owner.

Estos criterios sustituyen los originales de cuenta de bróker y recurrencia. No declaran cumplimiento ni cierre.

## Reorientación (owner, 27/09/2026)

Owner: «¿Es necesario que ponga mi cuenta de bróker? Inventame plata y listo si necesitas… lo tengo que conectar en produ
después y tengo 2.5k usd nomás… no te pierdas en eso, acordate del objetivo final».

- **No se vincula la cuenta de bróker ahora.** Queda para cuando se conecte producción.
- **No se inventan posiciones ni saldos** (regla del owner: datos siempre reales). La «cartera» de esta entrega es lo que ya
  está en riesgo con datos reales en GaleCore: las posiciones SHADOW (1.0.3 y la posición remanente de v2). El capital de
  referencia es un **parámetro declarado** por el owner, no un dato de cuenta.
- El contexto macro se elige por esa exposición (puts de SPY a 30–45 días), reutilizando `context_research` y las fuentes con
  acceso comprobado (FRED, FMP, Alpha Vantage).

## Primer informe (28/09/2026, histórico r1; corregido abajo)

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
mercado; la v2 sale por tiempo el 30/10 (expuesta a los resultados del 28–29/10, no al empleo del 06/11).

**Recheck interno de r2:** APPROVE (sin BLOCKER ni MAJOR; 5 MINOR). Los MINOR de hecho se corrigen en r3 (hora de
recuperación de la API 14:59 UTC; vencimiento real que elegiría la 1.0.3 ~04–09/11 con salida ~14–19/10, que pasa por el
CPI; crédito de la 1.0.3 como supuesto; test plan con el diseño de r4; historia del HY OAS a verificar). Revisión técnica
cerrada del lado interno; Codex sobre el informe, opcional si el owner lo pide.

**Utilidad:** ver la evaluación y el estado de formato de la sección siguiente; separada de la revisión técnica.

## Utilidad (owner, 28/09) — registrada aparte de la revisión técnica

Owner, sobre el registro r3: «está muy complicado de leer, los informes de finanzas tienen que ser más prácticos, más
tablas, gráficos, tanto texto se pierde y es difícil entender». **Evaluación: el contenido no le resulta usable en prosa.**

Respuesta: vista práctica derivada del mismo registro y evidencias (sin datos nuevos), publicada como página privada
https://claude.ai/artifact/G7L8oniVGHvQfFupAQzS8R — 4 números clave, «qué mirar» en 4 líneas, tabla de posiciones con sus
salidas, calendario posiciones × eventos, SPY contra strikes, tasas y crédito en pb, tabla de volatilidad, faltantes; el
registro con fuentes queda como respaldo al pie. **Formato práctico aprobado**, según el roadmap y el README de
`docs/evidence/gc-ai-0010/vista-practica/`. Falta evaluar la utilidad de la próxima ejecución reproducible; no volver
a pedir aprobación del formato ya registrado.

Consecuencia para el paso 3 (skill): el método incluye **dos salidas**: el registro trazable (research + evidence) y la
vista del owner (tablas y gráficos, texto mínimo), generada desde el registro. Plantilla HTML y series guardadas en
`docs/evidence/gc-ai-0010/vista-practica/`; tablas y texto siguen siendo manuales. Falta generar todo el contenido desde
el registro/evidencia y comprobar que las correcciones del método se reutilizan.
