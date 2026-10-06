"""A scheduled run of a capability by the model (GC-AI-0017).

The model only reads: it gets the capability's skill, the read commands of its catalog flow as its only tools and
a turn cap, and returns the result (research content) and the source responses it used (evidence) as JSON. This
module validates that JSON against the contracts and saves it through the same functions a session uses
(``save_evidence``, ``save_research``/``revise_research``), stamped with the scheduler as host. Nothing the model
writes reaches the knowledge base without passing those validators.

The model call is one swappable point (``ModelClient``): today Claude Code in print mode with the owner's plan
(owner decision 30/09); the Anthropic API is decided when moving to production.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, Field, ValidationError, field_validator

from galecore_ai.application.catalog_check import SCHEDULED_READS, SCHEDULED_SCRIPTS, flow_key
from galecore_ai.application.knowledge import (
    KnowledgeBase,
    KnowledgeError,
    check_content,
    revise_research,
    save_evidence,
    save_research,
)
from galecore_ai.contracts.evidence import EvidenceContent
from galecore_ai.contracts.regime_record import RecordHost
from galecore_ai.contracts.research import ResearchContent, RevisionReason
from galecore_ai.harness.assets import load_asset
from galecore_ai.harness.catalog import CatalogEntry
from galecore_ai.harness.definitions import SkillDefinition

CLI = "python -B -m galecore_ai.adapters.cli"
# An evidence reference in the model's content: `evidence:@<slug>` (asked) or `evidence:<slug-or-id>` (what a model
# used to sessions writes). Only the returned slugs and evidence already stored resolve.
EVIDENCE_REF = re.compile(r"evidence:(@?)([a-z0-9]+(?:-[a-z0-9]+)*)")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+){0,11}$")
PENDING = "9999-12-31-pending-"   # id prefix of evidence not saved yet, during the dry check
# Codex 03/10: the unattended model gets only what its flow needs, never the rest of the owner's environment.
ENV_KEEP = {"PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE",
            "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "USERNAME", "LANG",
            "MAX_STALENESS_SECONDS", "ALLOW_UNKNOWN_FRESHNESS"}   # FRED_API_KEY left with WS-0014: FRED by GaleCore
ENV_KEEP_PREFIXES = ("GALECORE_", "CLAUDE_", "ANTHROPIC_")
ENV_DROP = {"GALECORE_USERNAME", "GALECORE_PASSWORD"}   # the trader's login (GC-AI-0021): no flow of a run needs it
UNVERIFIED_NOTE = ("Escrito por el modelo en una corrida sin supervisión: los números y la evidencia que trae son "
                   "declarados por el modelo y el runner no los contrastó con los datos que trajo.")
# Advice addressed to the reader, not descriptions of a strategy's rules (internal recheck 03/10: the regime patterns
# refused "short put spreads", "stop-loss at 200%" or "risk-reward ratio", which a briefing about rules must say).
_ACT = r"(?:comprar|vender|abrir|cerrar|entrar|salir|mantener|acumular|sumar|agregar|reducir|rolear|ajustar)"
_ACT_EN = r"(?:buy|sell|short|open|close|enter|exit|hold|add|reduce|trim|roll|adjust)"
RECOMMENDATION = [re.compile(p, re.IGNORECASE) for p in (
    r"\b(?:te\s+)?(?:recomiendo|recomendamos|sugiero|sugerimos|aconsejo|aconsejamos)\b[^.;:!?\n]{0,40}?\b" + _ACT + r"\b",
    r"\b(?:conviene|convendr[ií]a|deber[ií]as|ten[eé]s\s+que|habr[ií]a\s+que)\s+" + _ACT + r"\b",
    r"\b(?:compr[aá]|vend[eé]|abr[ií]|cerr[aá]|entr[aá]|sal[ií])\s+(?:ya|ahora|hoy)\b",
    r"\b(?:I|we)\s+(?:recommend|suggest|advise)\b[^.;:!?\n]{0,40}?\b" + _ACT_EN + r"(?:ing)?\b",
    r"\byou\s+(?:should|must|need\s+to)\s+" + _ACT_EN + r"\b",
    r"\b" + _ACT_EN + r"\s+(?:now|today|immediately)\b",
)]
RUN_DIR_ENV = "GALECORE_AI_RUN_DIR"   # a scheduled script must not write outside it (SCHEDULED_SCRIPTS)


class ModelEvidence(BaseModel):
    model_config = {"extra": "forbid"}

    slug: str
    content: EvidenceContent

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not SLUG_RE.fullmatch(v):
            raise ValueError("slug is lowercase words separated by hyphens (at most 12)")
        return v


class ModelOutput(BaseModel):
    """What the model returns: the run's status, the evidence it used and the revision to save."""

    model_config = {"extra": "forbid"}

    status: str                                   # OK | INCOMPLETE
    reason: str = ""                              # what could not be obtained (required when INCOMPLETE)
    evidence: list[ModelEvidence] = Field(default_factory=list)
    content: ResearchContent


