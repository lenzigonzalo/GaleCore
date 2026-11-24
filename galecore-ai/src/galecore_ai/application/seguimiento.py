"""Seguimiento (WS-0107, D-0017): a strategy whose ficha is ready, accepted by the trader, that GaleCore watches.

Activating turns each watchable entry/invalidation rule of the ficha into a supervisor rule (``watch``) tied to the
strategy with a role. The supervisor's pass (code, every 5 minutes in session, 0 tokens) evaluates them and, for
each, appends one line to ``<kb>/strategies/<name>/runs.jsonl`` (not_met | met | failed). A failed read raises its own
alert, apart from the rule's; a met invalidation raises its alert, stops the other rules and leaves the strategy
«invalidada». ``explain`` rebuilds from those lines and the market clock why the entry did or did not happen.
No model takes part in any of this.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from galecore_ai.application import watch
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.application.market_clock import NEW_YORK, session
from galecore_ai.contracts.strategy import (
    Block,
    RuntimeStatus,
    Stage,
    StrategyDocument,
    compute_document_hash,
)
from galecore_ai.contracts.supervision import (
    OPTIONS,
    Alert,
    AlertKind,
    WatchCancel,
    WatchCondition,
    WatchRule,
)

ENTRY, INVALIDATION = "entry", "invalidation"
ROLE_LABEL = {ENTRY: "entrada", INVALIDATION: "invalidación"}
CADENCE = {"cada": "5 minutos, sólo en rueda (el reloj de mercado decide)", "quien": "regla en código del supervisor",
           "tokens": 0}


def _dir(kb: KnowledgeBase, name: str) -> Path:
    return kb.base / "strategies" / name


def _version_key(version: str) -> tuple[int, ...]:
    return tuple(int(x) for x in version.split("."))


def latest(kb: KnowledgeBase, name: str) -> StrategyDocument | None:
    """The newest stored version of ``name`` (by version number), or None."""
    keys = [k for k in kb.strategies.versions() if k.split("/")[0] == name]
    if not keys:
        return None
    return kb.strategies.load(max(keys, key=lambda k: _version_key(k.split("/")[1])))


def _activation_path(kb: KnowledgeBase, name: str, version: str) -> Path:
    return _dir(kb, name) / f"{version}.activation.json"


def _invalidated_path(kb: KnowledgeBase, name: str, version: str) -> Path:
    return _dir(kb, name) / f"{version}.invalidated.json"


def _read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_once(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {**data, "content_hash": compute_document_hash(data)}
    with path.open("x", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def activations(kb: KnowledgeBase, name: str) -> list[dict]:
    """Every activation of ``name``, oldest first."""
    out = [a for p in sorted(_dir(kb, name).glob("*.activation.json")) if (a := _read(p))]
    return sorted(out, key=lambda a: a["activated_at"])


def current(kb: KnowledgeBase, name: str) -> dict | None:
    """The latest activation, with ``invalidated`` (its marker, or None). None when it was never activated."""
    acts = activations(kb, name)
    if not acts:
        return None
    last = acts[-1]
    return {**last, "invalidated": _read(_invalidated_path(kb, name, last["version"]))}


def is_active(kb: KnowledgeBase, name: str) -> bool:
    """In Seguimiento: activated, not invalidated, and at least one of its rules still watched or already met."""
    cur = current(kb, name)
    if cur is None or cur["invalidated"] is not None:
        return False
    return any(r.id in cur["rules"] and watch.status(kb, r) in ("active", "met") for r in watch.rules(kb))


def role_rules(kb: KnowledgeBase, name: str) -> list[WatchRule]:
    return [r for r in watch.rules(kb) if r.role and name in r.strategies]


def refuse_unactivated(kb: KnowledgeBase, names: list[str]) -> None:
    """``supervise watch --strategy X`` for a ficha that is not yet a complete SHADOW proposal and is not in
    Seguimiento: the aviso of a strategy is created by activating it, after the trader's yes (D-0017)."""
    for name in names:
        doc = latest(kb, name)
        if doc is not None and doc.content.stage != Stage.COMPLETE and not is_active(kb, name):
            raise KnowledgeError(f"{name} no está activa en Seguimiento: sus avisos se crean con `strategy activate "
                                 f"{name} --mode seguimiento` después de que el trader acepte las reglas, no con "
                                 "`supervise watch`")


# ── activate ─────────────────────────────────────────────────────


