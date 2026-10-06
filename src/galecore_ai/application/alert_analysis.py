"""«Analizá este aviso» (WS-0008, P1-01b, U-70): one model run from an alert, its result back under the alert.

The owner taps the button on an alert in the monitor; the monitor writes ``analysis_requests[<alert>]`` in the
supervisor's piece and the next pass of the space (every 5 minutes) starts the run in the background, so the pass
keeps watching. The code gathers the context — the alert and its decision, the position if it has one, the
strategy's exits and limit, and the current numbers from GaleCore — and the model, with no tools, says in a few lines
what the alert means now. The policy picks the model from the kind of work (GC-AI-0025: reading → sonnet). The
runner refuses advice addressed to the reader with the same patterns as a scheduled run, gives the model one
correction round, and stores the result create-only and hashed; the next pass shows it in the monitor.

One done analysis per alert (asking again shows the same one, no new run); a failed one says why and can be asked
again. A run that dies leaves its marker: after ``RUNNING_STALE_MINUTES`` it shows as failed and can be asked again.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from galecore_ai.application import model_run, watch
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError
from galecore_ai.contracts.strategy import compute_document_hash
from galecore_ai.contracts.supervision import (
    METRIC_LABELS,
    Alert,
    AlertAnalysis,
    AnalysisStatus,
    WatchMetric,
)
from galecore_ai.harness.assets import load_asset
from galecore_ai.harness.catalog import Schedulable
from galecore_ai.harness.definitions import SkillDefinition

SKILL = "skills/alert-analysis/skill.yaml"
# The policy's model for reading work (the code gathers the data; the model only reads it). No tools: 2 turns are
# enough for the structured answer; the correction round has its own.
RUN = Schedulable(runs="model", work="reading", max_turns=3, timeout_minutes=5)
RUNNING_STALE_MINUTES = 15
SUMMARY_MAX = 200
DETAIL_MAX = 1200
_REPO = Path(__file__).resolve().parents[3]
CLI = [sys.executable, "-B", "-m", "galecore_ai.adapters.cli"]

SCHEMA = {"type": "object", "additionalProperties": False, "required": ["summary", "detail", "missing"],
          "properties": {"summary": {"type": "string"}, "detail": {"type": "string"},
                         "missing": {"type": "array", "items": {"type": "string"}}}}

Reader = Callable[[str], object]


def _dir(kb: KnowledgeBase) -> Path:
    return kb.base / "supervision" / "analyses"


def analyses(kb: KnowledgeBase) -> list[AlertAnalysis]:
    """Every analysis, newest first. An edited one raises instead of being shown."""
    d = _dir(kb)
    out = []
    for path in sorted(d.glob("*.json")) if d.is_dir() else []:
        a = AlertAnalysis.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if compute_document_hash(a.hashable_content()) != a.content_hash:
            raise KnowledgeError(f"analysis {path.name}: INTEGRITY_FAILED (content_hash mismatch)")
        out.append(a)
    return sorted(out, key=lambda a: a.finished_at, reverse=True)


def latest(kb: KnowledgeBase) -> dict[str, AlertAnalysis]:
    """alert id -> its done analysis, or else its latest failed one."""
    out: dict[str, AlertAnalysis] = {}
    for a in analyses(kb):                           # newest first
        have = out.get(a.alert)
        if have is None or (have.status != AnalysisStatus.DONE and a.status == AnalysisStatus.DONE):
            out[a.alert] = a
    return out


def _write(kb: KnowledgeBase, analysis: AlertAnalysis) -> Path:
    d = _dir(kb)
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{analysis.alert}~{analysis.finished_at.astimezone(UTC):%Y%m%dT%H%M%S%fZ}.json"
    with path.open("x", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(analysis.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
    return path


# ── running marker ───────────────────────────────────────────────


def _marker(kb: KnowledgeBase, alert_id: str) -> Path:
    return _dir(kb) / f"{alert_id}.running"


def _read_mark(kb: KnowledgeBase, alert_id: str) -> tuple[dict, datetime] | None:
    try:
        mark = json.loads(_marker(kb, alert_id).read_text(encoding="utf-8"))
        return mark, datetime.fromisoformat(mark["started_at"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def running(kb: KnowledgeBase, alert_id: str, now: datetime | None = None) -> dict | None:
    """The marker of a run in progress ({requested_at, started_at, ...}), None if none or stale."""
    got = _read_mark(kb, alert_id)
    if got is None or (now or datetime.now(UTC)) - got[1] > timedelta(minutes=RUNNING_STALE_MINUTES):
        return None
    return got[0]


# ── context (code, no model) ─────────────────────────────────────


def _alert_dict(a: Alert) -> dict:
    return {"tipo": a.kind.value, "estrategia": a.strategy, "detectado": a.detected_at.isoformat(),
            "motivo": a.motivo, "dato": a.dato, "regla": a.regla, "propuesta": a.propuesta, "opciones": a.options}


def _position(positions, position_id: str) -> dict | None:
    if not isinstance(positions, list):
        return None
    for p in positions:
        if isinstance(p, dict) and str(p.get("positionId")) == position_id:
            return {k: v for k, v in p.items() if isinstance(v, (str, int, float, bool)) or v is None}
    return None


def gather(kb: KnowledgeBase, alert: Alert, read: Reader, decision: dict | None = None) -> tuple[dict, list[str], list[str]]:
    """(context the model gets, GaleCore endpoints read, what was missing). A failed read is declared, never fatal."""
    ctx: dict = {"aviso": _alert_dict(alert), "decision_del_owner": decision}
    sources: list[str] = []
    missing: list[str] = []

    def get(path: str):
        try:
            payload = read(path)
        except Exception as exc:  # noqa: BLE001 - one source unread is declared; the rest still go
            missing.append(f"{path.split('?')[0]}: {str(exc)[:120]}")
            return None
        sources.append(path.split("?")[0])
        return payload

    symbol = str(alert.dato.get("symbol") or "SPY")
    if not watch.SYMBOL.match(symbol):                   # it goes into a GaleCore path
        missing.append(f"símbolo no válido en el aviso: {symbol[:20]!r}")
        symbol = "SPY"
    now_numbers: dict = {}
    cache: dict[str, object] = {}                        # one read per source (the GEX gives three levels)
    for metric, sym in ((WatchMetric.PRICE, symbol), (WatchMetric.IV_RANK, symbol), (WatchMetric.GAMMA_ZERO, "SPY"),
                        (WatchMetric.CALL_WALL, "SPY"), (WatchMetric.PUT_WALL, "SPY")):
        path = watch.SOURCES[metric].format(symbol=sym)
        if path not in cache:
            cache[path] = get(path)
        label = f"{METRIC_LABELS[metric]} de {sym}"
        if cache[path] is None:                          # unread: already declared by `get`
            continue
        value = watch.read_metric(cache[path], metric)
        if value is None:
            missing.append(f"GaleCore no dio {label}")
        else:
            now_numbers[label] = value
    ctx["ahora"] = {"leido_at": datetime.now(UTC).isoformat(), **now_numbers}

    if alert.instance_id:
        pos = _position(get(f"/App/Runtime/Instances/{alert.instance_id}/Positions"), alert.position_id)
        if pos is None:
            missing.append(f"la posición {alert.position_id[:8]} en GaleCore")
        ctx["posicion"] = pos
    if alert.strategy_ref:
        doc = kb.strategies.load(alert.strategy_ref.removeprefix("strategy:"))
        if doc is None:
            missing.append(f"la spec de {alert.strategy_ref}")
        else:
            spec = json.loads(doc.spec_json)
            ctx["reglas_de_la_estrategia"] = {"ref": alert.strategy_ref, "exits": spec.get("exits"),
                                              "risk_limits": spec.get("risk_limits")}
    ctx["faltante"] = missing
    return ctx, sources, missing


# ── the model ────────────────────────────────────────────────────


def build_prompt(ctx: dict) -> str:
    skill = load_asset(SKILL, SkillDefinition)
    return f"""{skill.system_prompt}