def output_schema() -> dict:
    """The shape the CLI enforces. Kept short: it travels as an argument (claude.CMD: 8191 characters in all); the
    full contracts go in the prompt and are enforced here, by pydantic, before anything is saved."""
    return {"type": "object", "additionalProperties": False, "required": ["status", "reason", "evidence", "content"],
            "properties": {"status": {"type": "string", "enum": ["OK", "INCOMPLETE"]}, "reason": {"type": "string"},
                           "evidence": {"type": "array", "items": {"type": "object"}},
                           "content": {"type": "object"}}}


def contract_text() -> str:
    """The full JSON Schema of what the model returns, for the prompt."""
    schema = ModelOutput.model_json_schema()
    schema["properties"]["status"] = {"type": "string", "enum": ["OK", "INCOMPLETE"]}
    return json.dumps(schema, ensure_ascii=False)


@dataclass
class ModelReply:
    ok: bool
    structured: dict | None = None
    turns: int | None = None
    duration_s: float | None = None
    model: str | None = None
    error: str | None = None
    tokens: dict | None = None     # input, output, cache_read, cache_write (GC-AI-0024: consumption per capability)


def usage_of(out: dict) -> dict | None:
    """The tokens a print-mode run reports (`usage`), named for the inventory; None when it reports none."""
    u = out.get("usage")
    if not isinstance(u, dict):
        return None
    names = {"input": "input_tokens", "output": "output_tokens", "cache_read": "cache_read_input_tokens",
             "cache_write": "cache_creation_input_tokens"}
    got = {k: u[v] for k, v in names.items() if isinstance(u.get(v), int)}
    return got or None


def add_tokens(a: dict | None, b: dict | None) -> dict | None:
    if not a or not b:
        return a or b
    return {k: a.get(k, 0) + b.get(k, 0) for k in {**a, **b}}


class ModelClient(Protocol):
    def run(self, *, prompt: str, allowed: list[str], max_turns: int, schema: dict, cwd: Path,
            timeout_s: int, add_dir: Path) -> ModelReply: ...


def _real_binary(found: str | None) -> str | None:
    """npm installs `claude.cmd`, which starts `claude.exe` as a grandchild: a timeout would kill only cmd.exe and the
    8191-character limit of cmd.exe would apply. Use the executable it points to when it is there."""
    if found and found.lower().endswith(".cmd"):
        exe = Path(found).parent / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
        if exe.is_file():
            return str(exe)
    return found


def _kill_tree(proc: subprocess.Popen) -> None:
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, check=False)
    else:                                   # started in its own session: the group is the whole tree
        os.killpg(proc.pid, signal.SIGKILL)


