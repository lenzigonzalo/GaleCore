"""Versions of one strategy and duplicating one as a new draft (WS-0098, increment 4).

``list_versions`` is read-only and by code: the stored versions in semantic order with their approval, critique,
feasibility and the existing ``strategy_sheet.diff`` against the previous one. ``duplicate`` stores a copy of a
version under a new name as a draft (saved proposal, no approval, no critique) through ``save_proposal``. ``revise`` (the ficha's «Editar») stores a new version of the same strategy with some
numeric parameters changed: only the paths of ``EDITABLE``; structure (legs, rules) stays in the Lab.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime

from galecore_ai.adapters.strategy_store import StrategyIntegrityError, StrategyStoreError
from galecore_ai.application import feasibility
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.application.strategy import (
    SpecChecker,
    _RawNumber,
    galecore_spec_hash,
    load_proposal,
    save_proposal,
)
from galecore_ai.application.strategy_sheet import diff
from galecore_ai.contracts.regime_record import RecordHost
from galecore_ai.contracts.strategy import STRATEGY_NAME_RE, ProposalContent, other_version_mentions

OPERATIVE_FIELDS = ("purpose", "hypothesis", "rules", "evaluation_plan", "owner_decisions")   # what other_version_mentions reads


def _semver(version: str) -> tuple[int, ...]:
    return tuple(int(x) for x in version.split("."))


def _stored_versions(kb: KnowledgeBase, name: str) -> list[str]:
    return sorted((k.split("/")[1] for k in kb.strategies.versions() if k.split("/")[0] == name), key=_semver)


def list_versions(kb: KnowledgeBase, name: str) -> dict:
    out: list[dict] = []
    previous: str | None = None
    for version in _stored_versions(kb, name):
        key = f"{name}/{version}"
        entry: dict = {"version": version, "ref": f"strategy:{key}"}
        try:
            doc = load_proposal(kb, key)
        except KnowledgeError as exc:
            out.append({**entry, "problem": str(exc)})
            continue
        entry.update({"recorded_at": doc.recorded_at.isoformat(), "spec_hash": doc.spec_hash,
                      "check": doc.check.verdict, "approved": False, "approved_at": None, "critique": None,
                      "critique_why_not": []})
        problems: list[str] = []
        try:
            approval = kb.strategies.load_approval(key)
            if approval is not None and approval.spec_hash == doc.spec_hash:
                entry.update(approved=True, approved_at=approval.recorded_at.isoformat())
        except (StrategyStoreError, StrategyIntegrityError) as exc:
            problems.append(f"approval not usable ({exc})")
        try:
            review = kb.strategies.load_critique(key)
            entry["critique"] = review.content.verdict.value if review else None
            entry["critique_why_not"] = list(review.content.why_not) if review else []
        except (StrategyStoreError, StrategyIntegrityError) as exc:
            problems.append(f"critique not usable ({exc})")
        full = feasibility.assess(json.loads(doc.spec_json), doc.content.simulated_amount_usd)
        entry["factibilidad"] = {"veredicto": full.get("veredicto"), "texto": full.get("texto"),
                                 "limites_usd": full.get("limites_usd")}
        change = doc.content.change
        entry["change"] = {"reason": change.reason if change else None,
                           "from_version": change.from_version if change else None}
        entry["diff_from_previous"] = None
        if previous is not None:
            try:
                d = diff(kb, f"{name}/{previous}", key)
                entry["diff_from_previous"] = {k: v for k, v in d.items() if k != "markdown"}
            except KnowledgeError as exc:
                problems.append(f"diff not available ({exc})")
        if problems:
            entry["problem"] = "; ".join(problems)
        out.append(entry)
        previous = version
    return {"strategy": name, "versions": out}


def _dump(v, indent: int = 0) -> str:
    """Pretty JSON (2 spaces, ASCII) that keeps number literals exactly as read, so the copy hashes like the source."""
    pad, inner = "  " * indent, "  " * (indent + 1)
    if isinstance(v, dict):
        if not v:
            return "{}"
        body = ",\n".join(f"{inner}{json.dumps(k)}: {_dump(x, indent + 1)}" for k, x in v.items())
        return "{\n" + body + "\n" + pad + "}"
    if isinstance(v, list):
        if not v:
            return "[]"
        return "[\n" + ",\n".join(f"{inner}{_dump(x, indent + 1)}" for x in v) + "\n" + pad + "]"
    if isinstance(v, _RawNumber):
        return str(v)
    return json.dumps(v)


def duplicate(*, kb: KnowledgeBase, key: str, new_name: str, host: RecordHost, now: datetime | None = None,
              checker: SpecChecker | None = None) -> tuple[str, str]:
    """Store ``key`` as version 1.0.0 of ``new_name``, a draft: no approval, no critique. Returns (ref, path)."""
    if not STRATEGY_NAME_RE.fullmatch(new_name):
        raise KnowledgeError(f"{new_name!r} is not a valid strategy name (snake_case, 3-64 characters)")
    if _stored_versions(kb, new_name):
        raise KnowledgeError(f"strategy {new_name} already has versions; a duplicate needs a new name")
    src = load_proposal(kb, key)
    now = now or datetime.now(UTC)
    spec = json.loads(src.spec_json, parse_float=_RawNumber, parse_int=_RawNumber)
    ident = spec.get("identity")
    if not isinstance(ident, dict):
        raise KnowledgeError(f"strategy:{key}: its spec has no identity to copy")
    ident.update({"name": new_name, "version": "1.0.0", "id": str(uuid.uuid4()),
                  "created_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "parent_version_hash": src.spec_hash})
    spec["content_hash"] = None   # GaleCore computes it; the file carries null (check_proposal)
    spec_json = _dump(spec) + "\n"
    note = f"Duplicada de strategy:{key} (spec_hash {src.spec_hash}); borrador sin aprobar ni crítica"
    base = src.content.model_dump(mode="json")
    src_name, _, src_version = key.partition("/")
    # Owner decision (10/11): the text that names the original's own version names 1.0.0 in the copy. Only that version,
    # and only in the operative fields the version rule reads; another version named there still refuses the copy.
    rewritten = False
    for field in OPERATIVE_FIELDS:
        text = json.dumps(base[field], ensure_ascii=False)
        changed = re.sub(rf"(?<![\d.]){re.escape(src_version)}(?![\d.])", "1.0.0",
                         text.replace(f"strategy:{src_name}/{src_version}", f"strategy:{new_name}/1.0.0"))
        if changed != text:
            base[field], rewritten = json.loads(changed), True
    if rewritten:
        note += f"; las menciones de la versión {src_version} en el texto se reescribieron como 1.0.0"
    content = ProposalContent.model_validate({**base, "name": new_name, "version": "1.0.0",
                                              "display_name": f"{src.content.display_name} (copia)", "change": None,
                                              "pending": [*src.content.pending, note]})
    if wrong := other_version_mentions(content):
        raise KnowledgeError(f"cannot duplicate strategy:{key} as 1.0.0: its purpose, hypothesis, rules, evaluation "
                             f"plan or owner decisions name the versions {wrong}; only the original's own version is rewritten")
    doc, path = save_proposal(kb=kb, prompt="strategy duplicate", host=host, content=content, spec_json=spec_json,
                              spec_file=f"{new_name}.json", now=now, checker=checker)
    assert galecore_spec_hash(doc.spec_json) == doc.spec_hash
    return f"strategy:{doc.name}/{doc.version}", path


# ── «Editar» de la ficha: parámetros numéricos → versión nueva ─────────────

# (spec path with "/", human label, unit, kind). kind: "number" (>= 0), "integer" (>= 0) or "time" (HH:MM).
EDITABLE: tuple[tuple[str, str, str, str], ...] = (
    ("risk_limits/simulated_capital_usd", "Capital simulado", "USD", "number"),
    ("risk_limits/max_loss_per_trade_usd", "Tope por operación", "USD", "number"),
    ("risk_limits/max_risk_per_trade_pct", "Riesgo por operación", "% del capital", "number"),
    ("risk_limits/max_open_risk_pct", "Riesgo abierto máximo", "% del capital", "number"),
    ("risk_limits/max_bet_pct", "Tope por apuesta", "% del riesgo abierto", "number"),
    ("risk_limits/max_concurrent_positions", "Posiciones a la vez", "", "integer"),
    ("operational/entry_window/start", "Ventana de entrada desde", "hora NY", "time"),
    ("operational/entry_window/end", "Ventana de entrada hasta", "hora NY", "time"),
    ("operational/trade_limits/max_entries_per_day", "Entradas por día", "", "integer"),
    ("candidate_construction/constraints/min_credit", "Crédito mínimo", "USD por contrato", "number"),
    ("candidate_construction/sizing/fixed_contracts", "Contratos", "", "integer"),
    ("exits/deterministic/stop_loss/pct_of_credit", "Corte de pérdida", "% del crédito", "number"),
)
_TIME_RE = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")
_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")


def _lookup(spec, path: str):
    """(found, parent, leaf key) for a "/" path; list segments are indexes."""
    node = spec
    parts = path.split("/")
    for part in parts[:-1]:
        if isinstance(node, dict) and part in node:
            node = node[part]
        elif isinstance(node, list) and part.isdigit() and int(part) < len(node):
            node = node[int(part)]
        else:
            return False, None, None
    leaf = parts[-1]
    if isinstance(node, dict) and leaf in node:
        return True, node, leaf
    return False, None, None


def _editable_entries(spec) -> list[dict]:
    entries = [{"path": p, "label": label, "unit": unit, "kind": kind} for p, label, unit, kind in EDITABLE]
    gates = (((spec.get("entry_filters") or {}).get("gate_layer") or {}).get("gates")) if isinstance(spec, dict) else None
    for i, gate in enumerate(gates if isinstance(gates, list) else []):
        name = (gate.get("label") or gate.get("id")) if isinstance(gate, dict) else None
        entries.append({"path": f"entry_filters/gate_layer/gates/{i}/threshold/value",
                        "label": f"Umbral de {name or f'la regla {i + 1}'}", "unit": "", "kind": "number"})
    return entries


def editable(kb: KnowledgeBase, key: str) -> dict:
    """The editable fields present in this version's spec, with label, unit, kind and current value."""
    doc = load_proposal(kb, key)
    spec = json.loads(doc.spec_json, parse_float=_RawNumber, parse_int=_RawNumber)
    out = []
    for e in _editable_entries(spec):
        found, parent, leaf = _lookup(spec, e["path"])
        if found:
            value = parent[leaf]
            out.append({**e, "value": str(value) if isinstance(value, _RawNumber) else value})
    return {"ref": f"strategy:{key}", "fields": out}


