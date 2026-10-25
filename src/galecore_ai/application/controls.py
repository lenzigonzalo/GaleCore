"""Declared rules against the controls that really run (WS-0023, P1-PPa §B; WS-0062 inc. 8b).

«¿Qué controla de verdad esta estrategia?» Observed in WS-0022 (C5b): a design recommended approval while six rules
were only declared, among them events and the risk summed with another strategy. Listing what is not executed is not
enough to recommend approval.

Three classes, never mixed:
- ejecutada: GaleCore's runtime blocks or exits by it (the rule is ``supported`` and names the spec fields);
- vigilada: the supervisor reads it and **alerts**; it never blocks an entry and is not presented as if it did;
- sólo declarada: it is written in the proposal and nobody checks it.

The indispensable controls (owner 10/10) are recognised by the spec field that executes them, not by rule ids,
which are each strategy's own, and their state comes from the paths GaleCore reported as executed when the proposal
was checked (``check.coverage``). Since the runtime enforces the cap per bet, the loss brakes and the margin
(WS-0062), approval is recommended when every indispensable is executed and ``risk_limits.simulated_capital_usd``
equals the single simulated amount of the design; a mismatch or a missing amount is not recommended, with the reason.
Deterministic, no model call; the owner approves or not, this only says what is true.
"""

from __future__ import annotations

import json
import math

from galecore_ai.contracts.strategy import RuntimeStatus, StrategyDocument

# What the supervisor reads of an open position and alerts on (supervisor.evaluate / scan). Alerts, never blocks.
SUPERVISED = [
    ("cerca del stop", "aviso cuando la pérdida a mid llega a 1× el crédito"),
    ("sin precio en sesión", "aviso con más de 10 minutos sin valuación"),
    ("dato macro o FOMC antes del vencimiento", "aviso a 2 días hábiles; sin balances de empresas ni feriados"),
    ("riesgo por operación sobre el límite de la spec", "aviso por posición"),
]

# Indispensable controls: (name, spec paths that execute it; any one of them is enough).
INDISPENSABLE = [
    ("riesgo por operación", ("risk_limits.max_loss_per_trade_usd", "risk_limits.max_risk_per_trade_pct")),
    ("tope de posiciones abiertas", ("risk_limits.max_concurrent_positions",)),
    ("stop", ("exits.deterministic.stop_loss",)),
    ("salida por tiempo", ("exits.deterministic.time_exit",)),
    ("tope por apuesta", ("risk_limits.max_bet_pct",)),
    ("freno por pérdida acumulada", ("risk_limits.loss_brakes",)),
    ("margen y capital simulado", ("risk_limits.simulated_capital_usd",)),
]
CAPITAL_PATH = "risk_limits.simulated_capital_usd"

# long_equity (stocks, WS-0061): the position's cost (fixed shares × price) bounds the risk of a trade. Stop and time
# exit are options mechanics (credit, DTE): GaleCore rejects them for stocks, so they are not indispensable there.
EQUITY_RISK_PATHS = ("candidate_construction.sizing.fixed_contracts",)
EQUITY_NOT_INDISPENSABLE = {"stop", "salida por tiempo"}
# Of SUPERVISED, what reads a credit or an expiration and so never fires on a stock position.
OPTIONS_ONLY_SUPERVISED = {"cerca del stop", "dato macro o FOMC antes del vencimiento"}


def is_long_equity(spec: dict) -> bool:
    structure = spec.get("structure") or {}
    return structure.get("default_structure") == "long_equity" or structure.get("allowed_strategies") == ["long_equity"]


def _spec_value(spec: dict, path: str):
    node = spec
    for part in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


def _covers(executed: set[str], path: str) -> bool:
    return any(p == path or p.startswith((path + ".", path + "[")) for p in executed)


def classify(doc: StrategyDocument) -> dict:
    spec = json.loads(doc.spec_json)
    executed = set(doc.check.coverage)   # the spec paths GaleCore reported as executed when the check ran
    rules = []
    for rule in doc.content.rules:
        status = rule.runtime.status
        if status == RuntimeStatus.SUPPORTED:
            cls = "ejecutada"
        elif status == RuntimeStatus.UNSUPPORTED:
            cls = "sólo declarada"
        else:
            cls = "no aplica"
        rules.append({"regla": rule.id, "bloque": rule.block.value, "clase": cls,
                      "como": ", ".join(rule.runtime.spec_paths) if cls == "ejecutada" else rule.runtime.note})
    equity = is_long_equity(spec)
    indispensables = []
    for name, paths in INDISPENSABLE:
        if equity and name in EQUITY_NOT_INDISPENSABLE:
            continue
        if equity and name == "riesgo por operación":
            paths = (*paths, *EQUITY_RISK_PATHS)
        runs = any(_spec_value(spec, q) not in (None, {}, [], False) and _covers(executed, q) for q in paths)
        indispensables.append({"control": name, "estado": "ejecutado" if runs else "no ejecutado por el runtime"})
    missing = [i["control"] + f" ({i['estado']})" for i in indispensables if i["estado"] != "ejecutado"]
    amount = doc.content.simulated_amount_usd
    declared = _spec_value(spec, CAPITAL_PATH)
    if amount is None:   # WS-0043 (1e): the design closes with the amount it is simulated with
        missing.append("monto simulado (falta: el diseño no lo declara)")
    elif not isinstance(declared, int | float) or isinstance(declared, bool):
        missing.append(f"capital de la spec (falta {CAPITAL_PATH}: el diseño simula {amount:g} USD)")
    elif not math.isclose(declared, amount, rel_tol=0, abs_tol=0.005):
        missing.append(f"capital de la spec ({CAPITAL_PATH} = {declared:g} USD no es el monto simulado del diseño, "
                       f"{amount:g} USD: un solo monto)")
    return {
        "estrategia": f"strategy:{doc.name}/{doc.version}", "spec_hash": doc.spec_hash,
        "reglas": rules,
        "vigilancia_del_supervisor": [{"control": c, "como": how, "clase": "vigilada"} for c, how in SUPERVISED
                                      if not (equity and c in OPTIONS_ONLY_SUPERVISED)],
        "indispensables": indispensables,
        "monto_simulado_usd": amount,
        "recomendar_aprobacion": not missing,
        "motivo": ("Todos los controles indispensables los ejecuta el runtime y el capital de la spec es el monto "
                   "simulado." if not missing else
                   "No se recomienda aprobar: faltan controles indispensables ejecutados — " + "; ".join(missing)
                   + ". Aprobar igual es decisión del owner, sabiendo esto."),
    }