class ClaudeCodeClient:
    """Claude Code in print mode, isolated: no user/project settings or MCP servers, only Bash and Read, and Bash
    only for the allowed command prefixes (anything else is denied: nobody is there to approve it)."""

    def __init__(self, binary: str | None = None, model: str | None = None) -> None:
        self.model = model                 # the capability's model (catalog schedulable.model); None = host default
        self.binary = _real_binary(binary or os.environ.get("CLAUDE_BIN") or shutil.which("claude")
                                   or shutil.which("claude.cmd"))

    def command(self, *, allowed: list[str], max_turns: int, schema: dict, add_dir: Path) -> list[str]:
        # The prompt goes on stdin: as an argument it would exceed the command-line limit.
        tools = ["--tools", "Bash,Read", "--add-dir", str(add_dir)] if allowed else ["--tools", ""]
        return [self.binary or "claude", "-p", "--output-format", "json", "--max-turns", str(max_turns),
                "--no-session-persistence", "--restricted", "--strict-mcp-config", *tools,
                "--json-schema", json.dumps(schema), *(["--model", self.model] if self.model else []),
                *(["--allowedTools", *allowed] if allowed else [])]

    def run(self, *, prompt: str, allowed: list[str], max_turns: int, schema: dict, cwd: Path,
            timeout_s: int, add_dir: Path) -> ModelReply:
        if not self.binary:
            return ModelReply(ok=False, error="claude not found on PATH")
        env = {k: v for k, v in os.environ.items()
               if (k.upper() in ENV_KEEP or k.upper().startswith(ENV_KEEP_PREFIXES)) and k.upper() not in ENV_DROP}
        env |= {"PYTHONPATH": str(cwd / "src"), RUN_DIR_ENV: str(add_dir)}
        t0 = time.monotonic()
        cmd = self.command(allowed=allowed, max_turns=max_turns, schema=schema, add_dir=add_dir)
        try:
            proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
                                    start_new_session=sys.platform != "win32")
        except OSError as exc:
            return ModelReply(ok=False, error=f"cannot start {cmd[0]}: {exc}")
        try:
            stdout, stderr = proc.communicate(prompt, timeout=timeout_s)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)                       # the whole tree: a model still working is stopped, not waited for
            try:
                proc.communicate(timeout=10)
            except subprocess.TimeoutExpired:      # a grandchild still holds the pipes: close them, do not wait
                proc.kill()
                for pipe in (proc.stdin, proc.stdout, proc.stderr):
                    if pipe:
                        pipe.close()
            return ModelReply(ok=False, duration_s=round(time.monotonic() - t0, 1),
                              error=f"time cap reached ({timeout_s // 60} min)")
        wall = round(time.monotonic() - t0, 1)
        try:
            out = json.loads(stdout)
        except json.JSONDecodeError:
            return ModelReply(ok=False, duration_s=wall,
                              error=f"exit {proc.returncode}, output is not JSON: {(stderr or stdout)[-300:]}")
        if not isinstance(out, dict):
            return ModelReply(ok=False, duration_s=wall, error=f"exit {proc.returncode}, output is not a JSON object")
        turns, model, tokens = out.get("num_turns"), next(iter(out.get("modelUsage") or {}), None), usage_of(out)
        if proc.returncode != 0 or out.get("is_error") or not isinstance(out.get("structured_output"), dict):
            why = out.get("subtype") or "error"
            if why == "error_max_turns":
                why = f"turn cap reached ({max_turns})"
            return ModelReply(ok=False, turns=turns, duration_s=wall, model=model, tokens=tokens,
                              error=f"{why}: {str(out.get('result') or '')[:300]}".rstrip(": "))
        return ModelReply(ok=True, structured=out["structured_output"], turns=turns, duration_s=wall, model=model,
                          tokens=tokens)


def allowed_tools(entry: CatalogEntry, commands: dict[str, set[str]]) -> list[str]:
    """The model's tools: the read commands of the capability's flow (and its scripts), as command prefixes."""
    rules: list[str] = ["Read"]
    for line in entry.flow:
        tokens = line.split()
        if not tokens:
            continue
        if tokens[0] == "python":
            if len(tokens) > 1 and tokens[1] in SCHEDULED_SCRIPTS:
                rules.append(f"Bash(python -B {tokens[1].partition('/')[2]}:*)")
            continue
        key = flow_key(tokens, commands)
        if key in SCHEDULED_READS:   # never a write: the runner runs the follow-up and saves the result
            rules.append(f"Bash({CLI} {' '.join(k for k in key if k)}:*)")
    return list(dict.fromkeys(rules))