# Context gathered by the code (JSON)
{json.dumps(ctx, ensure_ascii=False, indent=1, default=str)}

Return JSON with `summary`, `detail` and `missing` (a list of strings, empty if nothing was missing)."""


def problems_of(structured: dict) -> list[str]:
    """Why the runner refuses this output (empty: accepted)."""
    out = []
    summary, detail = structured.get("summary"), structured.get("detail")
    if not isinstance(summary, str) or not summary.strip():
        out.append("summary is empty")
    elif len(summary) > SUMMARY_MAX:
        out.append(f"summary has {len(summary)} characters; at most {SUMMARY_MAX}")
    if not isinstance(detail, str) or not detail.strip():
        out.append("detail is empty")
    elif len(detail) > DETAIL_MAX:
        out.append(f"detail has {len(detail)} characters; at most {DETAIL_MAX}")
    if not isinstance(structured.get("missing"), list) or not all(isinstance(m, str) for m in structured["missing"]):
        out.append("missing must be a list of strings")
    text = "\n".join([summary or "", detail or "", *[m for m in structured.get("missing") or [] if isinstance(m, str)]])
    for pattern in model_run.RECOMMENDATION:
        if m := pattern.search(text):
            out.append(f"advice addressed to the reader is not allowed: «{m.group(0)}»; describe, the decision is "
                       "the owner's")
    return out


def _repair(structured: dict, problems: list[str]) -> str:
    listed = "\n".join(f"- {p}" for p in problems)
    return f"""Your answer was refused for these reasons:
{listed}

