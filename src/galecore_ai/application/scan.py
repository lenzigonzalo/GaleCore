"""The screen a market agent runs by code before calling the model (P1-05): «oportunidades» every 30 minutes asks
GaleCore for the IV rank of each symbol and the calendar, and the model is called only when a symbol is a finding.

Cheap and deterministic: one IV rank per symbol and the release calendar of the next days. A symbol whose IV rank
did not come is «sin evaluar», never a finding; a calendar that did not come blocks every finding (the quiet window
cannot be checked). The model then does the expensive part (chains, greeks, max loss) only for the findings.
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta

from galecore_ai.application.drivers import RELEASE_NAMES, release_events
from galecore_ai.contracts.task import ScanRule

RELEASE_IDS = ",".join(str(i) for i in RELEASE_NAMES)


def business_days_ahead(today: date, n: int) -> list[str]:
    """Today and the next n business days (Mon–Fri; market holidays are not known here)."""
    out, d = [today.isoformat()], today
    while len(out) <= n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            out.append(d.isoformat())
    return out


async def screen(dispatcher, rule: ScanRule, today: date) -> dict:
    missing: list[str] = []

    async def ask(cap: str, params: dict):
        try:
            res = await dispatcher.invoke(cap, params)
        except Exception as exc:  # noqa: BLE001 - a failed call is declared, never a finding
            missing.append(f"{cap} {params.get('symbol', '')}: {type(exc).__name__}".strip())
            return None
        if not res.ok:
            missing.append(f"{cap} {params.get('symbol', '')}: {str(res.error)[:160]}".strip())
            return None
        return res.data

    window = business_days_ahead(today, rule.quiet_business_days)
    ranks = await asyncio.gather(*(ask("compute.iv_rank", {"symbol": s}) for s in rule.symbols))
    releases, fomc = await asyncio.gather(
        ask("calendar.macro_releases", {"From": window[0], "To": window[-1], "ReleaseIds": RELEASE_IDS}),
        ask("calendar.fomc_meetings", {"Years": f"{today.year},{today.year + 1}"}))
    blocking: list[dict] = []
    if releases is not None and fomc is not None:
        events = release_events(releases.get("data") or [], fomc.get("data") or [])
        blocking = [{"date": d, "release": k} for d in window for k in events.get(d, []) if k in rule.releases]
    calendar_ok = releases is not None and fomc is not None
    checked = []
    for s, raw in zip(rule.symbols, ranks, strict=True):
        rank = (raw or {}).get("ivRank") if isinstance(raw, dict) else None
        if not isinstance(rank, int | float):
            checked.append({"symbol": s, "result": "sin evaluar", "why": "sin IV rank de GaleCore"})
            continue
        row = {"symbol": s, "iv_rank": rank, "iv_rank_min": rule.iv_rank_min}
        if rank < rule.iv_rank_min:
            row |= {"result": "no", "why": f"IV rank {rank} < {rule.iv_rank_min}"}
        elif not calendar_ok:
            row |= {"result": "sin evaluar", "why": "sin calendario: no se puede ver la ventana sin datos"}
        elif blocking:
            row |= {"result": "cerca", "why": "dato en la ventana: " + ", ".join(f"{b['release']} {b['date']}"
                                                                              for b in blocking)}
        else:
            row |= {"result": "hallazgo", "why": f"IV rank {rank} ≥ {rule.iv_rank_min} y sin "
                                                 f"{', '.join(rule.releases)} hasta {window[-1]}"}
        checked.append(row)
    return {"window": window, "blocking_releases": blocking, "checked": checked,
            "findings": [c["symbol"] for c in checked if c["result"] == "hallazgo"], "missing": missing}


def summary(result: dict) -> str:
    return "; ".join(f"{c['symbol']} {c['result']} ({c['why']})" for c in result["checked"])