def activate(kb: KnowledgeBase, name: str, *, words: str, prompt: str, now: datetime | None = None) -> dict:
    """Accept the ficha and start watching. The activation is the trader's acceptance: it keeps their words, the
    version and the hash. Needs the newest version in stage ``ready``, one watchable entry rule and an invalidation
    rule (watchable, or declared unsupported with its reason). A new version cancels the previous version's avisos."""
    now = now or datetime.now(UTC)
    if not words.strip() or not prompt.strip():
        raise KnowledgeError("activar guarda las palabras del trader y su pedido (--text, --prompt)")
    doc = latest(kb, name)
    if doc is None:
        raise KnowledgeError(f"no hay estrategia {name} en la base")
    c = doc.content
    if c.stage != Stage.READY:
        raise KnowledgeError(f"{name} {c.version} está en etapa {c.stage.value}: para activar tiene que estar en «ready» "
                             "(reglas aceptadas por el trader, última versión)")
    if _activation_path(kb, name, c.version).exists():
        raise KnowledgeError(f"{name} {c.version} ya fue activada")
    if not [r for r in c.rules if r.block == Block.ENTRY and r.watch]:
        raise KnowledgeError(f"{name} {c.version}: falta al menos una regla de entrada con condición vigilable (watch)")
    bad = [r.id for r in c.rules if r.block == Block.INVALIDATION and not r.watch
           and r.runtime.status != RuntimeStatus.UNSUPPORTED]
    if bad:
        raise KnowledgeError(f"{name} {c.version}: la invalidación {bad} no tiene condición vigilable: declarala con "
                             "runtime no soportado y su motivo")
    watchable = [(r, ENTRY if r.block == Block.ENTRY else INVALIDATION) for r in c.rules
                 if r.watch and r.block in (Block.ENTRY, Block.INVALIDATION)]
    old = [r for r in role_rules(kb, name) if watch.status(kb, r, now) == "active"]
    old_ids = {r.id for r in old}
    taken = {(r.symbol, r.metric, r.condition, r.threshold) for r in watch.rules(kb)
             if r.id not in old_ids and watch.status(kb, r, now) == "active" and not r.instance_id}
    clash = [r.id for r, _ in watchable
             if (r.watch.symbol, r.watch.metric, r.watch.condition, r.watch.threshold) in taken]
    if clash:
        raise KnowledgeError(f"ya hay un aviso activo con la misma condición que {clash}: cancelalo antes de activar")
    for rule in old:
        watch.cancel(kb, rule.id, words=f"nueva versión {c.version} activada", prompt=prompt, now=now)
    created = [(watch.add_seguimiento(kb, name, r, role, words=words, prompt=prompt, now=now), role)
               for r, role in watchable]
    not_running = [{"rule": r.id, "text": r.text, "reason": r.runtime.note or "sin condición vigilable"}
                   for r in c.rules if r.block in (Block.ENTRY, Block.INVALIDATION) and not r.watch]
    _write_once(_activation_path(kb, name, c.version),
                {"kind": "strategy_activation", "mode": "seguimiento", "strategy_ref": f"strategy:{name}/{c.version}",
                 "name": name, "version": c.version, "proposal_hash": doc.content_hash, "activated_at": now.isoformat(),
                 "owner_words": words, "prompt": prompt, "rules": [r.id for r, _ in created],
                 "cancelled": sorted(old_ids), "not_running": not_running})
    return {"status": "ACTIVA", "ref": f"strategy:{name}/{c.version}", "modo": "seguimiento",
            "avisos": [{"rule": r.id, "rol": ROLE_LABEL[role], "vigila": watch.describe(r)} for r, role in created],
            "reglas_que_no_corren": not_running, "avisos_de_la_version_anterior_cancelados": sorted(old_ids),
            "cadencia": CADENCE}


# ── what the supervisor's pass leaves ────────────────────────────


def note_run(kb: KnowledgeBase, rule: WatchRule, now: datetime, outcome: str, value: float | None,
             reason: str = "") -> None:
    """One line per pass and rule of a strategy in Seguimiento (outcome: not_met | met | failed)."""
    if not rule.role or not rule.strategies:
        return
    line = {"at": now.isoformat(), "rule": rule.id, "role": rule.role, "outcome": outcome, "value": value,
            "threshold": rule.threshold}
    if reason:
        line["reason"] = reason
    path = _dir(kb, rule.strategies[0]) / "runs.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(line, ensure_ascii=False) + "\n")


