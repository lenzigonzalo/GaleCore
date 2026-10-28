"""Strategy follow-up (GC-AI-0008, reused by the recurring task of GC-AI-0009).

«Mostrame mi estrategia, qué está ejecutando, qué pasó desde la última revisión y qué merece mi atención.»

Deterministic: no model call. It reads the strategy and its exact version from the knowledge base, reads GaleCore
through its API (``galecore-app/dev/galecore_dev.py runtime-report``, read-only, development environment), keeps that
output verbatim as evidence, and writes a follow-up record with three separate parts — operation, SHADOW results,
evidence about the hypothesis — plus what deserves attention. It never writes a strategy version, an approval or
a deployment: analysis cannot change the approved strategy.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from galecore_ai.adapters.knowledge_base import PRODUCT_ROOT
from galecore_ai.adapters.strategy_store import StrategyIntegrityError, StrategyStoreError
from galecore_ai.application.knowledge import KnowledgeBase, KnowledgeError, save_evidence
from galecore_ai.contracts.evidence import EvidenceContent
from galecore_ai.contracts.followup import FollowupMethod, FollowupRecord
from galecore_ai.contracts.regime_record import RecordHost
from galecore_ai.contracts.strategy import StrategyDocument, compute_document_hash

RUNNER = "galecore_ai.application.followup 1"
SKILL = "strategy_followup"
MIN_CLOSED_TRADES = 60      # sample the strategy's evaluation plan needs before any economic reading
REPORT_TIMEOUT_SECONDS = 180
_REPO = Path(__file__).resolve().parents[3]


class FollowupError(Exception):
    """The follow-up could not even start (no such strategy, unusable knowledge base)."""


# ── store ────────────────────────────────────────────────────────


def _dir(kb: KnowledgeBase, strategy: str) -> Path:
    return kb.base / "followups" / strategy


def history(kb: KnowledgeBase, strategy: str, limit: int | None = None) -> list[FollowupRecord]:
    """Records of a strategy, newest first. An edited record raises instead of being shown."""
    d = _dir(kb, strategy)
    if not d.is_dir():
        return []
    records = []
    for path in sorted(d.glob("*.json"), reverse=True):
        rec = FollowupRecord.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if compute_document_hash(rec.hashable_content()) != rec.content_hash:
            raise KnowledgeError(f"followup {path.name}: INTEGRITY_FAILED (content_hash mismatch)")
        records.append(rec)
        if limit and len(records) >= limit:
            break
    return records


def _write(kb: KnowledgeBase, rec: FollowupRecord) -> Path:
    path = _dir(kb, rec.strategy) / f"{rec.id.split('/', 1)[1]}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(rec.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
    _write_latest(kb, rec)
    return path


def _write_latest(kb: KnowledgeBase, rec: FollowupRecord) -> None:
    """LATEST.md: a derived, readable copy of the newest record (Obsidian, editor). The JSON is authoritative."""
    lines = [f"# Seguimiento de {rec.strategy} — último resultado", "",
             (f"*Derivado de `{rec.id}.json` (el registro con hash es la fuente). Estado: **{rec.status}**. "
              f"{rec.recorded_at:%Y-%m-%d %H:%M} UTC.*"), "",
             (f"- Versión evaluada: `{rec.strategy_ref}` (`{rec.spec_hash[:19]}…`), "
              f"{'aprobada' if rec.approved else '**no aprobada**'}"),
             (f"- Desde la revisión anterior: {rec.since:%Y-%m-%d %H:%M} UTC" if rec.since else
              "- Primera revisión registrada"),
             f"- Método: {rec.method.skill} · {rec.method.runner} · código {rec.method.code_commit[:10]}",
             (f"- Fuentes: {', '.join(rec.sources) or 'ninguna'}"
              + (f" · tarea `{rec.task_id}`" if rec.task_id else "")), ""]
    for title, items in (("Qué merece tu atención", rec.attention), ("Funcionamiento operativo", rec.operation),
                         ("Resultados SHADOW (fills simulados, no ejecuciones)", rec.shadow),
                         ("Evidencia sobre la hipótesis", rec.hypothesis), ("Otras versiones (no mezcladas)",
                                                                             rec.other_versions)):
        lines += [f"## {title}", ""] + ([f"- {x}" for x in items] or ["- (nada)"]) + [""]
    (_dir(kb, rec.strategy) / "LATEST.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")


NEWS_EVENTS = ("POSITION_OPENED", "POSITION_CLOSED", "CANDIDATE_CREATED")   # routine skips are not news


def has_news(rec: FollowupRecord) -> bool:
    """Whether the day's record has something for the briefing to say (WS-0025): an open position to value, a notice,
    or a position/candidate event since the last review. Closed positions stay in the record for good, and a day of
    gates not passed or entries skipped is routine: neither is news."""
    return bool(rec.attention) or any(
        line.startswith("Posición OPEN") or any(e in line for e in NEWS_EVENTS) for line in rec.shadow)


# ── reading the strategy and GaleCore ────────────────────────────


def _versions(kb: KnowledgeBase, strategy: str) -> tuple[StrategyDocument, bool]:
    """The approved version if one exists (newest approved), else the newest version, flagged not approved."""
    keys = [k for k in kb.strategies.versions() if k.split("/")[0] == strategy]
    if not keys:
        raise FollowupError(f"no strategy named {strategy} in the knowledge base")
    keys.sort(key=lambda k: tuple(int(x) for x in k.split("/")[1].split(".")))
    try:
        for key in reversed(keys):
            if kb.strategies.load_approval(key) is not None:
                return kb.strategies.load(key), True
        return kb.strategies.load(keys[-1]), False
    except (StrategyStoreError, StrategyIntegrityError) as exc:
        raise FollowupError(f"strategy {strategy}: not usable ({exc})") from exc


def _research_state(kb: KnowledgeBase, doc: StrategyDocument) -> str | None:
    """The hypothesis as the strategy's investigation last recorded it (its latest revision), never a fixed text."""
    ref = next((r for r in doc.content.research_refs if r.startswith("research:")), None)
    if ref is None:
        return None
    try:
        rd = kb.research.load(ref.split(":", 1)[1])
    except Exception:  # noqa: BLE001 - an unreadable investigation is reported, not hidden
        return f"{ref}: no se pudo leer (integridad); revisar"
    if rd is None:
        return None
    cur = rd.current
    return (f"Hipótesis según {ref} (revisión {cur.revision}, {cur.reason.value}, {cur.recorded_at:%Y-%m-%d}): "
            f"{cur.note[:400]}")


