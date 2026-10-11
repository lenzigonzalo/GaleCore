"""Declared rules against the controls that really run (WS-0023, P1-PPa §B).

«¿Qué controla de verdad esta estrategia?» Observed in WS-0022 (C5b): a design recommended approval while six rules
were only declared, among them events and the risk summed with another strategy. Listing what is not executed is not
enough to recommend approval.

Three classes, never mixed:
- ejecutada: GaleCore's runtime blocks or exits by it (the rule is ``supported`` and names the spec fields);
- vigilada: the supervisor reads it and **alerts**; it never blocks an entry and is not presented as if it did;
- sólo declarada: it is written in the proposal and nobody checks it.

The indispensable controls (owner 10/10) are recognised by the spec field that executes them, not by rule ids,
which are each strategy's own. Approval is recommended only when every indispensable is executed; today the cap per
bet is watched (alert) and the cumulative-loss brake has no runtime support, so the answer says so instead of
recommending. Deterministic, no model call; the owner approves or not, this only says what is true.
"""

from __future__ import annotations

import json

from galecore_ai.contracts.strategy import RuntimeStatus, StrategyDocument

# What the supervisor reads of an open position and alerts on (supervisor.evaluate / scan). Alerts, never blocks.
SUPERVISED = [
    ("cerca del stop", "aviso cuando la pérdida a mid llega a 1× el crédito"),
    ("sin precio en sesión", "aviso con más de 10 minutos sin valuación"),
    ("dato macro o FOMC antes del vencimiento", "aviso a 2 días hábiles; sin balances de empresas ni feriados"),
    ("riesgo por operación sobre el límite de la spec", "aviso por posición"),
    ("tope por apuesta del perfil", "aviso cuando una apuesta (subyacente, dirección y semana) supera el tope"),
]

# Indispensable controls: (name, spec path that executes it, or None when the runtime has none).
INDISPENSABLE = [
    ("riesgo por operación", "risk_limits.max_loss_per_trade_usd"),
    ("tope de posiciones abiertas", "risk_limits.max_concurrent_positions"),
    ("stop", "exits.deterministic.stop_loss"),
    ("salida por tiempo", "exits.deterministic.time_exit"),
    ("tope por apuesta", None),            # watched by the supervisor (alert), not executed by the runtime
    ("freno por pérdida acumulada", None),  # no runtime support (no drawdown measure that pauses entries)
]
WATCHED_INDISPENSABLE = {"tope por apuesta"}


def _spec_value(spec: dict, path: str):
    node = spec
    for part in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


def classify(doc: StrategyDocument) -> dict:
    spec = json.loads(doc.spec_json)
    rules, executed_paths = [], set()
    for rule in doc.content.rules:
        status = rule.runtime.status
        if status == RuntimeStatus.SUPPORTED:
            cls = "ejecutada"
            executed_paths.update(rule.runtime.spec_paths)
        elif status == RuntimeStatus.UNSUPPORTED:
            cls = "sólo declarada"
        else:
            cls = "no aplica"
        rules.append({"regla": rule.id, "bloque": rule.block.value, "clase": cls,
                      "como": ", ".join(rule.runtime.spec_paths) if cls == "ejecutada" else rule.runtime.note})
    indispensables = []
    for name, path in INDISPENSABLE:
        if path is None:
            state = ("vigilado (aviso, no bloquea; si el perfil declara sus límites)" if name in WATCHED_INDISPENSABLE
                     else "no ejecutado por el runtime")
        else:
            runs = _spec_value(spec, path) not in (None, {}, False) and any(
                p == path or p.startswith(path + ".") for p in executed_paths)
            state = "ejecutado" if runs else "no ejecutado por el runtime"
        indispensables.append({"control": name, "estado": state})
    missing = [i["control"] + f" ({i['estado']})" for i in indispensables if i["estado"] != "ejecutado"]
    return {
        "estrategia": f"strategy:{doc.name}/{doc.version}", "spec_hash": doc.spec_hash,
        "reglas": rules,
        "vigilancia_del_supervisor": [{"control": c, "como": how, "clase": "vigilada"} for c, how in SUPERVISED],
        "indispensables": indispensables,
        "recomendar_aprobacion": not missing,
        "motivo": ("Todos los controles indispensables los ejecuta el runtime." if not missing else
                   "No se recomienda aprobar: faltan controles indispensables ejecutados — " + "; ".join(missing)
                   + ". Aprobar igual es decisión del owner, sabiendo esto."),
    }