def build_prompt(*, entry: CatalogEntry, task, target: str | None, run_dir: Path, now: datetime,
                 allowed: list[str], followup_note: str = "") -> str:
    skill = load_asset(entry.skill, SkillDefinition)
    save = f"a revision of {target}" if target else f"a new investigation (slug {task.result_slug})"
    tools = "\n".join(f"  - {r}" for r in allowed)
    return f"""You are running unattended: the Windows Task Scheduler started task `{task.id}` ({task.schedule.describe()}).
Nobody is present; do not ask questions. Task objective, in the owner's words: {task.objective}
Strategy: {task.strategy or 'none: this agent watches the market'}. Now: {now.isoformat()} (UTC).

Follow the method below ({entry.id}, skill {skill.version}). Run the CLI exactly as `{CLI} <command> ...` from the
current directory and scripts as `python -B tools/<script>.py ...`; a script writes only under {run_dir} (use it as
<dir>; any other directory is refused). Commands outside this list that change anything are denied:
{tools}
{followup_note}

You cannot run `followup run`, `evidence add`, `research save` or `research revise`. Return, as the structured output:
- `evidence`: every source response you used that is not already a stored ref, as {{slug, content}} (EvidenceContent,
  payload verbatim; slug: lowercase words with hyphens, no date, e.g. `fred-releases`). Cite it in `content` exactly
  as `evidence:@<slug>`: the runner stores it and replaces the reference with the stored id. Do not invent ids.
- `content`: the ResearchContent to save as {save}, with the antecedents the method requires (profile in force,
  strategy ref, follow-up records and evidence). Do not cite {target or 'the investigation being saved'} itself:
  the revision chain already links the previous revision.
- `status`: OK when the method was completed; INCOMPLETE when data it needs could not be obtained: say which in
  `reason` and in content.missing. Never estimate or invent a value to complete it.

# Method
{skill.system_prompt}
# Commands of the method
{skill.instructions}
# Contract of your structured output (JSON Schema; the runner rejects anything else)
{contract_text()}"""


def _map_refs(value, fn):
    """Apply `fn` to every evidence reference inside the content's strings."""
    if isinstance(value, str):
        return EVIDENCE_REF.sub(lambda m: fn(m.group(2), m.group(0)), value)
    if isinstance(value, list):
        return [_map_refs(v, fn) for v in value]
    if isinstance(value, dict):
        return {k: _map_refs(v, fn) for k, v in value.items()}
    return value


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)


def cited_slugs(output: ModelOutput) -> set[str]:
    names: set[str] = set()
    _map_refs(output.content.model_dump(mode="json"), lambda name, whole: names.add(name) or whole)
    return names


def check_refs(kb: KnowledgeBase, output: ModelOutput, target: str | None,
               save_at: datetime | None = None) -> list[str]:
    """What would make the save fail, found before anything is written (no orphan evidence)."""
    slugs = [e.slug for e in output.evidence]
    problems = [f"evidence slugs repeat: {slugs}"] if len(slugs) != len(set(slugs)) else []
    if save_at is not None:
        problems += [f"evidence {e.slug}: retrieved_at {e.content.retrieved_at.isoformat()} is after the save time"
                     for e in output.evidence if e.content.retrieved_at > save_at]
    data = output.content.model_dump(mode="json")
    unknown: set[str] = set()
    stored = set(kb.evidence.ids())

    def seen(name: str, whole: str) -> str:
        if name not in slugs and name not in stored:
            unknown.add(name)
        return whole
    _map_refs(data, seen)
    if unknown:
        problems.append(f"content cites evidence it did not return and that is not stored: {sorted(unknown)}")
    for text in _strings(data):
        hit = next((m.group() for p in RECOMMENDATION if (m := p.search(text))), None)
        if hit:
            problems.append(f"content contains a trading recommendation ('{hit}'): describe, never direct")
            break
    if target and any(target == s.strip() for s in _strings(data)):
        problems.append(f"content cites {target}, the investigation being revised (the revision chain links it)")
    if problems:
        return problems
    # The store's own controls, with the evidence still to be saved standing in under ids that cannot exist.
    pending = _map_refs(data, lambda name, whole: f"evidence:{PENDING}{name}" if name in slugs else whole)
    _, content_problems = check_content(ResearchContent.model_validate(pending), kb,
                                        self_id=target.removeprefix("research:") if target else None)
    return [pr for pr in content_problems if PENDING not in pr]