Return it corrected: change only what these reasons require. You have no tools and no new data.

# Your answer
{json.dumps(structured, ensure_ascii=False)}"""


def analyze(kb: KnowledgeBase, alert_id: str, read: Reader, client: model_run.ModelClient, *, requested_at: datetime,
            requested_by: str, prompt: str, now: datetime | None = None) -> AlertAnalysis:
    """Run the analysis of one alert and store it (done or failed). Refused if it already has a done one."""
    from galecore_ai.application import supervisor as sv

    alert = sv.load_alert(kb, alert_id)
    have = latest(kb).get(alert_id)
    if have is not None and have.status == AnalysisStatus.DONE:
        raise KnowledgeError(f"alert {alert_id} already has an analysis ({have.finished_at:%d/%m %H:%M})")
    t0 = time.monotonic()
    ctx: dict = {}
    sources: list[str] = []
    missing: list[str] = []
    reply = model_run.ModelReply(ok=False)
    try:
        ctx, sources, missing = gather(kb, alert, read, sv.decisions(kb).get(alert_id))
        if isinstance(client, model_run.ClaudeCodeClient):
            client.model = RUN.model                     # always the policy's model, never a fallback
        scratch = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "GaleCore-AI" / "analyses" / alert_id
        scratch.mkdir(parents=True, exist_ok=True)
        text = build_prompt(ctx)
        (scratch / "prompt.txt").write_text(text, encoding="utf-8")
        reply = client.run(prompt=text, allowed=[], max_turns=RUN.max_turns, schema=SCHEMA, cwd=_REPO,
                           timeout_s=RUN.timeout_minutes * 60, add_dir=scratch)
    except Exception as exc:  # noqa: BLE001 - stored as a failed analysis: the monitor shows why (review 06/10)
        reply = model_run.ModelReply(ok=False, error=f"{type(exc).__name__}: {exc}"[:300])
    tokens, error, out = reply.tokens, reply.error, None
    if reply.ok:
        problems = problems_of(reply.structured or {})
        if problems:
            fixed = client.run(prompt=_repair(reply.structured or {}, problems), allowed=[], max_turns=RUN.max_turns,
                               schema=SCHEMA, cwd=_REPO, timeout_s=RUN.timeout_minutes * 60, add_dir=scratch)
            tokens = model_run.add_tokens(tokens, fixed.tokens)
            again = problems_of(fixed.structured or {}) if fixed.ok else [fixed.error or "the correction failed"]
            if again:
                error = "salida rechazada: " + "; ".join(again)[:300]
            else:
                out = fixed.structured
        else:
            out = reply.structured
    finished = now or datetime.now(UTC)
    analysis = AlertAnalysis(
        alert=alert.id, alert_hash=alert.content_hash, requested_at=requested_at, requested_by=requested_by,
        prompt=prompt, finished_at=finished, status=AnalysisStatus.DONE if out else AnalysisStatus.FAILED,
        summary=(out or {}).get("summary", "").strip(), detail=(out or {}).get("detail", "").strip(),
        missing=sorted({*missing, *((out or {}).get("missing") or [])}), context=ctx, sources=sources,
        model=reply.model, route=RUN.route_reason(), tokens=tokens, duration_s=round(time.monotonic() - t0, 1),
        error=None if out else (error or "sin respuesta del modelo"))
    analysis = analysis.model_copy(update={"content_hash": compute_document_hash(analysis.hashable_content())})
    _write(kb, analysis)
    return analysis


# ── from the monitor ─────────────────────────────────────────────


def spawn_run(alert_id: str, requested_at: str, user: str | None) -> None:
    """Start `supervise analyze` detached: the pass of the space does not wait for the model."""
    cmd = [*CLI, "supervise", "analyze", alert_id, "--requested-at", requested_at, "--source", "monitor",
           "--prompt", f"«Analizá este aviso» desde el monitor por {user or 'el owner'} ({requested_at})"]
    env = {**os.environ, "PYTHONPATH": str(_REPO / "src")}
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW

    def popen(extra: int) -> None:
        subprocess.Popen(cmd, cwd=_REPO, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, creationflags=flags | extra,
                         start_new_session=sys.platform != "win32")

    if sys.platform != "win32":
        popen(0)
        return
    try:                       # out of the Task Scheduler's job: it may end the tree when the pass ends (review 06/10)
        popen(subprocess.CREATE_BREAKAWAY_FROM_JOB)
    except OSError:            # a job that forbids breakaway: started inside it
        popen(0)


def start(kb: KnowledgeBase, alert_id: str, requested_at: str, user: str | None, now: datetime,
          spawn: Callable[[str, str, str | None], None] = spawn_run) -> str:
    """Start one requested run: "started", "done" (already analysed) or "running". Raises if it cannot start."""
    from galecore_ai.application import supervisor as sv

    sv.load_alert(kb, alert_id)                          # an unknown alert raises
    have = latest(kb).get(alert_id)
    if have is not None and have.status == AnalysisStatus.DONE:
        return "done"
    if running(kb, alert_id, now) is not None:
        return "running"
    if have is not None and have.finished_at >= _aware(requested_at):
        return "done"                                    # this request was already answered (a failed run)
    path = _marker(kb, alert_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"requested_at": requested_at, "by": user, "started_at": now.isoformat()}),
                    encoding="utf-8")
    try:
        spawn(alert_id, requested_at, user)
    except OSError:
        path.unlink(missing_ok=True)
        raise
    return "started"


def _aware(at: str) -> datetime:
    """An ISO datetime from the monitor; one without a zone is UTC (the monitor writes toISOString, with Z)."""
    d = datetime.fromisoformat(at)
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def apply_requests(kb: KnowledgeBase, content: dict, user: str | None, now: datetime,
                   spawn: Callable[[str, str, str | None], None] = spawn_run) -> tuple[list[dict], dict[str, str]]:
    """Start the runs the owner asked for in the monitor; return (what was done, alert id -> why it did not start)."""
    done, errors = [], {}
    asked = content.get("analysis_requests")
    if not isinstance(asked, dict):                      # the piece is editable from outside: never break the pass
        return done, ({"analysis_requests": "no es un objeto"} if asked else {})
    for alert_id, r in asked.items():
        at = r.get("at") if isinstance(r, dict) else None
        try:
            result = start(kb, str(alert_id), _aware(str(at)).isoformat(), user, now, spawn)
            done.append({"alert": alert_id, "analysis": result})
        except (KnowledgeError, ValueError, TypeError, OSError) as exc:
            errors[alert_id] = str(exc)[:300]
            done.append({"alert": alert_id, "analysis": "refused", "error": errors[alert_id]})
    return done, errors


def view(kb: KnowledgeBase, alert_ids: list[str], now: datetime | None = None) -> dict[str, dict]:
    """alert id -> what the monitor shows under it: running, done (with the text) or failed (with why)."""
    now = now or datetime.now(UTC)
    have = latest(kb)
    out = {}
    for alert_id in alert_ids:
        a = have.get(alert_id)
        mark = running(kb, alert_id, now)
        if a is not None and a.status == AnalysisStatus.DONE:
            out[alert_id] = {"status": "done", "at": a.finished_at.isoformat(), "summary": a.summary,
                             "detail": a.detail, "missing": a.missing, "model": a.model, "route": a.route,
                             "tokens": a.tokens, "duration_s": a.duration_s}
        elif mark is not None:
            out[alert_id] = {"status": "running", "at": mark["started_at"]}
        elif (stale := _read_mark(kb, alert_id)) is not None and (a is None or a.finished_at < stale[1]):
            out[alert_id] = {"status": "failed", "at": stale[1].isoformat(),   # the run died without a result
                             "error": f"la corrida no terminó en {RUNNING_STALE_MINUTES} min; podés pedirla de nuevo"}
        elif a is not None:
            out[alert_id] = {"status": "failed", "at": a.finished_at.isoformat(), "error": a.error, "model": a.model}
    return out


def finish(kb: KnowledgeBase, alert_id: str) -> None:
    """Remove the marker once the run stored its result."""
    _marker(kb, alert_id).unlink(missing_ok=True)
