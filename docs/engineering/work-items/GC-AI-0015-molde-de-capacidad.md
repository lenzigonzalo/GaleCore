---
id: GC-AI-0015
title: Molde de capacidad y guía para crearla (base del harness, entrega 3)
status: DRAFT
implementer: claude-code
reviewer: codex
approver: user
feature_freeze: false
closure_blocked: true
review_result: PENDING
approval_result: PENDING
---

# GC-AI-0015 — Molde de capacidad y guía para crearla

Roadmap §4, Parte 1, entrega 3 («Secuencia autorizada», owner 29/09). Primer caso: «¿Qué merece mi atención hoy?» sobre
la exposición SHADOW. Avanza mientras GC-AI-0008/0009 esperan evidencia externa.

## Acuerdo breve

- **Para qué:** que una capacidad nueva se cree con un formato único y validado, en vez de armarse a mano y a su manera
  como las 9 actuales, y que lo que no se pudo completar (una fuente sin acceso, un dato sin fuente) quede declarado.
- **Capacidad que agrega:** un molde (qué pedido atiende, qué datos necesita y de qué fuentes del mapa salen, salida,
  controles, dónde se guarda, versión), una validación que rechaza una capacidad incompleta, y una guía que lleva de un
  pedido tuyo a la entrada de catálogo y su método.
- **Qué vas a poder pedir:** «Quiero una capacidad que me diga qué merece mi atención hoy».
- **Cómo veremos que sirve:** la capacidad «atención diaria» se crea con la guía, pasa la validación, queda listada en el
  catálogo, y una sesión nueva la corre con datos reales, tu perfil y las fuentes del mapa, declarando lo que falta.
- **Comparado con hoy:** el host puede contestar esa pregunta a mano (lo hizo en las demos de GC-AI-0013), pero cada vez
  decide qué mirar; nada garantiza que la próxima corrida mire lo mismo ni que se note lo que faltó.

## Reutiliza (existe)

- Catálogo y su validación (`harness/catalog.py`, `config/catalog.yaml`), skills (`skill_loader`), contratos, evidencia.
- Registro de fuentes con orden por tipo de uso (GC-AI-0012/0014) y perfil versionado con cita obligatoria (GC-AI-0013).
- Seguimiento de la estrategia SHADOW (`followup run`, GC-AI-0008/0009): exposición, evaluaciones, posiciones y reglas.
- Contexto de una idea (`context_research`, GC-AI-0007) y material de GC-AI-0010 (cartera y macro), sin reabrir su informe.

## Fuentes: qué falla hoy y si bloquea el primer caso (0b, owner 29/09)

Consultas reales contra el registro de `main` (29/09), con los datos que usaron las demos del primer caso:

| Necesidad del caso | Resultado del registro | ¿Bloquea? |
|---|---|---|
| Posiciones, evaluaciones y métricas SHADOW | Faltante | **Sí, para la validación del molde:** el dato existe y se lee con `followup run` (API `App/Runtime/*`), pero el mapa no lo declara |
| Tasa real, spread de crédito high yield | Faltante | **Sí, degrada:** FRED las sirve (las demos usaron `DFII10` y `BAMLH0A0HYM2`), pero la descripción de FRED no las nombra y una sesión que sigue la regla las declararía faltantes |
| Volatilidad implícita y realizada, velas de SPY | Faltante | No: GaleCore las tiene por rutas que el código no llama; el caso usa lo guardado y lo declara faltante si no está fresco |
| Calendario económico, fecha del FOMC | Faltante | No: faltante real (el calendario de FMP está denegado por plan); se declara, como hicieron las demos |
| Cotizaciones, VIX, VVIX, GEX, skew, curva, inflación, earnings | Resuelven | — |

Sólo entran en este item las dos primeras filas. No se abre una ampliación general del registro.

## Non-goals

- Ampliación general de fuentes; registrar nuevas rutas de GaleCore en el código.
- Correr y guardar cualquier capacidad de forma uniforme con feedback (entrega 4), programarla (entrega 5), pedirla sin
  nombrarla (entrega 6).
- Cuenta real, análisis de capital disponible y alertas de posiciones (pasos posteriores). Órdenes reales: fuera del
  alcance actual.

## Acceptance criteria

- [ ] **AC-01 — Molde:** cada entrada del catálogo declara sus necesidades de datos, cada una resuelta contra el registro
  de fuentes o marcada faltante con motivo; las entradas existentes quedan declaradas con el mismo formato.
- [ ] **AC-02 — Validación:** `catalog check` rechaza una capacidad incompleta (skill o contrato ausentes, flujo con
  comandos que la CLI no tiene, una necesidad que no resuelve ni está declarada faltante, controles sin decir qué no se
  verifica) y lista qué falta.
- [ ] **AC-03 — Guía:** skill que lleva de un pedido a la entrada de catálogo y su skill, consultando el registro y el
  perfil, y termina con `catalog check` en verde o con lo pendiente declarado.
- [ ] **AC-04 — Fuentes del primer caso:** el registro declara el runtime SHADOW de GaleCore (vía `followup run`) y las
  tasas reales y spreads de crédito de FRED; nada más.
- [ ] **AC-05 — Primer caso:** capacidad `daily_attention` («¿Qué merece mi atención hoy?») creada con la guía: exposición
  SHADOW, reglas de la estrategia, cambios desde la última revisión, contexto y faltantes; perfil citado.
- [ ] **AC-06 — Demostración:** sesión nueva corre la capacidad con datos reales (GaleCore Dev arriba) y guarda el
  resultado; transcripción archivada.
- [ ] **AC-07 — Revisión:** interna y Codex; utilidad y cierre, el owner.

## Required validation

```powershell
python tools/engineering_gate.py
python -B -m pytest -q -p no:cacheprovider
python -B -m ruff check --no-cache .
git diff --check
```