def runs(kb: KnowledgeBase, name: str) -> list[dict]:
    path = _dir(kb, name) / "runs.jsonl"
    if not path.is_file():
        return []
    out = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(raw))
        except ValueError:
            continue
    return out


def _seal(alert: Alert) -> Alert:
    return alert.model_copy(update={"content_hash": compute_document_hash(alert.hashable_content())})


def _ref(kb: KnowledgeBase, name: str) -> str | None:
    cur = current(kb, name)
    return cur["strategy_ref"] if cur else None


def failure_alert(kb: KnowledgeBase, rule: WatchRule, reason: str, now: datetime) -> Alert:
    """A rule of a strategy that could not be read: health, apart from the rule's own alert. One per rule and day."""
    name, day = rule.strategies[0], now.astimezone(NEW_YORK).date().isoformat()
    slug = rule.id.split("-", 3)[-1]
    return _seal(Alert(
        id=f"{day}-watch-fail-{rule.role[:3]}-{slug}"[:80], key=f"watch-fail:{rule.id}:{day}", kind=AlertKind.WATCH,
        strategy=name, strategy_ref=_ref(kb, name), instance_id="", position_id=rule.id, detected_at=now,
        motivo=f"Falló la lectura de la regla de {ROLE_LABEL[rule.role]} de {name} ({watch.describe(rule)}): "
               f"{reason}. En esta pasada no se evaluó.",
        dato={"salud": "falló", "regla": rule.id, "rol": rule.role, "motivo_de_la_falla": reason[:200]},
        regla=f"Pedido del trader al activar {name}: «{rule.words}» ({rule.created_at:%d/%m})",
        propuesta="Es una falla del sistema, no una señal: se reintenta en la próxima pasada. Si sigue, revisá GaleCore.",
        options=OPTIONS[AlertKind.WATCH], sources=[]))


def met_alert(kb: KnowledgeBase, rule: WatchRule, value: float, now: datetime, path: str) -> Alert:
    name = rule.strategies[0]
    if rule.role == INVALIDATION:
        motivo = f"{name} quedó invalidada: {watch.describe(rule)}, ahora {watch._fmt(value)}."
        propuesta = ("Se dejaron de vigilar los demás avisos de la estrategia. Si la idea sigue en pie, hay que "
                     "re-armarla: una versión nueva de la ficha y activarla otra vez.")
    else:
        motivo = f"{name}: se dio la regla de entrada ({watch.describe(rule)}), ahora {watch._fmt(value)}."
        propuesta = "Evaluá la entrada con la ficha a la vista; operar lo decidís vos. Este aviso deja de vigilarse."
    return _seal(Alert(
        id=f"{now.date().isoformat()}-watch-{rule.role[:3]}-{rule.id.split('-', 3)[-1]}"[:80], key=f"watch:{rule.id}",
        kind=AlertKind.WATCH, strategy=name, strategy_ref=_ref(kb, name), instance_id="", position_id=rule.id,
        detected_at=now, motivo=motivo,
        dato={"symbol": rule.symbol, "metrica": rule.metric.value, "value": value, "threshold": rule.threshold,
              "condition": rule.condition.value, "rol": rule.role},
        regla=f"Pedido del trader al activar {name}: «{rule.words}» ({rule.created_at:%d/%m})",
        propuesta=propuesta, options=OPTIONS[AlertKind.WATCH], sources=[path.split("?")[0]]))


def invalidate(kb: KnowledgeBase, rule: WatchRule, value: float, now: datetime) -> list[str]:
    """The invalidation held: mark the strategy and cancel its other active avisos. Returns the cancelled rule ids."""
    name = rule.strategies[0]
    cur = current(kb, name)
    if cur is not None and cur["invalidated"] is None:
        _write_once(_invalidated_path(kb, name, cur["version"]),
                    {"kind": "strategy_invalidated", "strategy_ref": cur["strategy_ref"], "at": now.isoformat(),
                     "rule": rule.id, "value": value})
    stopped = []
    for other in role_rules(kb, name):
        if other.id != rule.id and watch.status(kb, other, now) == "active":
            watch.cancel(kb, other.id, words="invalidación cumplida", prompt=f"{name} quedó invalidada", now=now)
            stopped.append(other.id)
    return stopped


# ── explain ──────────────────────────────────────────────────────


def _at(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)


