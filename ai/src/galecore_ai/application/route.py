"""Ask without naming a skill (GC-AI-0022): which capability serves a request, in the trader's words.

Deterministic and cheap: the request's words (folded, without scaffolding) are matched against each catalog entry's
`serves`, `example_requests` and id; a word that also appears in an example request counts double (examples are how
the owner asks). The host gets the best few with their flow and decides; when nothing matches it says so and offers
`capability_builder` instead of improvising. Below `MIN_SCORE` the word overlap is chance («en qué quedamos» ≠
performance): the answer then carries every capability in one line so the host picks by meaning (WS-0037).
"""

from __future__ import annotations

import re

import yaml

from galecore_ai.application.source_query import _STOPWORDS_FOLDED, _fold
from galecore_ai.harness.assets import load_asset
from galecore_ai.harness.catalog import Catalog
from galecore_ai.harness.definitions import SkillDefinition

MIN_SCORE = 6  # below this the overlap is chance; the host chooses from `options`
MARGIN = 2  # a first that barely beats the second is a guess (batería MVP 17/10: «¿entra en mi cuenta?» → market_watch)

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
    strong = bool(best) and best[0]["score"] >= MIN_SCORE
    rival = best[1]["score"] if len(best) > 1 and best[1]["score"] >= MIN_SCORE else 0
    sure = strong and best[0]["score"] - rival >= MARGIN
    if sure:  # the method travels with the match (WS-0054): the host never has to look for skill files
        best[0]["pasos"] = _method(best[0]["skill"])
    out = {"request": request, "matches": best, "missing": not best, "confident": sure,
           "next": ("Seguí los `pasos` y el `flow` de la primera: ahí está cómo se resuelve y se responde ese pedido."
                    if sure else
                    "El cruce de palabras no alcanza: elegí por el sentido del pedido entre `options` y corré "
                    "`catalog --match` con el ejemplo de esa capacidad para ver su flow; si ninguna sirve, ofrecé crearla "
                    "con capability_builder; no improvises.")}
    if not sure:  # close call: only the candidates; nothing near: the whole catalog
        out["options"] = ([{"capability": m["capability"], "serves": m["serves"].split(". ")[0][:140]} for m in best]
                          if strong else options(catalog))
        out["ambiguous"] = strong
    return out


def _method(skill_path: str) -> str | None:
    try:
        return load_asset(skill_path, SkillDefinition).system_prompt or None
    except (OSError, ValueError, yaml.YAMLError):
        return None


def options(catalog: Catalog) -> list[dict]:
    """Every capability in one line, with one example in the owner's words: what the host chooses from by meaning."""
    return [{"capability": e.id, "serves": e.serves.strip().split(". ")[0][:140],
             "example": e.example_requests[0] if e.example_requests else None} for e in catalog.entries]


def _model(e) -> str:
    """Which model the work needs (GC-AI-0025): the host uses it when it delegates; it never renames the chat's."""
    s = e.schedulable
    if s is None:
        return "el de la sesión (en sesión)"
    return "código, sin modelo" if s.runs == "code" else s.route_reason()