class RunRefused(Exception):
    """The model's output could not be saved; the message says why (it is the run's recorded reason)."""


def save_output(*, kb: KnowledgeBase, output: ModelOutput, task, target: str | None, host: RecordHost,
                now: datetime) -> tuple[str, int, list[Path]]:
    """Evidence first, then the research revision; returns (research ref, revision, written paths)."""
    written: list[Path] = []
    refs: dict[str, str] = {}
    if problems := check_refs(kb, output, target, save_at=now):
        raise RunRefused("; ".join(problems))
    stamp = now.strftime("%H%M")
    cited = cited_slugs(output)
    for ev in (e for e in output.evidence if e.slug in cited):   # returned but never cited: not kept
        slug = f"{task.id}-{stamp}-{ev.slug}"
        try:
            doc, path = save_evidence(kb=kb, slug=slug, prompt=task.objective, host=host, content=ev.content, now=now)
        except KnowledgeError as exc:
            raise RunRefused(f"evidence {ev.slug}: {exc}") from exc
        refs[ev.slug] = f"evidence:{doc.id}"
        written.append(path)
    content = ResearchContent.model_validate(
        _map_refs(output.content.model_dump(mode="json"), lambda name, whole: refs.get(name, whole)))
    if UNVERIFIED_NOTE not in content.limitations:
        content = content.model_copy(update={"limitations": [*content.limitations, UNVERIFIED_NOTE]})
    try:
        if target:
            doc, path = revise_research(kb=kb, research_id=target.removeprefix("research:"),
                                        reason=RevisionReason.CONTINUATION,
                                        note=f"corrida programada de la tarea {task.id} ({now:%Y-%m-%d %H:%M} UTC)",
                                        prompt=task.objective, host=host, content=content, now=now,
                                        capability=task.kind)
        else:
            doc, path = save_research(kb=kb, slug=task.result_slug, prompt=task.objective, host=host,
                                      content=content, now=now, capability=task.kind)
    except KnowledgeError as exc:
        raise RunRefused(f"research: {exc}") from exc
    written.append(path)
    return f"research:{doc.id}", doc.current.revision, written


REPAIR_TURNS = 4


def repair_prompt(structured: dict, problems: list[str]) -> str:
    """One correction round, without tools: the model fixes what the validators refused, nothing else."""
    listed = "\n".join(f"- {p}" for p in problems)
    return f"""Your structured output for a scheduled run was refused by the validators, for these reasons:
{listed}

Return the same output corrected: change only what these reasons require and keep everything else as it is. You have
no tools and no new data. A fact with no source becomes an interpretation or goes to `missing`; own arithmetic is an
interpretation; never invent a source, a reference or a value. Cite returned evidence as `evidence:@<slug>`.

# Your output
{json.dumps(structured, ensure_ascii=False)}

# Contract (JSON Schema)
{contract_text()}"""


def parse_output(structured: dict) -> ModelOutput:
    try:
        out = ModelOutput.model_validate(structured)
    except ValidationError as exc:
        raise RunRefused(f"output does not match the contract: {str(exc)[:500]}") from exc
    if out.status not in ("OK", "INCOMPLETE"):
        raise RunRefused(f"status must be OK or INCOMPLETE, got {out.status!r}")
    if out.status == "INCOMPLETE" and not out.reason.strip():
        raise RunRefused("an INCOMPLETE run must say what was missing (reason)")
    return out
