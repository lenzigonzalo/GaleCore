"""Versions of one strategy and duplicating one as a new draft (WS-0098, increment 4).

``list_versions`` is read-only and by code: the stored versions in semantic order with their approval, critique,
feasibility and the existing ``strategy_sheet.diff`` against the previous one. ``duplicate`` stores a copy of a
version under a new name as a draft (saved proposal, no approval, no critique) through ``save_proposal``.
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
                      "check": doc.check.verdict, "approved": False, "approved_at": None, "critique": None})
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
        except (StrategyStoreError, StrategyIntegrityError) as exc:
            problems.append(f"critique not usable ({exc})")
        full = feasibility.assess(json.loads(doc.spec_json), doc.content.simulated_amount_usd)
        entry["factibilidad"] = {"veredicto": full.get("veredicto"), "texto": full.get("texto")}
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
