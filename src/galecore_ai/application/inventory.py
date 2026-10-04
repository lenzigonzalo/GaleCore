"""What the harness has and what it costs (GC-AI-0024, BL-006 minimum).

One view for the owner and the host: the capabilities with the model that runs them and what their runs consumed,
the data sources with their cost and last observed access, and the host's connectors with what they are for and
what the agent may do with them on its own. Read-only: it reads the catalog, the source registry, the connectors
file and the tasks' event logs; it calls nothing.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from galecore_ai.application import tasks as task_store
from galecore_ai.application.knowledge import KnowledgeBase
from galecore_ai.application.source_query import catalog_summary
from galecore_ai.harness.assets import load_asset
from galecore_ai.harness.catalog import Catalog

CONNECTORS_PATH = "host_connectors.yaml"
PERMISSIONS = {"free": "libre", "warn": "avisando", "ask": "preguntar antes"}
USAGES = {"free": "gratis", "own": "propia", "daily_quota": "cupo diario", "plan": "plan pago",
          "requested": "pedida a GaleCore"}


class HostConnector(BaseModel):
    model_config = {"extra": "forbid"}

    id: str
    display_name: str
    state: str                       # connected | needs_auth, as the host showed it on observed_at
    source: str | None = None        # its entry in sources.yaml, when it brings data
    for_: str = Field(alias="for")
    when: str
    permission: str

    @field_validator("permission")
    @classmethod
    def _permission(cls, v: str) -> str:
        if v not in PERMISSIONS:
            raise ValueError(f"permission must be one of {sorted(PERMISSIONS)}")
        return v


class HostConnectors(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str
    observed_at: str
    connectors: list[HostConnector]


def load_connectors() -> HostConnectors:
    return load_asset(CONNECTORS_PATH, HostConnectors)


def consumption(kb: KnowledgeBase | None) -> dict[str, dict]:
    """Per capability: the finished runs of its tasks, their mean duration and, for the runs that reported them,
    their mean tokens. A capability nobody scheduled has no entry."""
    out: dict[str, dict] = {}
    if kb is None:
        return out
    for t in task_store.list_tasks(kb):
        for e in task_store.events(kb, t["id"]):
            if e.get("event") != "run_finished":
                continue
            c = out.setdefault(t["capability"], {"runs": 0, "last_at": None, "_dur": [], "_tok": []})
            c["runs"] += 1
            c["last_at"] = max(filter(None, [c["last_at"], e.get("at")]), default=None)
            if isinstance(e.get("duration_s"), int | float):
                c["_dur"].append(e["duration_s"])
            if isinstance(e.get("tokens"), dict):
                c["_tok"].append(e["tokens"])
    for c in out.values():
        dur, tok = c.pop("_dur"), c.pop("_tok")
        c["mean_duration_s"] = round(sum(dur) / len(dur), 1) if dur else None
        c["runs_with_tokens"] = len(tok)
        if tok:
            c["mean_tokens"] = {k: round(sum(x.get(k, 0) for x in tok) / len(tok))
                                for k in ("input", "output", "cache_read", "cache_write")}
    return out


def build(*, catalog: Catalog, registry, status_store, kb: KnowledgeBase | None) -> dict:
    used = consumption(kb)
    caps = []
    for e in catalog.entries:
        s = e.schedulable
        caps.append({"id": e.id, "kind": e.kind, "serves": e.serves,
                     "runs": ("modelo" if s and s.runs == "model" else "código") if s else "en sesión",
                     "model": (s.model or "el del host") if s and s.runs == "model" else None,
                     "max_turns": s.max_turns if s else None, "consumption": used.get(e.id)})
    summary = catalog_summary(registry, status_store)
    sources = [{"id": m.id, "name": m.display_name, "usage": m.usage.value, "cost": m.cost,
                "last_status": m.last_status.state, "observed_at": m.last_status.observed_at}
               for m in summary.sources]
    hc = load_connectors()
    connectors = [{"id": c.id, "name": c.display_name, "state": c.state, "for": c.for_, "when": c.when,
                   "permission": c.permission, "source": c.source} for c in hc.connectors]
    return {"capabilities": caps, "sources": sources, "connectors": connectors,
            "connectors_observed_at": hc.observed_at,
            "note": "Las corridas programadas no ven conectores del host: sólo GaleCore y los scripts del flujo."}


def _n(x) -> str:
    if x is None:
        return "—"
    return f"{x / 1000:.1f} k" if x >= 1000 else str(x)


def render(inv: dict) -> str:
    """The same view as a few readable tables (the owner reads tables first)."""
    lines = ["# Inventario del harness", "", "## Capacidades y consumo", "",
             "| Capacidad | Corre | Modelo | Tope | Corridas | Duración media | Tokens medios (salida · entrada+caché) |",
             "|---|---|---|---|---|---|---|"]
    for c in inv["capabilities"]:
        u = c["consumption"] or {}
        tok = u.get("mean_tokens")
        tokens = (f"{_n(tok['output'])} · {_n(tok['input'] + tok['cache_read'] + tok['cache_write'])}"
                  f" ({u['runs_with_tokens']} con dato)") if tok else "—"
        dur = f"{u['mean_duration_s']:.0f} s" if u.get("mean_duration_s") is not None else "—"
        lines.append(f"| {c['id']} | {c['runs']} | {c['model'] or '—'} | {c['max_turns'] or '—'} | "
                     f"{u.get('runs', 0) or '—'} | {dur} | {tokens} |")
    lines += ["", "## Fuentes de datos", "", "| Fuente | Uso | Costo | Último acceso |", "|---|---|---|---|"]
    for s in inv["sources"]:
        seen = f"{s['last_status']} ({s['observed_at'][:10]})" if s["last_status"] else "sin comprobar"
        lines.append(f"| {s['name']} | {USAGES.get(s['usage'], s['usage'])} | {s['cost']} | {seen} |")
    lines += ["", f"## Conectores del host (estado visto el {inv['connectors_observed_at']})", "",
              "| Conector | Estado | Para qué | Cuándo | Permiso |", "|---|---|---|---|---|"]
    for c in inv["connectors"]:
        state = "conectado" if c["state"] == "connected" else "sin autenticar"
        lines.append(f"| {c['name']} | {state} | {c['for']} | {c['when']} | {PERMISSIONS[c['permission']]} |")
    lines += ["", inv["note"], ""]
    return "\n".join(lines)