def default_report_command(root: Path, strategy: str) -> list[str]:
    # <root>/app/dev/galecore_dev.py; if it is absent the run fails and the follow-up records an ERROR.
    return [sys.executable, "-B", str(root / "galecore-app" / "dev" / "galecore_dev.py"), "runtime-report",
            "--spec", strategy, "--limit", "500"]


def _run_report(cmd: list[str]) -> tuple[int, str, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=REPORT_TIMEOUT_SECONDS, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, "", f"{type(exc).__name__}: {exc}"
    return r.returncode, r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace")


def _commit() -> str:
    try:
        r = subprocess.run(["git", "-C", str(_REPO), "rev-parse", "HEAD"], capture_output=True, text=True,
                           timeout=10, check=False)
        return r.stdout.strip() or "unknown"
    except OSError:
        return "unknown"


def _ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


# ── the analysis (deterministic) ─────────────────────────────────


def _other_positions(item: dict, label: str, others: list[str], attention: list[str]) -> None:
    """Open positions of an instance that is not the version followed: still valued, they count in the exposure."""
    inst = item.get("instance", {})
    where = f"{label} (instancia {inst.get('instanceId', '')[:8]}, {inst.get('lifecycleState')})"
    detail = item.get("detail", {})
    if not isinstance(detail.get("body"), dict):
        attention.append(f"{where}: GaleCore no devolvió sus posiciones (HTTP {detail.get('http')}); no verificadas")
        return
    for p in detail["body"].get("positions") or []:
        if p.get("status") != "OPEN":
            continue
        desc = (f"Posición abierta de {where}: crédito {p.get('entryCredit')}, valor {p.get('lastSpreadValue')}, "
                f"P&L simulado {p.get('unrealizedPnl')} USD, DTE {p.get('currentDte')}, riesgo máx. {p.get('maxRisk')}, "
                f"valuada {p.get('lastValuedAt')}")
        others.append(desc)
        attention.append(desc + " — se sigue valuando y cuenta en la exposición SHADOW")


def analyse(report: dict, doc: StrategyDocument, approved: bool, since: datetime | None,
            now: datetime, research_state: str | None = None,
            other_reports: dict[str, dict | None] | None = None) -> dict[str, list[str]]:
    """`other_reports`: the runtime report of every other spec with instances (None when it could not be read)."""
    op, shadow, hyp, others, attention = [], [], [], [], []
    ref = f"strategy:{doc.name}/{doc.version}"
    if not approved:
        attention.append(f"{ref} no está aprobada: no puede desplegarse hasta tu aprobación de su hash "
                         f"{doc.spec_hash[:19]}…")
    status = report.get("status", {})
    body = status.get("body") if isinstance(status, dict) else None
    if not isinstance(body, dict):
        attention.append(f"GaleCore respondió sin estado del runtime (HTTP {status.get('http')})")
        return {"operation": op, "shadow": shadow, "hypothesis": hyp, "other_versions": others,
                "attention": attention}
    pers = body.get("persistence") or {}
    op.append(f"Persistencia {'disponible' if pers.get('available') else 'NO disponible'}; recuperado al arrancar "
              f"{pers.get('recoveredAt', '?')}")
    sw = body.get("switch") or {}
    op.append(f"Switch del runtime: {'encendido' if sw.get('enabled') else 'apagado'} (decide: {sw.get('source')}); "
              "apagado = sin entradas nuevas, lo abierto se sigue valuando")
    if report.get("spec_content_hash") != doc.spec_hash:
        attention.append(f"GaleCore cargó {report.get('spec_content_hash')} para {doc.name}, no el hash de {ref}")
    else:
        op.append(f"GaleCore tiene cargada exactamente {ref} (hash coincide)")

    mine = [i for i in report.get("instances", []) if i.get("instance", {}).get("versionHash") == doc.spec_hash]
    for inst in (i for i in body.get("instances", []) if i.get("versionHash") != doc.spec_hash):
        if inst.get("lifecycleState") == "RUNNING":
            others.append(f"{inst.get('specName')} ({inst.get('versionHash', '')[:19]}…) {inst.get('lifecycleState')}"
                          f"/{inst.get('schedulerState')} — otra versión, no se mezcla con esta estrategia")
    # Earlier versions of this strategy and other specs (GC-AI-0017, run 7 of 30/09: a STOPPED instance's open
    # position was left out of the record, so the briefing reported zero exposure).
    for item in report.get("instances", []):
        if item.get("instance", {}).get("versionHash") != doc.spec_hash:
            _other_positions(item, f"{doc.name}, otra versión", others, attention)
    for spec, other in sorted((other_reports or {}).items()):
        if other is None:
            attention.append(f"No se pudo leer el reporte de {spec}: sus posiciones abiertas no están verificadas")
            continue
        if other.get("spec_name") not in (None, spec):
            attention.append(f"El reporte pedido para {spec} es de {other.get('spec_name')}: sus posiciones abiertas "
                             "no están verificadas")
            continue
        for item in other.get("instances", []):
            if item.get("instance", {}).get("specName") == spec:
                _other_positions(item, spec, others, attention)
    if not mine:
        op.append(f"{ref} no tiene instancia en GaleCore: no está desplegada")
        if approved:
            attention.append(f"{ref} está aprobada pero no desplegada")
        shadow.append("Sin instancia: no hay evaluaciones, entradas ni posiciones de esta versión")
    for item in mine:
        inst = item["instance"]
        op.append(f"Instancia {inst.get('instanceId', '')[:8]}: {inst.get('lifecycleState')}/{inst.get('schedulerState')}")
        events = [e for e in (item.get("events", {}).get("body") or []) if isinstance(e, dict)]
        new = [e for e in events if since is None or (_ts(e.get("timestamp")) or now) > since]
        counts: dict[str, int] = {}
        for e in new:
            counts[e.get("eventType", "?")] = counts.get(e.get("eventType", "?"), 0) + 1
        op.append("Eventos desde la revisión anterior: " + (", ".join(f"{k} {v}" for k, v in sorted(counts.items()))
                                                          or "ninguno"))
        last = max((_ts(e.get("timestamp")) for e in events if _ts(e.get("timestamp"))), default=None)
        op.append(f"Último evento del runtime: {last:%Y-%m-%d %H:%M} UTC" if last else "Sin eventos registrados")
        for e in new:
            et, p = e.get("eventType"), e.get("payload") or {}
            if et in ("GATES_NOT_PASSED", "CANDIDATE_NOT_VIABLE", "ENTRY_SKIPPED", "METRICS_NO_DATA"):
                shadow.append(f"{e.get('timestamp', '')[:16]} {et}: {p.get('reason') or p.get('gates') or p.get('metric_refs')}")
            elif et in ("POSITION_OPENED", "CANDIDATE_CREATED", "POSITION_CLOSED"):
                shadow.append(f"{e.get('timestamp', '')[:16]} {et}: {json.dumps(p, ensure_ascii=False)[:200]}")
        if counts.get("VALUATION_NO_DATA"):
            attention.append(f"{counts['VALUATION_NO_DATA']} valuaciones sin cotización utilizable desde la revisión "
                             "anterior (normal fuera de mercado; revisar si pasa en sesión)")
        positions = (item.get("detail", {}).get("body") or {}).get("positions") or []
        closed = [p for p in positions if p.get("status") != "OPEN"]
        for p in positions:
            desc = (f"Posición {p.get('status')}: crédito {p.get('entryCredit')}, valor {p.get('lastSpreadValue')}, "
                    f"P&L simulado {p.get('unrealizedPnl') if p.get('status') == 'OPEN' else p.get('realizedPnl')} USD, "
                    f"DTE {p.get('currentDte')}, valuada {p.get('lastValuedAt')}")
            shadow.append(desc + (f", salida {p.get('exitReason')}" if p.get("exitReason") else ""))
            if p.get("status") == "OPEN":
                exits = json.loads(doc.spec_json).get("exits", {}).get("deterministic", {})
                t_exit = (exits.get("time_exit") or {}).get("max_dte")
                if t_exit is not None and p.get("currentDte") is not None and p["currentDte"] <= t_exit + 2:
                    attention.append(f"Posición a {p['currentDte']} DTE, cerca de la salida por tiempo ({t_exit})")
        hyp.append(f"Operaciones cerradas de esta versión: {len(closed)} de {MIN_CLOSED_TRADES} que pide el plan "
                   "de evaluación; con esta muestra no hay evidencia económica")
    if not mine:
        hyp.append(f"Sin operaciones de esta versión: 0 de {MIN_CLOSED_TRADES} operaciones cerradas que pide el plan")
    hyp.append(research_state or "Sin investigación de la estrategia legible: el estado de la hipótesis no se puede informar")
    return {"operation": op, "shadow": shadow, "hypothesis": hyp, "other_versions": others, "attention": attention}


# ── the run ──────────────────────────────────────────────────────


def _evidence_of(report_out: str, err: str, code: int, ok: bool, spec: str, now: datetime) -> EvidenceContent:
    return EvidenceContent(
        source="galecore", tool="galecore-app/dev/galecore_dev.py runtime-report (GET App/Runtime/*, GaleCore Dev)",
        params={"spec": spec, "exit_code": code}, retrieved_at=now,
        series=[{"name": "estado del runtime SHADOW (status, instancias, posiciones, evaluaciones, eventos, métricas)"
                 if ok else "error al leer GaleCore", "unit": "n/a", "frequency": "snapshot",
                 "observation_dates": now.isoformat()}],
        payload=report_out if ok else (err or report_out or f"exit {code} sin salida"), payload_scope="full",
        access_notes=["Captura directa de la salida del comando (no transcripta por el host)"] +
                     ([] if ok else [f"exit code {code}: GaleCore no respondió o el reporte falló"]))


def _other_specs(kb: KnowledgeBase, report: dict, strategy: str, prompt: str, host: RecordHost, now: datetime,
                 command_for: Callable[[str], list[str]]) -> tuple[dict[str, dict | None], list[str]]:
    """The report of every other spec that has instances in GaleCore, each kept verbatim as evidence."""
    body = (report.get("status") or {}).get("body") or {}
    specs = sorted({i.get("specName") for i in body.get("instances", []) if isinstance(i, dict)
                    and i.get("specName") and i.get("specName") != strategy})
    reports: dict[str, dict | None] = {}
    sources: list[str] = []
    stamp = now.strftime("%Y%m%dT%H%M%SZ").lower()
    for spec in specs:
        code, out, err = _run_report(command_for(spec))
        try:
            reports[spec] = json.loads(out) if code == 0 else None
        except json.JSONDecodeError:
            reports[spec] = None
        ev, _ = save_evidence(kb=kb, slug=f"{spec.replace('_', '-')}-shadow-{stamp}", prompt=prompt, host=host,
                              content=_evidence_of(out, err, code, reports[spec] is not None, spec, now), now=now)
        sources.append(f"evidence:{ev.id}")
    return reports, sources


def run_followup(*, kb: KnowledgeBase, strategy: str, prompt: str, host: RecordHost, task_id: str | None = None,
                 report_command: list[str] | None = None, now: datetime | None = None,
                 other_report_command: Callable[[str], list[str]] | None = None) -> tuple[FollowupRecord, Path]:
    now = now or datetime.now(UTC)
    doc, approved = _versions(kb, strategy)
    # An ERROR run read nothing from GaleCore: anchoring on it would hide what happened before it.
    since = next((r.recorded_at for r in history(kb, strategy) if r.status != "ERROR"), None)
    cmd = report_command or default_report_command(PRODUCT_ROOT, strategy)
    code, out, err = _run_report(cmd)
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    report = None
    if code == 0:
        try:
            report = json.loads(out)
        except json.JSONDecodeError:
            report = None
    ok = report is not None
    ev_doc, _ = save_evidence(kb=kb, slug=f"{strategy.replace('_', '-')}-shadow-{stamp.lower()}", prompt=prompt,
                              host=host, content=_evidence_of(out, err, code, ok, strategy, now),
                              now=now)
    sources = [f"evidence:{ev_doc.id}"]
    if ok:
        # An injected report command (tests, another runner) answers for the other specs too: never the real API.
        command_for = other_report_command or ((lambda _spec: report_command) if report_command else
                                               (lambda spec: default_report_command(PRODUCT_ROOT, spec)))
        # (an injected command answers with this strategy's report: its other specs then read as "not verified")
        other_reports, other_sources = _other_specs(kb, report, strategy, prompt, host, now, command_for)
        sources += other_sources
        parts = analyse(report, doc, approved, since, now, _research_state(kb, doc), other_reports)
        status = "DEGRADED" if parts["attention"] else "OK"
    else:
        parts = {"operation": [f"No se pudo leer GaleCore (exit {code}): {(err or out).strip()[:300]}"],
                 "shadow": ["Sin datos de GaleCore en esta ejecución"],
                 "hypothesis": ["Sin cambios: no hubo datos"], "other_versions": [],
                 "attention": ["GaleCore Dev no respondió: ¿está levantada la API (`galecore_dev.py api`)?"]
                              + ([] if approved else [f"strategy:{doc.name}/{doc.version} no está aprobada"])}
        status = "ERROR"
    draft = FollowupRecord(
        id=f"{strategy}/{stamp}", strategy=strategy, strategy_ref=f"strategy:{doc.name}/{doc.version}",
        spec_hash=doc.spec_hash, approved=approved,
        research_ref=next((r for r in doc.content.research_refs), None), recorded_at=now, since=since,
        task_id=task_id, prompt=prompt, host=host,
        method=FollowupMethod(runner=RUNNER, skill=SKILL, code_commit=_commit()),
        sources=sources, status=status, content_hash="pending", **parts)
    rec = draft.model_copy(update={"content_hash": compute_document_hash(draft.hashable_content())})
    return rec, _write(kb, rec)
