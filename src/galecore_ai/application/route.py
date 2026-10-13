"""Ask without naming a skill (GC-AI-0022): which capability serves a request, in the trader's words.

Deterministic and cheap: the request's words (folded, without scaffolding) are matched against each catalog entry's
`serves`, `example_requests` and id; a word that also appears in an example request counts double (examples are how
the owner asks). The host gets the best few with their flow and decides; when nothing matches it says so and offers
`capability_builder` instead of improvising.
"""

from __future__ import annotations

import re

from galecore_ai.application.source_query import _STOPWORDS_FOLDED, _fold
from galecore_ai.harness.catalog import Catalog

_EXTRA_STOP = {_fold(w) for w in (
    "mi", "mis", "me", "te", "hoy", "ahora", "esta", "este", "semana", "quiero", "podes", "podés", "haceme", "armame",
    "decime", "fijate", "hay", "algo", "sobre", "con", "sin", "que", "cual", "cuales", "como", "a", "y", "o", "de",
)}


def _words(text: str) -> set[str]:
    out = set()
    for raw in re.findall(r"\w+", text):
        w = _fold(raw)
        if len(w) >= 3 and w not in _STOPWORDS_FOLDED and w not in _EXTRA_STOP:
            out.add(w[:6])                     # a crude stem: "oportunidades" ~ "oportunidad", "vender" ~ "venta"
    return out


def match(request: str, catalog: Catalog, limit: int = 3) -> dict:
    asked = _words(request)
    ranked = []
    for e in catalog.entries:
        examples = _words(" ".join(e.example_requests))
        described = _words(f"{e.serves} {e.id.replace('_', ' ')}")
        hits = asked & (examples | described)
        # The example closest to the request weighs most: that is how the owner asks for this capability.
        closest = max((len(asked & _words(r)) / len(asked | _words(r)) for r in e.example_requests if asked),
                      default=0.0)
        score = round(sum(2 if w in examples else 1 for w in hits) + 10 * closest, 2)
        if score:
            ranked.append((score, e.id, sorted(hits), e))
    ranked.sort(key=lambda r: (-r[0], r[1]))
    best = [{"capability": cid, "score": score, "matched": hits, "serves": e.serves.strip(), "flow": e.flow,
             "skill": e.skill, "model": _model(e)} for score, cid, hits, e in ranked[:limit]]
    return {"request": request, "matches": best, "missing": not best,
            "next": ("Leé el archivo de la skill de la primera (o la que mejor sirva), bajo config/, y seguí su método y su flow; "
                     "ahí está cómo se responde ese tipo de pedido."
                     if best else "Ninguna capacidad lo cubre: ofrecé crearla con capability_builder; no improvises.")}


def _model(e) -> str:
    """Which model the work needs (GC-AI-0025): the host uses it when it delegates; it never renames the chat's."""
    s = e.schedulable
    if s is None:
        return "el de la sesión (en sesión)"
    return "código, sin modelo" if s.runs == "code" else s.route_reason()
