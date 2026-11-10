"""A strategy that never enters because of the same cause (WS-0098, increment 5).

The Sandwich 1.3.0 evaluated every day and was stopped by its bet cap every time, for a week, and nobody was told. This
reads a running SHADOW instance's events and, when the last ``MIN_DAYS`` evaluated business days (New York) were each
stopped by the same cause and no position opened, raises one ``stalled`` alert per streak. The cause is GaleCore's own
(``payload.limit``, the failed gate, or the event type) and the sentence is the engine's ``payload.reason``. Deterministic.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

NEW_YORK = ZoneInfo("America/New_York")
MIN_DAYS = 3                      # proposed default, to confirm with the owner
BLOCKING = ("ENTRY_SKIPPED", "GATES_NOT_PASSED", "CANDIDATE_NOT_VIABLE", "RISK_CHECK_FAILED")
EVALUATED = BLOCKING + ("EVALUATION_COMPLETED", "POSITION_OPENED")


def _day(iso: str) -> date:
    return datetime.fromisoformat(iso).astimezone(NEW_YORK).date()


def cause_of(event: dict) -> str | None:
    """What stopped the entry, as a stable key; None for events that are not a block."""
    kind, p = event.get("eventType"), event.get("payload") or {}
    if kind not in BLOCKING:
        return None
    if kind == "ENTRY_SKIPPED":
        return f"{kind}:{p.get('limit') or 'other'}"
    if kind == "GATES_NOT_PASSED":
        failed = sorted(str(g.get("gate_id")) for g in p.get("gates") or [] if g.get("status") != "PASS")
        return f"{kind}:{','.join(failed) or 'other'}"
    return kind


def streak(events: list[dict], min_days: int = MIN_DAYS) -> dict | None:
    """The longest current run of evaluated days ending at the newest one, all stopped by one cause, or None."""
    by_day: dict[date, dict] = {}
    for e in events:
        if e.get("eventType") not in EVALUATED or not e.get("timestamp"):
            continue
        d = by_day.setdefault(_day(e["timestamp"]), {"causes": {}, "opened": False})
        if e["eventType"] == "POSITION_OPENED":
            d["opened"] = True
        elif (c := cause_of(e)):
            prev = d["causes"].get(c)
            if prev is None or e["timestamp"] > prev["timestamp"]:
                d["causes"][c] = e
    days = sorted(by_day)
    if not days or by_day[days[-1]]["opened"]:
        return None
    best: dict | None = None
    for c in by_day[days[-1]]["causes"]:
        run = []
        for d in reversed(days):
            causes = by_day[d]["causes"]
            if by_day[d]["opened"]:
                break
            if c not in causes:
                # A day stopped only by a market filter never reached the candidate: it neither confirms nor breaks
                # a candidate-level cause (the Sandwich's VIX days between its bet-cap days).
                if causes and not c.startswith("GATES_NOT_PASSED") and all(k.startswith("GATES_NOT_PASSED") for k in causes):
                    continue
                break
            run.append(d)
        if len(run) >= min_days and (best is None or len(run) > best["days"]):
            latest = by_day[days[-1]]["causes"][c]
            best = {"cause": c, "days": len(run), "since": run[-1].isoformat(), "until": run[0].isoformat(),
                    "reason": str((latest.get("payload") or {}).get("reason") or c.split(":")[0])}
    return best


def drafts_for(instances: list[dict], read, min_days: int = MIN_DAYS) -> tuple[list[dict], list[str]]:
    """(alert drafts, problems) for the running SHADOW instances. One unread instance is reported, the rest still run."""
    drafts, problems = [], []
    for inst in instances:
        if inst.get("mode") != "SHADOW" or inst.get("lifecycleState") != "RUNNING":
            continue
        iid = inst.get("instanceId", "")
        try:
            events = read(f"/App/Runtime/Instances/{iid}/Events?limit=500")
            if not isinstance(events, list):
                raise TypeError("eventos sin forma de lista")
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{inst.get('specName')}: eventos no leídos ({str(exc)[:120]})")
            continue
        run = streak(events, min_days)
        if run is None:
            continue
        name = inst.get("specName", "")
        drafts.append({
            "key": f"stalled:{iid}:{run['cause']}:{run['since']}", "kind": "stalled", "strategy": name,
            "strategy_ref": None, "instance_id": iid, "position_id": f"{run['cause']}@{run['since']}",
            "motivo": f"{run['days']} días hábiles seguidos sin entrar (desde el {run['since']}): {run['reason']}",
            "dato": {"dias": run["days"], "desde": run["since"], "causa": run["cause"], "motivo_del_motor": run["reason"]},
            "regla": f"aviso a los {min_days} días hábiles evaluados seguidos con la misma causa y sin posición",
            "propuesta": "Revisá si el límite o la regla que la frena es lo que querías: así no va a operar."})
    return drafts, problems