def _closeness(rule: WatchRule, line: dict) -> float:
    """How far this reading was from the rule's level, on the side that matters (<= 0 means it was met)."""
    value, level = line["value"], rule.threshold
    return level - value if rule.condition == WatchCondition.ABOVE else value - level


def _cancelled_at(kb: KnowledgeBase, rule: WatchRule) -> datetime | None:
    data = _read(watch._cancel_path(kb, rule.id))
    return WatchCancel.model_validate(data).at if data else None


def explain(kb: KnowledgeBase, name: str, now: datetime | None = None) -> dict:
    """«¿Por qué no entré?»: from the activation, the runs and the market clock. Code only, no model."""
    now = now or datetime.now(UTC)
    cur = current(kb, name)
    if cur is None:
        raise KnowledgeError(f"{name} nunca se activó en Seguimiento: no hay corridas que explicar")
    rules = {r.id: r for r in watch.rules(kb) if r.id in cur["rules"]}
    start = _at(cur["activated_at"])
    inv = cur["invalidated"]
    cancels = [t for r in rules.values() if (t := _cancelled_at(kb, r))]
    if inv:
        end, state = _at(inv["at"]), "invalidada"
    elif rules and all(watch.status(kb, r, now) == "cancelled" for r in rules.values()):
        end, state = max(cancels), "cancelada"
    else:
        end, state = now, "vigilando"
    lines = [x for x in runs(kb, name) if x.get("rule") in rules]
    valid = [x for x in lines if x["outcome"] in ("met", "not_met")]
    entries = []
    for rule in (r for r in rules.values() if r.role == ENTRY):
        mine = [x for x in valid if x["rule"] == rule.id]
        hit = next((x for x in mine if x["outcome"] == "met"), None)
        near = min(mine, key=lambda x: abs(_closeness(rule, x)), default=None)
        reading = None
        if near is not None:
            dist = _closeness(rule, near)
            reading = {"value": near["value"], "at": near["at"], "distancia": round(dist, 4),
                       "distancia_pct": round(dist / abs(rule.threshold) * 100, 2) if rule.threshold else None}
        entries.append({"rule": rule.id, "vigila": watch.describe(rule), "cumplida": hit is not None,
                        "cuando": hit["at"] if hit else None, "lectura_mas_cercana": reading,
                        "lecturas_validas": len(mine)})
    inv_rule = next((r for r in rules.values() if r.role == INVALIDATION), None)
    inv_hit = next((x for x in valid if x["role"] == INVALIDATION and x["outcome"] == "met"), None)
    read_days = {_at(x["at"]).astimezone(NEW_YORK).date() for x in valid}
    gaps, day = [], start.astimezone(NEW_YORK).date()
    while day <= end.astimezone(NEW_YORK).date():
        sess = session(day)
        if sess and start < sess[1] <= end and day not in read_days:
            gaps.append(day.isoformat())
        day += timedelta(days=1)
    failures: dict[tuple, dict] = {}
    for x in lines:
        if x["outcome"] == "failed":
            day_s = _at(x["at"]).astimezone(NEW_YORK).date().isoformat()
            f = failures.setdefault((day_s, x["rule"], x.get("reason", "")),
                                    {"dia": day_s, "rule": x["rule"], "motivo": x.get("reason", ""), "veces": 0,
                                     "primera": x["at"]})
            f["veces"] += 1
            f["ultima"] = x["at"]
    activated = {a["version"]: a["activated_at"] for a in activations(kb, name)}
    versions = []
    for key in sorted((k for k in kb.strategies.versions() if k.split("/")[0] == name),
                      key=lambda k: _version_key(k.split("/")[1])):
        doc, version = kb.strategies.load(key), key.split("/")[1]
        versions.append({"version": version, "guardada": doc.recorded_at.isoformat(), "etapa": doc.content.stage.value,
                         "activada": activated.get(version)})
    return {"strategy": name, "version_activa": cur["version"], "estado": state, "activada": cur["activated_at"],
            "hasta": end.isoformat(), "versiones": versions, "entrada": entries,
            "invalidacion": {"rule": inv_rule.id if inv_rule else None, "cumplida": bool(inv or inv_hit),
                             "cuando": inv["at"] if inv else (inv_hit["at"] if inv_hit else None)},
            "huecos": {"ruedas_sin_lectura_valida": gaps, "fallas": list(failures.values())},
            "reglas_que_no_corren": cur["not_running"], "lecturas_validas": len(valid)}
