"""The daily contrast pack (GC-AI-0027): today's market story against each strategy and the portfolio.

Gathered by code from what is already stored — the latest market story reading (GC-AI-0024), each strategy as a project
(GC-AI-0026: where it works, decisions, open items, last follow-up) and the profile — so the model only interprets.
Nothing is recomputed: a stale story is declared with its age. What moves the symbol (releases ahead, what the IV
pays for them, the reaction to each kind) comes from the latest story pack (P1-05). The proposal (turn on / keep /
wait / turn off, per strategy, with what would change it) is the model's and is saved as a revision of the contrast investigation; the owner decides and acts.
"""

from __future__ import annotations

from datetime import UTC, datetime

from galecore_ai.adapters.research_store import ResearchIntegrityError, ResearchStoreError
from galecore_ai.application import project
from galecore_ai.application import story as story_pack
from galecore_ai.application.knowledge import KnowledgeBase

STORY_SLUG = "historia-del-mercado-"   # market_story saves one investigation per symbol with this slug
CONTRAST_SLUG = "contraste-diario"
STALE_HOURS = 30                       # a story read after yesterday's close is still today's input


def _latest_story(kb: KnowledgeBase, symbol: str, now: datetime, broken: list[dict]) -> dict | None:
    ids = [rid for rid in kb.research.ids() if rid.split("-", 3)[-1] == STORY_SLUG + symbol.lower()]
    best = None
    for rid in ids:
        try:
            doc = kb.research.load(rid)
        except (ResearchIntegrityError, ResearchStoreError) as exc:
            broken.append({"ref": f"research:{rid}", "problems": [str(exc)[:200]]})
            continue
        if doc is not None and (best is None or doc.current.recorded_at > best[1].current.recorded_at):
            best = (rid, doc)
    if best is None:
        return None
    rid, doc = best
    cur = doc.current
    c = cur.content
    age_h = round((now - cur.recorded_at).total_seconds() / 3600, 1)
    return {"ref": f"research:{rid}", "revision": cur.revision, "recorded_at": cur.recorded_at.isoformat(),
            "age_hours": age_h, "stale": age_h > STALE_HOURS, "title": c.title, "hypothesis": c.hypothesis,
            "statements": [{"kind": s.kind.value, "text": s.text} for s in c.statements],
            "missing": c.missing}


def _strategy(kb: KnowledgeBase, name: str, broken: list[dict]) -> dict:
    view = project.strategy_project(kb, name)
    broken += view["integrity_failed"]
    cur = view.get("current") or {}
    fu = view.get("last_followup") or {}
    return {
        "name": name, "project": f"strategy:{name}", "version": cur.get("ref"), "approved": cur.get("approved"),
        "purpose": cur.get("purpose"), "hypothesis": cur.get("hypothesis"),
        "where_it_works": [e["words"] for e in view["log"]["story"]],
        "thesis": [e["words"] for e in view["log"]["thesis"]],
        "decisions": [e["words"] for e in view["log"]["decisions"]],
        "open": [e["words"] for e in view["log"]["open"]] + list(cur.get("pending") or []),
        "last_followup": {k: fu.get(k) for k in ("recorded_at", "status", "attention", "shadow")} if fu else None,
        "missing": view["missing"],
    }


def _drivers(kb: KnowledgeBase, symbol: str, now: datetime) -> dict | None:
    """What moves the symbol, from the latest story pack (P1-05): the ground for «esperar» and «qué la cambiaría»."""
    found = story_pack.previous_pack(kb, symbol, now)
    if not found or not (found[1].get("drivers") or {}):
        return None
    eid, p = found
    d = p["drivers"]
    reaction = d.get("reaction") or {}
    return {
        "ref": f"evidence:{eid}", "gathered_at": p.get("gathered_at"),
        "upcoming": d.get("upcoming") or [],
        "by_release": {k: {f: v.get(f) for f in ("n", "median_ratio", "premium", "vs_days_without_data")}
                       for k, v in (reaction.get("by_release") or {}).items()},
        "days_without_data": reaction.get("days_without_data"),
        "co_movement": ((d.get("co_movement") or {}).get("assets") or [])[:4],
    }


def pack(kb: KnowledgeBase, *, symbol: str = "SPY", now: datetime | None = None) -> dict:
    """Everything the contrast needs, each item with its reference; what is missing is declared."""
    now = now or datetime.now(UTC)
    broken: list[dict] = []
    story = _latest_story(kb, symbol, now, broken)
    portfolio = project.portfolio_project(kb)
    broken += portfolio["integrity_failed"]
    strategies = [_strategy(kb, s["name"], broken) for s in portfolio["strategies"]]
    missing = []
    if story is None:
        missing.append(f"sin lectura de la historia de {symbol}: correr market_story primero")
    elif story["stale"]:
        missing.append(f"la historia tiene {story['age_hours']} h: puede no ser la de hoy")
    missing += [f"{s['name']}: no dice en qué historia funciona (project add {s['name']} --kind story)"
                for s in strategies if not s["where_it_works"]]
    missing += [m for m in portfolio["missing"] if not m.startswith("riesgo abierto")]
    drivers = _drivers(kb, symbol, now)
    if drivers is None:
        missing.append(f"sin «qué mueve hoy» de {symbol} (story pack con drivers): «esperar» y «qué la cambiaría» "
                       "quedan sin los datos que vienen")
    missing.append("estructuras en SHADOW: sólo put credit spread; una historia que pida otra se declara (D-1)")
    return {
        "generated_at": now.isoformat(), "symbol": symbol, "story": story, "drivers": drivers,
        "strategies": strategies,
        "portfolio_log": portfolio["log"], "missing": missing, "integrity_failed": broken,
        "save_as": {"capability": "daily_contrast", "slug": CONTRAST_SLUG},
    }
