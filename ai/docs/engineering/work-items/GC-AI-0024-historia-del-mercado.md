---
id: GC-AI-0024
title: La historia del mercado (+ inventario de tools y consumo por capacidad)
status: CLOSED
implementer: claude-code
reviewer: internal
approver: user
feature_freeze: false
closure_blocked: false
review_result: APPROVED
approval_result: APPROVED
---

# GC-AI-0024 — La historia del mercado

Pieza 1 del plan vigente (roadmap §4 «Plan para cerrar el harness», owner 04/10). Rama `feature/GC-AI-0024` desde
`main` (`4a78cd6`).

## Para qué (acuerdo)

- **Problema:** el valor del trader está en entender qué historia está priceando hoy el mercado y darse cuenta rápido
  cuando cambia. Hoy hay piezas sueltas (régimen, GEX, calendario, `context_research`, `market_watch`) pero nadie las
  junta en una lectura diaria ni la compara con la de ayer.
- **Qué vas a poder hacer:** pedir «¿qué historia está priceando el mercado?» (o leer la del día, que corre sola
  después del cierre) y ver: la historia en una frase, qué la sostiene (macro y calendario, precio, volatilidad,
  posicionamiento: GEX, skew, VIX/VVIX, estructura de IV), qué se le está ofreciendo al retail, y **si cambió frente a
  la anterior y en qué**. Aparece en la pantalla Agentes del monitor como un agente más.
- **Base que arrastra:** (a) **inventario** legible de lo que hay — capacidades con su modelo, fuentes de datos y
  conectores del host con para qué sirven y cuándo se usan (BL-006 mínimo); (b) **modelo y consumo por capacidad**:
  cada corrida con modelo registra tokens y duración, y el inventario muestra cuánto gasta cada una. Juntar es código
  (sin modelo); interpretar es modelo.
- **Primera demostración:** una corrida real de la historia de SPY con los datos del viernes 02/10 guardada en
  `knowledge/`, una segunda corrida que la compara, y el inventario con el consumo de esas corridas.
- **Fuera:** fuentes nuevas (CBOE/Tesoro/EDGAR/BLS siguen en BL-017; si la lectura las pide, se declara), noticias
  de la web, otros mercados, avisos al celular, la estrategia como proyecto (pieza 2) y el contraste con la cartera
  (pieza 3).

## Acceptance criteria

- [x] **AC-01 — Consumo registrado:** `model_run.usage_of` + `tasks._tokens`; tests
  `test_the_client_keeps_the_tokens_the_run_reports`, `test_the_run_records_its_tokens_including_the_correction_round`,
  `test_consumption_is_per_capability_and_averages_only_runs_with_tokens`. En vivo: las corridas del 04/10 guardaron
  tokens (p. ej. salida 5 635, caché 33 771, 3 turnos de Opus).
- [x] **AC-02 — Inventario:** `inventory [--json]` (`application/inventory.py`, `config/host_connectors.yaml`); tests
  en `test_inventory.py`. El calendario macro pasó a `covers` de GaleCore (GC-0006 ya lo sirve).
- [x] **AC-03 — Juntar en código:** `story pack` (`application/story.py`): precios y variaciones de SPY, QQQ, IWM,
  TLT, HYG, UUP, GLD y USO; VIX9D/VIX/VIX3M/VVIX y estructura; skew, estructura de IV, IV rank, IV vs HV y GEX de SPY;
  calendario macro (próximas 2 semanas y última semana) y FOMC; diferencia con el paquete anterior. Tests en
  `test_story.py`. En vivo: 2 min sin GEX; el GEX global de GaleCore no responde en fin de semana (>240 s) y queda en
  `missing`.
- [x] **AC-04 — La historia:** `market_story` en el catálogo + skill 0.1.1 (`catalog --check` limpio; `catalog
  --match` la elige para «¿qué historia está priceando el mercado?», «¿cambió la narrativa?», «¿está con miedo?»).
  En vivo: `research:2026-10-04-historia-del-mercado-spy` r2 (primera historia) y r3 (comparada: «no cambió»).
- [x] **AC-05 — Corre sola:** tarea `historia-del-mercado` L–V 17:15 America/New_York; el runner junta el paquete
  antes del modelo (que no puede escribirlo) y se lo pasa en el prompt. Bug real arreglado: dentro de `task run` el
  paquete no se juntaba (event loop ya corriendo; test que lo reproduce). Se reapunta a `main` al integrar.
- [x] **AC-06 — Suite y revisión interna:** `pytest tests/unit` 1014 y ruff limpios; revisión interna abajo.
- [x] **AC-07 — Cierre:** owner, 04/10 (ver «Cierre»).

## Límites

- Sin noticias ni narrativa de medios en la corrida programada (no hay conectores ahí); queda en `missing`.
- Rendimientos y spreads de crédito se leen por ETFs (TLT, HYG); IV rank con historia desde el 21/09.
- GEX: depende de que GaleCore lo calcule a tiempo (240 s); en fin de semana no se pide (no llega).
- El estado de los conectores es el que mostró el host el 04/10, no una comprobación en vivo.

## Revisión interna (04/10)

CHANGES_REQUESTED (0 BLOCKER, 2 MAJOR). Arreglados con test: el % de cambio frente al paquete anterior invertía el
signo sobre una base negativa (net GEX) y ahora se omite; un GEX vacío entraba como ceros y ahora va a `missing`.
MINOR arreglados: sin paquete no se llama al modelo (FAILED, sin gastar la corrida); la vela del día no cuenta como
cierre antes de las 16:15 ET; cero no cuenta como cambio de signo; el tope HTTP del dispatcher (120 s por defecto)
queda documentado junto al de 240 s. Quedan como límites: `history` del IV rank se asume ascendente (así lo devuelve
GaleCore); estados de conectores fijos al 04/10. Recheck acotado: no corrido (correcciones chicas, cubiertas por tests).

## Cierre

**CLOSED por el owner el 04/10/2026** («ok, cerrá GC-AI-0024 y el lote pendiente»), en lote con GC-AI-0019…0024.
Revisión: interna (con sus arreglos registrados arriba); sin Codex. Demos reemplazadas por ejemplos internos y corridas
reales (regla del 03/10).