def _new_value(entry: dict, raw, old):
    """Validate ``raw`` against the entry's kind and return what goes in the spec (numbers keep a literal)."""
    label, kind = entry["label"], entry["kind"]
    if isinstance(raw, bool):
        raise KnowledgeError(f"{label}: valor inválido")
    if kind == "time":
        if not isinstance(raw, str) or not _TIME_RE.fullmatch(raw):
            raise KnowledgeError(f"{label}: tiene que ser una hora HH:MM (por ejemplo 13:45)")
        return raw
    if isinstance(raw, str):
        text = raw.strip()
    elif isinstance(raw, int):
        text = str(raw)
    elif isinstance(raw, float):
        text = repr(raw)
    else:
        text = ""
    if kind == "integer":
        text = text.removesuffix(".0")
        if not re.fullmatch(r"\d+", text):
            raise KnowledgeError(f"{label}: tiene que ser un número entero, 0 o más")
        return _RawNumber(text)
    if not _NUMBER_RE.fullmatch(text):
        raise KnowledgeError(f"{label}: tiene que ser un número, 0 o más")
    if "." not in text and isinstance(old, _RawNumber) and "." in old:
        text += ".0"   # same literal style as the field it replaces
    return _RawNumber(text)


def revise(kb: KnowledgeBase, key: str, changes: dict, reason: str, host: RecordHost, now: datetime | None = None,
           checker: SpecChecker | None = None) -> tuple[str, str]:
    """Store a new version of ``key``'s strategy (the greatest stored one + 1 patch) with numeric parameters changed.
    Only ``EDITABLE`` paths present in the spec; never overwrites a version. Returns (ref, path)."""
    if not isinstance(changes, dict) or not changes:
        raise KnowledgeError("no hay cambios para guardar")
    src = load_proposal(kb, key)
    name, _, from_version = key.partition("/")
    now = now or datetime.now(UTC)
    spec = json.loads(src.spec_json, parse_float=_RawNumber, parse_int=_RawNumber)
    ident = spec.get("identity")
    if not isinstance(ident, dict):
        raise KnowledgeError(f"strategy:{key}: its spec has no identity to revise")
    allowed = {e["path"]: e for e in _editable_entries(spec)}
    major, minor, patch = _semver(_stored_versions(kb, name)[-1])
    version = f"{major}.{minor}.{patch + 1}"
    lines: list[str] = []
    for path, raw in changes.items():
        entry = allowed.get(path)
        if entry is None:
            raise KnowledgeError(f"{path}: este parámetro no se edita desde la ficha")
        found, parent, leaf = _lookup(spec, path)
        if not found:
            raise KnowledgeError(f"{entry['label']}: esta estrategia no tiene ese parámetro")
        old = parent[leaf]
        new = _new_value(entry, raw, old)
        parent[leaf] = new
        unit = f" {entry['unit']}" if entry["unit"] else ""
        lines.append(f"{entry['label']}: {'sin definir' if old is None else old} → {new}{unit}")
    ident.update({"version": version, "created_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "parent_version_hash": src.spec_hash})
    spec["content_hash"] = None   # GaleCore computes it; the file carries null (check_proposal)
    spec_json = _dump(spec) + "\n"
    text = "; ".join(lines) + (f". {reason.strip()}" if reason and reason.strip() else "")
    base = src.content.model_dump(mode="json")
    content = ProposalContent.model_validate({**base, "version": version, "change": {
        "from_version": from_version, "reason": text, "refs": [f"strategy:{key}"]}})
    if wrong := other_version_mentions(content):
        raise KnowledgeError(f"cannot revise strategy:{key} as {version}: its purpose, hypothesis, rules, evaluation "
                             f"plan or owner decisions name the versions {wrong}")
    doc, path = save_proposal(kb=kb, prompt="strategy revise", host=host, content=content, spec_json=spec_json,
                              spec_file=src.spec_file, now=now, checker=checker)
    assert galecore_spec_hash(doc.spec_json) == doc.spec_hash
    return f"strategy:{doc.name}/{doc.version}", path
