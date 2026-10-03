"""Answer "¿qué datos tengo?" and "¿de dónde saco X?" from the registry (GC-AI-0012, AC-04).

Matching: `need` is split into words, the ones that are pure question scaffolding
("qué", "tengo", "saco", "datos"…) are dropped, and what remains must ALL appear —
each a whole word, or the start of one, so "cadena" still finds a coverage entry
that only says "cadenas" — inside the SAME coverage entry's category and
description. Requiring every term (not just one) is what keeps an incidental
shared word (e.g. every FMP entry mentioning "SPY") from making an unrelated
coverage match; accents are folded on both sides so "inflacion" finds "inflación".
Deliberately simple: the registry is small and hand-authored, so this never
becomes fuzzy search over the whole thing. An empty need, one made only of
scaffolding words, or one whose words are not all present together in any single
coverage entry matches nothing rather than guessing; a need with no match is
reported missing.

The status shown for a match is the most recent observation that actually bears
on the coverage that matched — one tagged with that category, or one with no
category (the whole source) — never an unrelated endpoint's last word. A source
whose status history fails its integrity check is reported as such instead of
silently showing its last good (or an exception).
"""

from __future__ import annotations

import re
import unicodedata

from galecore_ai.adapters.source_status_store import (
    FileSourceStatusStore,
    SourceStatusIntegrityError,
)
from galecore_ai.contracts.source_status import (
    SourceStatusDocument,
    SourceStatusObservation,
    most_recent,
)
from galecore_ai.contracts.sources import (
    USAGE_NOTE,
    USAGE_RANK,
    CategorySummary,
    DataSource,
    SourceCatalogSummary,
    SourceCoverage,
    SourceMatch,
    SourceQueryResult,
    SourceRegistry,
    SourceStatusView,
    Usage,
)

# Words that only scaffold the question ("¿de dónde saco los datos de X?", "what
# data do I have"), never a coverage's own vocabulary. Dropping them stops "datos"
# in a query from matching an unrelated source that happens to say "datos" too.
_STOPWORDS = {
    "de", "la", "el", "en", "un", "una", "uno", "al", "lo", "es", "son", "y", "o",
    "que", "qué", "como", "cómo", "donde", "dónde", "cual", "cuál", "cuales", "cuáles",
    "para", "por", "con", "del", "las", "los", "esta", "este", "estos", "estas",
    "tengo", "saco", "sacar", "dato", "datos", "fuente", "fuentes", "desde", "hacia", "sobre",
    "puedo", "hay", "tiene", "tienen", "necesito", "quiero", "dame", "dime", "the", "for", "data",
}
_MIN_TERM_LEN = 2


def _fold(word: str) -> str:
    """Lowercase, accent-stripped: "inflación" and "inflacion" compare equal."""
    decomposed = unicodedata.normalize("NFKD", word.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


_STOPWORDS_FOLDED = {_fold(w) for w in _STOPWORDS}


# A ticker as written in the need: all caps, 1–6 letters/digits (SPY, QQQ, BRK.B's parts).
_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9]{0,5}$")


def _terms(need: str) -> list[tuple[str, bool]]:
    """(folded term, looks like a ticker in the original text) for each meaningful word."""
    out = []
    for raw in re.findall(r"\w+", need):
        term = _fold(raw)
        if len(term) >= _MIN_TERM_LEN and term not in _STOPWORDS_FOLDED:
            out.append((term, bool(_TICKER_RE.fullmatch(raw))))
    return out


def _coverage_words(coverage: SourceCoverage) -> list[str]:
    return [_fold(w) for w in re.findall(r"\w+", f"{coverage.category} {coverage.description}")]


def _matches_coverage(terms: list[tuple[str, bool]], coverage: SourceCoverage) -> bool:
    """Every term must be (the start of) some word of this one coverage entry. A ticker
    not named there is accepted by a coverage that serves any symbol, but only when
    another term already matched it: "cotizaciones de QQQ" matches, while a bare
    acronym that merely looks like a ticker ("CPI", "IV") does not."""
    words = _coverage_words(coverage)
    in_words = [any(word.startswith(term) for word in words) for term, _ in terms]
    if not any(in_words):
        return False
    return all(hit or (is_ticker and coverage.any_symbol) for hit, (_, is_ticker) in zip(in_words, terms))


def _relevant_observation(document: SourceStatusDocument | None,
                          categories: set[str] | None) -> SourceStatusObservation | None:
    """Chronologically latest (by observed_at) observation that bears on `categories`
    (None = the whole source's overview). Append order is write order, not observed_at
    order, so this never just returns the last-appended entry."""
    if document is None:
        return None
    if categories is None:
        return document.latest
    return most_recent([o for o in document.observations if o.category is None or o.category in categories])


def _status_view(observation: SourceStatusObservation | None) -> SourceStatusView:
    if observation is None:
        return SourceStatusView()
    return SourceStatusView(
        state=observation.state.value,
        observed_at=observation.observed_at.isoformat(),
        origin=observation.origin.value,
        note=observation.note,
    )


def _to_match(source: DataSource, status_store: FileSourceStatusStore, *,
             matched_coverage: list[SourceCoverage] | None = None) -> SourceMatch:
    categories = {c.category for c in matched_coverage} if matched_coverage is not None else None
    try:
        document = status_store.load(source.id)
        status = _status_view(_relevant_observation(document, categories))
    except SourceStatusIntegrityError as exc:
        status = SourceStatusView(state="integrity_failed", note="; ".join(exc.problems))
    return SourceMatch(
        id=source.id,
        display_name=source.display_name,
        access_type=source.access_type,
        usage=source.usage,
        usage_note=USAGE_NOTE.get(source.usage),
        preference=source.preference,
        cost=source.cost,
        limits=list(source.limits),
        matched_coverage=matched_coverage if matched_coverage is not None else list(source.covers),
        last_status=status,
    )


def _sort_key(source: DataSource) -> tuple[int, int, str]:
    return (USAGE_RANK[source.usage], source.preference, source.id)


def query_sources(need: str, registry: SourceRegistry, status_store: FileSourceStatusStore) -> SourceQueryResult:
    terms = _terms(need)
    matches: list[SourceMatch] = []
    if terms:
        for source in sorted(registry.sources, key=_sort_key):
            hits = [c for c in source.covers if _matches_coverage(terms, c)]
            if hits:
                matches.append(_to_match(source, status_store, matched_coverage=hits))
    # A need only requested sources cover is still missing: they say who brings it, not where to get it today.
    return SourceQueryResult(need=need, matches=matches, missing=all(m.usage is Usage.REQUESTED for m in matches))


def catalog_summary(registry: SourceRegistry, status_store: FileSourceStatusStore) -> SourceCatalogSummary:
    by_category: dict[str, list[DataSource]] = {}
    for source in sorted(registry.sources, key=_sort_key):
        for coverage in source.covers:
            by_category.setdefault(coverage.category, []).append(source)
    categories = [
        CategorySummary(category=category, sources=[s.id for s in sources])
        for category, sources in sorted(by_category.items())
    ]
    sources = [_to_match(source, status_store) for source in sorted(registry.sources, key=_sort_key)]
    return SourceCatalogSummary(categories=categories, sources=sources)
