"""Is every capability complete? (GC-AI-0015, the capability template's validation).

A capability is complete when its skill and output contract load (``describe``), every
flow line is a command this CLI actually has (or a script that exists in the workspace),
every data need resolves to a source of the registry or says why none covers it, its
controls say what is NOT checked, and its skill history says what the version in force
changed and cites resolvable ``method`` feedback about that skill (GC-AI-0016). What fails
is listed per entry; nothing is fixed here.
"""

from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path

from galecore_ai.adapters.source_status_store import FileSourceStatusStore
from galecore_ai.application.source_query import query_sources
from galecore_ai.contracts.sources import SourceRegistry
from galecore_ai.harness.catalog import Catalog, CatalogEntry, describe
from galecore_ai.harness.skill_history import SkillHistoryError, load_skill_history

# (feedback refs, skill id, version that applies them) → problems; None when the knowledge base is unavailable.
FeedbackCheck = Callable[[list[str], str, str], list[str]]


def cli_commands(parser: argparse.ArgumentParser) -> dict[str, set[str]]:
    """Top-level subcommand → its own subcommands (empty set when it has none)."""
    def subcommands(p: argparse.ArgumentParser) -> dict[str, argparse.ArgumentParser]:
        for action in p._actions:  # argparse exposes no public accessor for subparsers
            if isinstance(action, argparse._SubParsersAction):
                return dict(action.choices)
        return {}

    return {name: set(subcommands(child)) for name, child in subcommands(parser).items()}


CHECKOUT = Path(__file__).resolve().parents[3]  # the GaleCore-AI checkout this code runs from (also a worktree)


def _script_path(script: str, workspace: Path) -> Path:
    """A flow script: ``GaleCore-AI/...`` is this checkout's own file (a worktree's new script counts before
    it is merged); anything else is relative to the workspace root."""
    head, _, rest = script.partition("/")
    return CHECKOUT / rest if head == "GaleCore-AI" and rest else workspace / script


def _flow_problems(entry: CatalogEntry, commands: dict[str, set[str]], workspace: Path) -> list[str]:
    problems = [] if entry.flow else ["flow: empty; a capability says which commands run it"]
    for line in entry.flow:
        tokens = line.split()
        if not tokens:
            problems.append("flow: blank line")
            continue
        if tokens[0] == "python":
            if len(tokens) < 2 or not tokens[1].endswith(".py") or not _script_path(tokens[1], workspace).is_file():
                problems.append(f"flow: script not found in the workspace: {line!r}")
            continue
        if tokens[0] not in commands:
            problems.append(f"flow: {tokens[0]!r} is not a command of this CLI")
            continue
        subs = commands[tokens[0]]
        if subs and (len(tokens) < 2 or tokens[1] not in subs):
            problems.append(f"flow: {' '.join(tokens[:2])!r} is not a command of this CLI "
                            f"(expected one of: {', '.join(sorted(subs))})")
    return problems


def _data_problems(entry: CatalogEntry, registry: SourceRegistry, status_store: FileSourceStatusStore) -> list[str]:
    problems = []
    for need in entry.data_needs:
        covered = not query_sources(need.need, registry, status_store).missing
        if not covered and not need.missing:
            problems.append(f"data need {need.need!r}: no source in the registry covers it; "
                            "declare why (missing) or add the source")
        if covered and need.missing:
            problems.append(f"data need {need.need!r}: declared missing but the registry covers it")
    return problems


def _history_problems(entry: CatalogEntry, described: dict, feedback_check: FeedbackCheck | None) -> list[str]:
    try:
        history = load_skill_history(entry.skill)
    except SkillHistoryError as exc:
        return [f"history: {exc}"]
    problems = [] if history.skill_id == entry.id else [f"history: declares skill_id {history.skill_id!r}"]
    versions = [v.version for v in history.versions]
    problems += [f"history: version {v} appears more than once" for v in sorted(set(versions)) if versions.count(v) > 1]
    in_force = (described.get("skill_asset") or {}).get("version")
    if in_force and history.get(in_force) is None:
        problems.append(f"history: no entry for the version in force {in_force}; say what it changed")
    for note in history.versions:
        if not note.feedback:
            continue
        if feedback_check is None:
            problems.append(f"history {note.version}: cites feedback but the knowledge base is not available")
            continue
        problems += [f"history {note.version}: {p}" for p in feedback_check(note.feedback, entry.id, note.version)]
    return problems


def check_entry(entry: CatalogEntry, described: dict, *, commands: dict[str, set[str]], workspace: Path,
                registry: SourceRegistry, status_store: FileSourceStatusStore,
                feedback_check: FeedbackCheck | None = None) -> list[str]:
    problems = [] if described.get("available") else [f"skill or contract: {described.get('error')}"]
    problems += _flow_problems(entry, commands, workspace)
    problems += _data_problems(entry, registry, status_store)
    if not any(c.lower().startswith("not checked") and c[len("not checked"):].strip(" -–:") for c in entry.controls):
        problems.append("controls: none says what is NOT checked")
    problems += _history_problems(entry, described, feedback_check)
    return problems


def check_catalog(catalog: Catalog, *, commands: dict[str, set[str]], workspace: Path,
                  registry: SourceRegistry, status_store: FileSourceStatusStore,
                  feedback_check: FeedbackCheck | None = None) -> dict:
    described = {d["id"]: d for d in describe(catalog)}
    results = []
    for entry in catalog.entries:
        problems = check_entry(entry, described[entry.id], commands=commands, workspace=workspace,
                               registry=registry, status_store=status_store, feedback_check=feedback_check)
        results.append({"id": entry.id, "complete": not problems, "problems": problems})
    return {"complete": all(r["complete"] for r in results), "entries": results}
