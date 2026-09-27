"""Estudio condicional de shocks de tasa real (research:2026-09-27-spy-contexto-prima-30-60d, plan de la revisión r4).

Diseño fijado en r4 y commiteado aquí ANTES de correr:
- Evento: DFII10 sube ≥ 0,20 puntos porcentuales en 3 sesiones (cierre t vs t−3) con VIX de cierre < 16 ese día; se toma
  el primer día y se descartan los 30 días hábiles siguientes (eventos no solapados).
- Control: días con VIX < 16 sin evento, con la misma regla de no solapamiento (barrido cronológico).
- Resultado: SPY toca spot × (1 − 3,8 %) dentro de 30 sesiones (principal) y de 45 (secundario), con el mínimo diario
  ajustado por dividendos; caída máxima como descriptivo.
- Estadístico: diferencia de proporciones evento − control; intervalo unilateral 90 % por bootstrap de las observaciones
  no solapadas (cada una cubre 30 sesiones: equivale al bootstrap por bloques de 30), 10 000 remuestreos; Clopper-Pearson
  para la tasa de eventos.
- Suficiencia: se cuentan los eventos antes de mirar resultados; con menos de 27, «insuficiente» sin calcular diferencias.
- Apoya: ≥ 27 eventos, diferencia ≥ +15 pp y cota inferior unilateral 90 % > 0 (30 sesiones). Debilita: diferencia ≤ 0 o
  cota superior unilateral 90 % < +15 pp. Si no, no concluyente. Referencia: mismo diseño con DGS10 (nominal).
Período: desde 2003 (inicio de DFII10) hasta el último dato de SPY local con 45 sesiones hacia adelante.

Uso: python real_rate_study.py <salida.json>
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

WS = Path(__file__).resolve().parents[6]
KB = WS / "knowledge" / "evidence"
SPY = WS / "GaleCore" / "research" / "data" / "spy_options" / "spy_underlying_prices.parquet"
SHOCK, LOOKBACK, VIX_MAX, GAP, DIST = 0.20, 3, 16.0, 30, 0.038
HORIZONS, MIN_EVENTS, EFFECT, N_BOOT, SEED = (30, 45), 27, 0.15, 10_000, 20260927


def fred(slug: str) -> pd.Series:
    doc = json.loads((KB / f"2026-09-27-spy-tasa-real-fred-{slug}.json").read_text(encoding="utf-8"))
    obs = json.loads(doc["content"]["payload"])["observations"]
    return pd.Series({o["date"]: float(o["value"]) for o in obs if o["value"] != "."})


def clopper_pearson(k: int, n: int, alpha: float = 0.10) -> tuple[float, float]:
    def cdf(p: float, kk: int) -> float:
        return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(kk + 1))

    def solve(f, lo=0.0, hi=1.0):
        for _ in range(80):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if f(mid) > 0 else (lo, mid)
        return (lo + hi) / 2
    lower = 0.0 if k == 0 else solve(lambda p: alpha / 2 - (1 - cdf(p, k - 1)))
    upper = 1.0 if k == n else solve(lambda p: cdf(p, k) - alpha / 2)
    return lower, upper


def declustered(days: list[str], eligible: set[str], index: dict[str, int]) -> list[str]:
    picked, next_ok = [], -1
    for d in days:
        i = index[d]
        if d in eligible and i >= next_ok:
            picked.append(d)
            next_ok = i + GAP + 1
    return picked


def run(rate: pd.Series, vix: pd.Series, spy: pd.DataFrame, rng) -> dict:
    days = [d for d in spy.index if d in rate.index and d in vix.index and d >= "2003-01-02"]
    pos = {d: i for i, d in enumerate(spy.index)}
    days = [d for d in days if pos[d] + max(HORIZONS) < len(spy)]
    r = rate.reindex(days)
    change = r - r.shift(LOOKBACK)
    calm = {d for d in days if vix[d] < VIX_MAX}
    ev_days = {d for d in days if d in calm and change[d] >= SHOCK}
    ctl_days = {d for d in calm if not (change[d] >= SHOCK)}
    idx = {d: i for i, d in enumerate(days)}
    events = declustered(days, ev_days, idx)
    controls = declustered(days, ctl_days, idx)
    out = {"events": len(events), "controls": len(controls), "event_dates": events}
    if len(events) < MIN_EVENTS:
        out["verdict"] = f"insuficiente: {len(events)} eventos < {MIN_EVENTS}; no se calculan diferencias"
        return out
    low, close = spy["low_adj"].to_numpy(), spy["close_adj"].to_numpy()

    def touched(d: str, h: int) -> int:
        i = pos[d]
        return int(low[i + 1:i + 1 + h].min() <= close[i] * (1 - DIST))

    def drawdown(d: str, h: int) -> float:
        i = pos[d]
        return float(low[i + 1:i + 1 + h].min() / close[i] - 1)
    for h in HORIZONS:
        e = np.array([touched(d, h) for d in events])
        c = np.array([touched(d, h) for d in controls])
        diff = e.mean() - c.mean()
        boots = np.array([rng.choice(e, len(e)).mean() - rng.choice(c, len(c)).mean() for _ in range(N_BOOT)])
        lo90, hi90 = float(np.percentile(boots, 10)), float(np.percentile(boots, 90))  # unilaterales 90 %
        cp = clopper_pearson(int(e.sum()), len(e))
        out[f"h{h}"] = {"event_touch_rate": round(float(e.mean()), 3), "event_rate_cp90": [round(cp[0], 3), round(cp[1], 3)],
                        "control_touch_rate": round(float(c.mean()), 3), "difference": round(float(diff), 3),
                        "one_sided_90_lower": round(lo90, 3), "one_sided_90_upper": round(hi90, 3),
                        "event_median_max_drop": round(float(np.median([drawdown(d, h) for d in events])), 4),
                        "control_median_max_drop": round(float(np.median([drawdown(d, h) for d in controls])), 4)}
    m = out["h30"]
    out["verdict"] = ("apoya" if m["difference"] >= EFFECT and m["one_sided_90_lower"] > 0 else
                      "debilita" if m["difference"] <= 0 or m["one_sided_90_upper"] < EFFECT else "no concluyente")
    return out


def main(path: str) -> int:
    rng = np.random.default_rng(SEED)
    u = pd.read_parquet(SPY)
    u["date"] = u.date.astype(str).str[:10]
    u = u.set_index("date").sort_index()
    ratio = u.adjusted_close / u.close
    spy = pd.DataFrame({"low_adj": u.low * ratio, "close_adj": u.adjusted_close})
    vix = fred("vixcls")
    result = {"design": "ver docstring de real_rate_study.py (commiteado antes de correr)",
              "sources": ["evidence:2026-09-27-spy-tasa-real-fred-dfii10", "evidence:2026-09-27-spy-tasa-real-fred-dgs10",
                          "evidence:2026-09-27-spy-tasa-real-fred-vixcls",
                          "file:GaleCore/research/data/spy_options/spy_underlying_prices.parquet"],
              "real_DFII10": run(fred("dfii10"), vix, spy, rng),
              "nominal_DGS10_reference": run(fred("dgs10"), vix, spy, rng)}
    Path(path).write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    for k in ("real_DFII10", "nominal_DGS10_reference"):
        print(k, json.dumps({x: v for x, v in result[k].items() if x != "event_dates"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
