"""Strategy and portfolio as a project (GC-AI-0026): everything about one strategy, or the portfolio, in one view.

The view reads what already exists — versions and approvals, follow-ups, investigations, feedback, the profile — and
adds the owner's own log (``<knowledge>/projects/<name>.json``: thesis, decisions, open items, the market story in
which it works). Nothing is copied: every item carries its reference so it can be opened and checked. What is not
there is declared, never filled in.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from galecore_ai.adapters.knowledge_base import parse_ref
from galecore_ai.adapters.research_store import ResearchIntegrityError, ResearchStoreError
from galecore_ai.adapters.strategy_store import StrategyIntegrityError, StrategyStoreError
from galecore_ai.application import controls, followup
from galecore_ai.application.knowledge import (
    KnowledgeBase,
    KnowledgeError,
    _display_path,
    cited_by,
    feedback_status,
    resolve_ref,
)
from galecore_ai.contracts.project import (
    PORTFOLIO,
    DecisionContext,
    EntryKind,
    ProjectEntry,
    ProjectLog,
    compute_project_hash,
    project_name_ok,
)


def _dir(kb: KnowledgeBase) -> Path:
    return kb.base / "projects"


def _path(kb: KnowledgeBase, name: str) -> Path:
    return _dir(kb) / f"{name}.json"


# ── the owner's log ──────────────────────────────────────────────


def load_log(kb: KnowledgeBase, name: str) -> ProjectLog:
    """The project's log; an empty one when nothing was recorded yet. An edited log raises."""
    if not project_name_ok(name):
        raise KnowledgeError(f"{name!r} is not a strategy name or 'portfolio'")
    path = _path(kb, name)
    if not path.is_file():
        return ProjectLog(name=name)
    try:
        log = ProjectLog.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (ValidationError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise KnowledgeError(f"project {name} is not readable", [str(exc)[:300]]) from exc
    problems = log.chain_problems() + ([] if log.name == name else [f"the file holds project {log.name}"])
    if problems:
        raise KnowledgeError(f"project {name}: INTEGRITY_FAILED", problems)
    return log


def _safe_log(kb: KnowledgeBase, name: str, broken: list[dict]) -> ProjectLog:
    """The log, or an empty one with the problem reported: a damaged log never hides the rest of the view."""
    try:
        return load_log(kb, name)
    except KnowledgeError as exc:
        broken.append({"ref": f"project:{name}", "problems": exc.problems or [str(exc)]})
        return ProjectLog(name=name)


def _strategy_names(kb: KnowledgeBase) -> list[str]:
    return sorted({k.split("/")[0] for k in kb.strategies.versions()})


def add(*, kb: KnowledgeBase, name: str, kind: str, words: str, prompt: str, refs: list[str] | None = None,
        closes: str = "", host_model: str | None = None, now: datetime | None = None,
        context: DecisionContext | None = None) -> tuple[ProjectEntry, Path]:
    """Append one entry in the owner's words. Refs must resolve; a strategy project needs the strategy to exist."""
    now = now or datetime.now(UTC)
    if name != PORTFOLIO and name not in _strategy_names(kb):
        raise KnowledgeError(f"no strategy named {name} in the knowledge base (strategy_design creates it)")
    log = load_log(kb, name)
    problems = []
    for ref in refs or []:
        try:
            resolve_ref(ref, kb)
        except KnowledgeError as exc:
            problems.append(f"ref {ref}: {exc}")
    try:
        entry_kind = EntryKind(kind)
    except ValueError:
        entry_kind = None
        problems.append(f"kind is one of {', '.join(k.value for k in EntryKind)}")
    if entry_kind == EntryKind.DONE:
        target = [e for e in log.open_items() if closes and e.hash.startswith(closes)]
        if len(target) != 1:
            problems.append("done needs --closes with the hash (or a unique prefix) of an open item")
        else:
            closes = target[0].hash
    elif closes:
        problems.append("--closes is only for done")
    if context is not None and entry_kind != EntryKind.DECISION:
        problems.append("a decision context is only for decision entries")
    if problems:
        raise KnowledgeError("Refusing to record", problems)
    prev = log.entries[-1].hash if log.entries else ""
    try:
        draft = ProjectEntry(at=now, kind=entry_kind, words=words, refs=list(refs or []), closes=closes,
                             context=context, prompt=prompt, host_model=host_model, prev=prev)
    except ValidationError as exc:
        raise KnowledgeError("Refusing to record", [e["msg"] for e in exc.errors()]) from exc
    entry = draft.model_copy(update={"hash": compute_project_hash(draft.hashable())})
    log = log.model_copy(update={"entries": [*log.entries, entry]})
    path = _path(kb, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(log.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return entry, path


def _entry_view(e: ProjectEntry, kb: KnowledgeBase | None = None) -> dict:
    gone = []
    for ref in e.refs if kb is not None else []:
        try:
            resolve_ref(ref, kb)
        except KnowledgeError:
            gone.append(ref)
    return {"at": e.at.isoformat(), "kind": e.kind.value, "words": e.words, "refs": e.refs,
            **({"refs_not_resolving": gone} if gone else {}),
            "hash": e.hash[:19], **({"closes": e.closes[:19]} if e.closes else {}),
            **({"context": e.context.model_dump(mode="json")} if e.context else {})}


def _log_view(log: ProjectLog, kb: KnowledgeBase) -> dict:
    by = {k: [_entry_view(e, kb) for e in log.entries if e.kind == k] for k in EntryKind}
    return {"thesis": by[EntryKind.THESIS], "story": by[EntryKind.STORY], "decisions": by[EntryKind.DECISION],
            "open": [_entry_view(e, kb) for e in log.open_items()], "closed": by[EntryKind.DONE]}


# ── strategy project ─────────────────────────────────────────────


def _vkey(key: str) -> tuple[int, ...]:
    return tuple(int(x) for x in key.split("/")[1].split("."))


def _versions(kb: KnowledgeBase, name: str, broken: list[dict]) -> list[dict]:
    out = []
    for key in sorted((k for k in kb.strategies.versions() if k.split("/")[0] == name), key=_vkey):
        try:
            doc = kb.strategies.load(key)
            approval = kb.strategies.load_approval(key)
        except (StrategyIntegrityError, StrategyStoreError) as exc:
            broken.append({"ref": f"strategy:{key}", "problems": [str(exc)]})
            continue
        out.append({"ref": f"strategy:{key}", "doc": doc, "approval": approval})
    return out


def _related_research(kb: KnowledgeBase, name: str, versions: list[dict], broken: list[dict]) -> list[str]:
    refs: list[str] = []
    for v in versions:
        refs += [r for r in v["doc"].content.research_refs if r.startswith("research:")]
        try:
            refs += cited_by(kb, parse_ref(v["ref"]))
        except Exception as exc:  # noqa: BLE001 - a damaged store is reported, the view goes on
            broken.append({"ref": v["ref"], "problems": [f"cited_by: {str(exc)[:200]}"]})
    slug = name.replace("_", "-")
    tails = ((rid, rid.split("-", 3)[-1]) for rid in kb.research.ids())
    refs += [f"research:{rid}" for rid, tail in tails if tail == slug or tail.endswith("-" + slug)]
    seen, out = set(), []
    for r in refs:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def _research_view(kb: KnowledgeBase, ref: str, broken: list[dict]) -> dict | None:
    try:
        doc = kb.research.load(ref.split(":", 1)[1])
    except (ResearchIntegrityError, ResearchStoreError) as exc:
        broken.append({"ref": ref, "problems": [str(exc)]})
        return None
    if doc is None:
        broken.append({"ref": ref, "problems": ["cited but not found"]})
        return None
    cur = doc.current
    c = cur.content
    return {"ref": ref, "title": c.title, "status": c.status.value, "skill": f"{cur.skill.asset_id} {cur.skill.version}",
            "revision": cur.revision, "updated_at": cur.recorded_at.isoformat(),
            "next_steps": c.next_steps, "missing": c.missing}


def _followup_view(kb: KnowledgeBase, name: str, broken: list[dict]) -> dict | None:
    try:
        recs = followup.history(kb, name, limit=1)
    except (KnowledgeError, ValidationError, json.JSONDecodeError, OSError) as exc:
        broken.append({"ref": f"followups/{name}", "problems": [str(exc)[:300]]})
        return None
    if not recs:
        return None
    r = recs[0]
    return {"id": r.id, "recorded_at": r.recorded_at.isoformat(), "status": r.status, "evaluated": r.strategy_ref,
            "approved": r.approved, "attention": r.attention, "shadow": r.shadow, "hypothesis": r.hypothesis,
            "path": _display_path(kb.base / "followups" / name / f"{r.id.split('/', 1)[1]}.json", kb)}


def strategy_project(kb: KnowledgeBase, name: str) -> dict:
    """Everything about one strategy, each item with its reference; what is missing is declared."""
    broken: list[dict] = []
    versions = _versions(kb, name, broken)
    if not versions and not broken:
        raise KnowledgeError(f"no strategy named {name} in the knowledge base",
                             [f"strategies: {', '.join(_strategy_names(kb)) or 'none'}"])
    log = _safe_log(kb, name, broken)
    approved = [v for v in versions if v["approval"] is not None]
    current = approved[-1] if approved else (versions[-1] if versions else None)
    view: dict = {"project": f"strategy:{name}", "log": _log_view(log, kb)}
    if current:
        c = current["doc"].content
        view["current"] = {
            "ref": current["ref"], "approved": current["approval"] is not None,
            "approved_at": current["approval"].recorded_at.isoformat() if current["approval"] else None,
            "spec_hash": current["doc"].spec_hash, "display_name": c.display_name, "purpose": c.purpose,
            "hypothesis": c.hypothesis.model_dump(mode="json"),
            "rules": [{"id": r.id, "block": r.block.value, "text": r.text, "parameter": r.parameter,
                       "runtime": r.runtime.status.value} for r in c.rules],
            "declared_gaps": current["doc"].check.declared_gaps,
            "owner_decisions": [d.model_dump(mode="json") for d in c.owner_decisions],
            "pending": c.pending, "limitations": c.limitations,
        }
        if current["approval"] is None:
            # WS-0027 R2: «¿la activo o espero?» was answered from this view alone, proposing approval on credit;
            # whether approval is recommended, and why, is part of the project, not something the session may skip.
            ctl = controls.classify(current["doc"])
            view["current"]["aprobacion"] = {"recomendar_aprobacion": ctl["recomendar_aprobacion"],
                                             "motivo": ctl["motivo"],
                                             "detalle": f"strategy controls --ref {current['ref']}"}
    newer = [v["ref"] for v in versions if current and _vkey(v["ref"].split(":", 1)[1]) >
             _vkey(current["ref"].split(":", 1)[1])]
    view["versions"] = [{"ref": v["ref"], "approved": v["approval"] is not None,
                         "recorded_at": v["doc"].recorded_at.isoformat()} for v in versions]
    view["newer_than_approved"] = newer
    view["last_followup"] = _followup_view(kb, name, broken)
    research_refs = _related_research(kb, name, versions, broken)
    view["research"] = [r for r in (_research_view(kb, ref, broken) for ref in research_refs) if r]
    try:
        fb = feedback_status(kb)["feedback"]
    except Exception as exc:  # noqa: BLE001 - a damaged store is reported, the view goes on
        broken.append({"ref": "feedback", "problems": [str(exc)[:200]]})
        fb = []
    view["feedback"] = [{"ref": f["ref"], "status": f["status"], "words": f["words"], "about": f["about"]}
                        for f in fb if f["about"].rsplit(" r", 1)[0] in research_refs]
    view["missing"] = _missing(view)
    view["integrity_failed"] = broken
    return view


def strategy_design_view(kb: KnowledgeBase, name: str) -> dict:
    """The saved design only: verified local files, no research scan, market API or model.

    Keep the same approved/latest selection as project show. Expose the complete method instead
    of reducing parameter rows to rule text; legacy omissions stay omissions.
    """
    if not project_name_ok(name) or name == PORTFOLIO:
        raise KnowledgeError("use strategy:<name> for a design")
    broken: list[dict] = []
    versions = _versions(kb, name, broken)
    approved = [v for v in versions if v["approval"] is not None]
    selected = approved[-1] if approved else (versions[-1] if versions else None)
    log = _safe_log(kb, name, broken)
    view = {"project": f"strategy:{name}", "current": None,
            "log": {"open": [_entry_view(e) for e in log.open_items()]},
            "versions": [{"ref": v["ref"], "approved": v["approval"] is not None,
                          "recorded_at": v["doc"].recorded_at.isoformat()} for v in versions],
            "newer_than_approved": [], "integrity_failed": broken}
    if selected:
        doc = selected["doc"]
        approval = selected["approval"]
        if approval and approval.spec_hash != doc.spec_hash:
            broken.append({"ref": selected["ref"], "problems": ["approval spec_hash mismatch"]})
        try:
            critique = kb.strategies.load_critique(f"{doc.name}/{doc.version}")
        except (StrategyIntegrityError, StrategyStoreError) as exc:
            broken.append({"ref": selected["ref"], "problems": [str(exc)]})
            critique = None
        current = doc.content.model_dump(mode="json")
        current.update(ref=selected["ref"], approved=approval is not None, spec_hash=doc.spec_hash,
                       recorded_at=doc.recorded_at.isoformat(), spec=json.loads(doc.spec_json),
                       declared_gaps=doc.check.declared_gaps, controls=controls.classify(doc),
                       critique=critique.content.model_dump(mode="json") if critique else None)
        current["rules"] = [{**r.model_dump(mode="json"), "runtime": r.runtime.status.value,
                             "runtime_note": r.runtime.note, "spec_paths": r.runtime.spec_paths}
                            for r in doc.content.rules]
        # Inventory of the implementation, not a retroactive amendment of the approved proposal.
        # These routes are the dispatcher's canonical GaleCore paths; reading them calls no API.
        from galecore_ai.capabilities.dispatcher import _ROUTE_TABLE
        spec = current["spec"]
        sources = []
        if (spec.get("candidate_construction") or {}).get("legs"):
            sources += [("Vencimientos, strikes y símbolos", "market_data.option_chains", "Constructor de candidatos"),
                        ("Deltas por strike y vencimiento", "compute.gamma_exposure", "Selección por delta"),
                        ("Bid, ask y hora por pata", "market_data.quote", "Crédito y valuación")]
        for layer in (spec.get("entry_filters") or {}).values():
            for gate in layer.get("gates", []) if isinstance(layer, dict) else []:
                ref = gate.get("metric_ref", "").removeprefix("capability:")
                capability = next((key for key in _ROUTE_TABLE if ref.startswith(key + ".")), None)
                if capability:
                    sources.append((gate.get("label", gate["id"]), capability, "Gate " + gate["id"]))
        current["runtime_sources"] = [{"need": need, "capability": cap, "source": "GaleCore",
                                       "endpoint": _ROUTE_TABLE[cap]["path"], "used_for": use}
                                      for need, cap, use in sources]
        current["runtime_calculations"] = []
        if (spec.get("structure") or {}).get("default_structure") in (
                "put_credit_spread", "call_credit_spread", "iron_condor"):
            current["runtime_calculations"] = [
                {"name": "Mid de cada pata", "inputs": "Bid y ask de GaleCore",
                 "implementation": "RuntimeMarketData.LegQuote.Mid", "source": "GaleCore"},
                {"name": "Crédito neto", "inputs": "Mids de patas vendidas y compradas",
                 "implementation": "CreditSpreadCandidateBuilder", "source": "GaleCore"},
                {"name": "Riesgo máximo del candidato", "inputs": "Ancho real, crédito y multiplicador del contrato",
                 "implementation": "CreditSpreadCandidateBuilder", "source": "GaleCore"},
            ]
        view["current"] = current
        view["newer_than_approved"] = [v["ref"] for v in versions if _vkey(v["ref"].split(":", 1)[1]) >
                                      _vkey(selected["ref"].split(":", 1)[1])]
    return view


def _missing(view: dict) -> list[str]:
    out = []
    log = view["log"]
    if not log["thesis"]:
        out.append("tesis en tus palabras (project add --kind thesis); hoy sólo está la hipótesis de la propuesta")
    if not log["story"]:
        out.append("en qué historia del mercado funciona y en cuál no (project add --kind story)")
    if view.get("current") and not view["current"]["approved"]:
        out.append("ninguna versión aprobada: la vigente es la más nueva, sin aprobar")
    if view.get("last_followup") is None:
        out.append("sin seguimiento registrado (strategy_followup)")
    return out


# ── portfolio project ────────────────────────────────────────────


def portfolio_project(kb: KnowledgeBase) -> dict:
    """The strategies with their state and the portfolio's own log."""
    broken: list[dict] = []
    strategies = []
    for name in _strategy_names(kb):
        versions = _versions(kb, name, broken)
        approved = [v for v in versions if v["approval"] is not None]
        fu = _followup_view(kb, name, broken)
        n_broken = len(broken)
        open_items = len(_safe_log(kb, name, broken).open_items())
        if len(broken) > n_broken:
            open_items = None
        strategies.append({
            "name": name, "approved": approved[-1]["ref"] if approved else None,
            "latest": versions[-1]["ref"] if versions else None,
            "last_followup": {k: fu[k] for k in ("recorded_at", "status", "attention", "shadow")} if fu else None,
            "open_items": open_items,
        })
    view = {"project": "portfolio", "strategies": strategies,
            "log": _log_view(_safe_log(kb, PORTFOLIO, broken), kb)}
    missing = []
    missing.append("riesgo abierto en vivo: no se consulta acá; lo último que informó GaleCore está en cada "
                   "last_followup (fecha incluida)")
    view["missing"] = missing
    view["integrity_failed"] = broken
    return view


# ── search ───────────────────────────────────────────────────────


def search_items(kb: KnowledgeBase, failed: list[dict]) -> list[tuple[dict, str]]:
    items = []
    base = _dir(kb)
    for path in sorted(base.glob("*.json")) if base.is_dir() else []:
        try:
            log = load_log(kb, path.stem)
        except KnowledgeError as exc:
            failed.append({"ref": f"project:{path.stem}", "status": "INTEGRITY_FAILED", "problems": exc.problems})
            continue
        if not log.entries:
            continue
        summary = {"ref": f"project:{log.name}", "kind": "project", "title": f"Proyecto {log.name}",
                   "entries": len(log.entries), "open": [e.words for e in log.open_items()],
                   "updated_at": log.entries[-1].at.isoformat(), "path": _display_path(path, kb)}
        items.append((summary, " ".join([log.name, log.name.replace("_", " "),
                                         *(f"{e.kind.value} {e.words}" for e in log.entries)])))
    return items
