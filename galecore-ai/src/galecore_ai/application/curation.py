"""The curator's screen by code (WS-0025): what is new, in which domain, and whether the model is worth calling.

The model curates only the domains that crossed the threshold since the last curation, reading the refs the screen
lists; with nothing to curate the run ends here at no model cost. Same pattern as the agent's screen (scan.py).

Known limit: ``last_run`` advances with every saved curation, so items of a domain still under the threshold are not
counted again next time. They are not lost (a manual run reads them with ``kb search --since``); curating a domain
only once it has enough to say is the point of the threshold.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from galecore_ai.application import knowledge
from galecore_ai.application.knowledge import KnowledgeBase

THRESHOLD = 3                 # curated items new in one domain before the model is called
FIRST_RUN_DAYS = 14           # no previous curation: look this far back
STALE_DAYS = 14               # a pending feedback this old is named to the owner, by code
MAX_REFS = 25                 # refs listed per domain
CURATED_KINDS = {"research", "feedback", "project", "strategy", "profile"}   # data (evidence, regime) is not curated
OWN_SLUG = "curaduria"

# First match wins; the key is looked up in the ref and title, lowercase.
DOMAINS = (
    ("estrategias", ("strategy:", "project:strategy", "estrategia", "seguimiento", "spy_prima")),
    ("fuentes", ("fuente", "sources", "fred", "cboe", "edgar", "datafeed")),
    ("metodo", ("feedback:", "profile:", "skill", "harness", "método", "metodo")),
    ("mercado", ("historia", "mercado", "oportunidades", "atencion", "atención", "regime", "gex", "macro")),
)
OTHER = "otros"


def domain_of(item: dict) -> str:
    text = f"{item['ref']} {item.get('title', '')}".lower()
    for name, keys in DOMAINS:
        if any(k in text for k in keys):
            return name
    return OTHER


def _when(text: str) -> datetime:
    when = datetime.fromisoformat(text)
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def screen(kb: KnowledgeBase, *, last_run: datetime | None, now: datetime) -> dict:
    """New curated items by domain since ``last_run`` and the domains that call for the model."""
    since = last_run or now - timedelta(days=FIRST_RUN_DAYS)
    found = knowledge.search(kb, since=f"{since:%Y-%m-%d}")["results"]
    fresh = [r for r in found if r["kind"] in CURATED_KINDS and r.get("updated_at") and _when(r["updated_at"]) > since
             and not r["ref"].endswith(f"-{OWN_SLUG}")]
    by_domain: dict[str, list[str]] = {}
    for item in fresh:
        by_domain.setdefault(domain_of(item), []).append(item["ref"])
    stale_before = now - timedelta(days=STALE_DAYS)
    stale = [f["ref"] for f in knowledge.feedback_status(kb)["feedback"]
             if f["status"] == "pending" and _when(f["recorded_at"]) < stale_before]
    return {"since": since.isoformat(), "threshold": THRESHOLD,
            "new": {d: {"count": len(refs), "refs": refs[:MAX_REFS]} for d, refs in sorted(by_domain.items())},
            "domains": sorted(d for d, refs in by_domain.items() if len(refs) >= THRESHOLD),
            "stale_pending_feedback": stale}


def summary(found: dict) -> str:
    counts = ", ".join(f"{d} {v['count']}" for d, v in found["new"].items()) or "nada nuevo"
    return f"desde {found['since'][:10]}: {counts}; umbral {found['threshold']} por dominio"
