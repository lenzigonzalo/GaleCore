"""The state right now, read from GaleCore in this run (WS-0023, P1-PPa §A).

«¿Cómo están mis posiciones y los datos?» — and anything a session says about the runtime (switch, instances,
positions, supported structures) or the health of the data. Observed in WS-0022: sessions repeated stale records
(«Tastytrade caído», «sólo put spreads») and miscounted positions. Here every fact comes from a GET of this run and
carries the time it was read; a saved record is an antecedent, never the state.

The health of the data is three separate answers, never one «datos OK»:
- conectividad: does the quote source answer, and does it bring a quote (HTTP 200 with no rows is not a quote);
- frescura: how old is the valuation of what is open, against the supervisor's limit in session (outside the session
  it is not measured: the last price is the session's);
- cobertura para valuar: does every open position have a value without valuation problems.

Deterministic, no model call. A read that fails is reported as «sin verificar» with its error.
"""

from __future__ import annotations

from datetime import UTC, datetime

from galecore_ai.application import supervisor

QUOTE = "/Data/Tastytrade/MarketData/Quote?symbol={symbol}"
UNVERIFIED = "sin verificar"


def _minutes(now: datetime, ts: str | None) -> float | None:
    t = supervisor._ts(ts)
    return None if t is None else round((now - t).total_seconds() / 60, 1)


def _connectivity(read: supervisor.Reader, symbols: list[str]) -> list[dict]:
    out = []
    for symbol in symbols:
        try:
            payload = read(QUOTE.format(symbol=symbol))
        except Exception as exc:  # noqa: BLE001 - a source that does not answer is the answer
            out.append({"fuente": f"cotización {symbol}", "estado": "error", "detalle": str(exc)[:160]})
            continue
        rows = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(rows, list) and rows and isinstance(rows[0], dict) and rows[0].get("midPrice") is not None:
            out.append({"fuente": f"cotización {symbol}", "estado": "ok", "mid": rows[0].get("midPrice")})
        else:
            out.append({"fuente": f"cotización {symbol}", "estado": "sin_datos",
                        "detalle": "responde, pero sin cotización (fuera de sesión o sin dato del proveedor)"})
    return out


def _freshness(now: datetime, open_positions: list[dict]) -> dict:
    if not open_positions:
        return {"estado": "sin_posiciones"}
    ages = [_minutes(now, p.get("lastValuedAt")) for p in open_positions]
    if any(a is None for a in ages):
        return {"estado": "sin_valuacion", "detalle": "hay posiciones abiertas que nunca se valuaron"}
    oldest = max(ages)
    if not supervisor._in_session(now):
        return {"estado": "no_se_mide", "valuacion_mas_vieja_min": oldest,
                "detalle": "mercado cerrado: el precio es el último de la sesión"}
    ok = oldest <= supervisor.NO_PRICE_MINUTES
    return {"estado": "ok" if ok else "vieja", "valuacion_mas_vieja_min": oldest,
            "limite_min": supervisor.NO_PRICE_MINUTES}


def _coverage(open_positions: list[dict]) -> dict:
    if not open_positions:
        return {"estado": "sin_posiciones"}
    missing = [p.get("positionId", "")[:8] for p in open_positions
               if p.get("lastSpreadValue") is None or p.get("valuationProblems")]
    state = "ok" if not missing else ("ninguna" if len(missing) == len(open_positions) else "parcial")
    return {"estado": state, "valuadas": len(open_positions) - len(missing), "abiertas": len(open_positions),
            "sin_precio": missing}


def snapshot(read: supervisor.Reader, now: datetime | None = None) -> dict:
    """Runtime and data health as read now. Never raises for GaleCore: a failed read is «sin verificar»."""
    now = now or datetime.now(UTC)
    out: dict = {"leido_a": now.isoformat(), "sesion": "abierta" if supervisor._in_session(now) else "cerrada",
                 "fuente": "GaleCore GET /App/Runtime/Status, /App/Runtime/Instances/{id}/Positions y "
                           "/Data/Tastytrade/MarketData/Quote, en esta corrida",
                 "regla": "Lo guardado (investigaciones, seguimientos) es antecedente; el estado es esto."}
    try:
        status = read("/App/Runtime/Status")
        if not isinstance(status, dict):
            raise supervisor.SupervisorError("estado del runtime sin forma de objeto")
    except Exception as exc:  # noqa: BLE001
        out["runtime"] = {"estado": UNVERIFIED, "error": str(exc)[:160]}
        out["datos"] = {"conectividad": _connectivity(read, ["SPY"]),
                        "frescura": {"estado": UNVERIFIED}, "cobertura": {"estado": UNVERIFIED}}
        return out
    instances, open_positions, problems = [], [], []
    for inst in status.get("instances") or []:
        iid = inst.get("instanceId", "")
        row = {"estrategia": inst.get("specName"), "instancia": iid, "estado": inst.get("lifecycleState"),
               "scheduler": inst.get("schedulerState"), "version_hash": inst.get("versionHash")}
        try:
            positions = read(f"/App/Runtime/Instances/{iid}/Positions")
            if not isinstance(positions, list):
                raise supervisor.SupervisorError("posiciones sin forma de lista")
        except Exception as exc:  # noqa: BLE001 - one instance unread is reported, the rest still counted
            row["posiciones"] = UNVERIFIED
            problems.append(f"{inst.get('specName')} {iid[:8]}: {str(exc)[:120]}")
            instances.append(row)
            continue
        positions = [p for p in positions if isinstance(p, dict)]
        opened = [p for p in positions if p.get("status") == "OPEN"]
        row["abiertas"], row["cerradas"] = len(opened), sum(p.get("status") == "CLOSED" for p in positions)
        open_positions += opened
        if row["abiertas"] or row["estado"] == "RUNNING":
            instances.append(row)
    switch = status.get("switch") or {}
    out["runtime"] = {
        "entradas": "habilitadas" if switch.get("enabled") else "pausadas (switch de plataforma apagado)",
        "persistencia": (status.get("persistence") or {}).get("available"),
        "estructuras_ejecutables": status.get("supportedStructures") or UNVERIFIED,
        "instancias": instances, "posiciones_abiertas": len(open_positions)
        if not problems else f"{len(open_positions)} (incompleto: {len(problems)} instancia(s) sin leer)",
        "problemas": problems}
    symbols = sorted({p.get("symbol") for p in open_positions if p.get("symbol")}) or ["SPY"]
    out["datos"] = {"conectividad": _connectivity(read, symbols), "frescura": _freshness(now, open_positions),
                    "cobertura": _coverage(open_positions)}
    return out
