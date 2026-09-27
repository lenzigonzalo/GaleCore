"""Estudio histórico de la hipótesis de spy_prima_varianza_30_45d (reglas de la versión 1.0.3).

Diseño fijado ANTES de ver resultados (este archivo se commitea antes de correrlo), según el plan de evaluación de
`research:2026-09-27-spy-prima-varianza-estrategia`:

- Muestra principal 2013-01-02..2023-12-29 (cadenas EOD de SPY locales). 2024–2025 se reporta aparte como extensión,
  declarada antes de correr; no cambia el veredicto.
- Una posición a la vez; decisiones al cierre con el VIX de cierre (FRED VIXCLS) < 30; sin VIX del día, no se entra.
- Construcción como el runtime (PcsCandidateBuilder): vencimiento con 30 ≤ DTE ≤ 45 días corridos, el más cercano a 37
  (empate: el menor); put vendido OTM (strike < spot) con delta en (−0,5; 0) más cercano a −0,16 y |Δ − (−0,16)| ≤ 0,04;
  comprado en el strike más cercano a (vendido − 5) con diferencia ≤ 1; crédito a mid ≥ 0,10; cotización usable:
  bid ≥ 0, ask > 0, ask ≥ bid.
- Salidas como el runtime, evaluadas al cierre sobre el valor a mid: pérdida ≥ 2× crédito, valor ≤ 50 % del crédito,
  DTE ≤ 21, en ese orden. Día sin cotización usable de alguna pata: no se evalúa (como VALUATION_NO_DATA).
- Ejecución: las reglas deciden a mid (como el runtime); el P&L usa precios naturales (vende al bid, compra al ask =
  mid ± medio spread por pata) y 0,65 USD por contrato y pata en cada lado. 1 contrato. Sin reentrada el día de una salida.
- Métrica principal: P&L diario a mercado (mid) / 500 USD de capital reservado, menos la tasa de letras a 3 meses (FRED
  DTB3 / 252) — supuesto conservador: el colateral no cobra interés. Bootstrap estacionario, bloque medio 30 sesiones,
  10 000 remuestreos, intervalo al 90 % del exceso anualizado (× 252).
- Suficiencia: ≥ 60 operaciones cerradas y ≥ 2 episodios de estrés dentro de la muestra; si no, «insuficiente».
- Veredicto estadístico: apoya si la cota inferior > 0; refuta si la estimación ≤ 0 o la cota superior < 0; si no, no
  concluyente. El criterio de utilidad (estimación ≥ tu utilidad mínima, drawdown ≤ tu límite) queda pendiente de tus
  valores. Sensibilidad descriptiva: fills a mid y sin comisiones.

Desviaciones declaradas: el dataset no clasifica vencimientos; se excluyen los del último día hábil del mes que no son
el tercer viernes (aprox. de «sólo Regular y Weekly»); salidas sólo al cierre (stops intradía no observables); el VIX de
FRED es el cierre oficial; el delta es el del proveedor del dataset.

Uso: python hypothesis_study.py <salida.json>
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

WS = Path(__file__).resolve().parents[6]
DATA = WS / "GaleCore" / "research" / "data" / "spy_options"
KB = WS / "knowledge" / "evidence"
TARGET_DELTA, DELTA_TOL, WIDTH, WIDTH_TOL, MIN_CREDIT = -0.16, 0.04, 5.0, 1.0, 0.10
MIN_DTE, MAX_DTE, MID_DTE, TIME_EXIT = 30, 45, 37, 21
TP, SL, VIX_MAX, COMM, CAPITAL = 0.50, 2.00, 30.0, 0.65, 500.0
MAIN = ("2013-01-02", "2023-12-29")
EXT = ("2024-01-02", "2025-12-31")
STRESS = {"2015-08": ("2015-08-17", "2015-09-30"), "2018-02": ("2018-01-26", "2018-02-28"),
          "2020-03": ("2020-02-19", "2020-04-30"), "2022": ("2022-01-03", "2022-12-30")}
RNG_SEED, N_BOOT, BLOCK = 20260927, 10_000, 30


def fred(series: str) -> pd.Series:
    doc = json.loads((KB / f"2026-09-27-spy-hipotesis-fred-{series.lower()}.json").read_text(encoding="utf-8"))
    obs = json.loads(doc["content"]["payload"])["observations"]
    s = pd.Series({o["date"]: float(o["value"]) for o in obs if o["value"] != "."})
    return s


def excluded_expiration(exp: str) -> bool:
    d = date.fromisoformat(exp)
    nxt = d + timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    last_business_day = nxt.month != d.month
    third_friday = d.weekday() == 4 and 15 <= d.day <= 21
    return last_business_day and not third_friday


def load_puts(years: range) -> pd.DataFrame:
    frames = []
    for y in years:
        t = pq.read_table(DATA / f"spy_options_{y}.parquet",
                          columns=["date", "expiration", "strike", "bid", "ask", "delta"],
                          filters=[("type", "=", "put")]).to_pandas()
        t["dte"] = (pd.to_datetime(t["expiration"]) - pd.to_datetime(t["date"])).dt.days
        frames.append(t[(t.dte >= 0) & (t.dte <= 60)])
    df = pd.concat(frames, ignore_index=True)
    df = df[~df.expiration.map(excluded_expiration)]
    df["usable"] = (df.bid >= 0) & (df.ask > 0) & (df.ask >= df.bid)
    df["mid"] = (df.bid + df.ask) / 2
    return df


def quote(day: pd.DataFrame, exp: str, strike: float):
    r = day[(day.expiration == exp) & (day.strike == strike) & day.usable]
    return None if r.empty else r.iloc[0]


def candidate(day: pd.DataFrame, spot: float):
    exps = day[(day.dte >= MIN_DTE) & (day.dte <= MAX_DTE)][["expiration", "dte"]].drop_duplicates()
    if exps.empty:
        return None, "sin vencimiento 30-45"
    exps = exps.assign(k=(exps.dte - MID_DTE).abs()).sort_values(["k", "dte"])
    exp, dte = exps.iloc[0].expiration, int(exps.iloc[0].dte)
    chain = day[(day.expiration == exp)]
    otm = chain[(chain.strike < spot) & (chain.delta < 0) & (chain.delta > -0.5)]
    if otm.empty:
        return None, "sin puts OTM"
    s = otm.iloc[(otm.delta - TARGET_DELTA).abs().argsort()].iloc[0]
    if abs(s.delta - TARGET_DELTA) > DELTA_TOL:
        return None, "delta fuera de tolerancia"
    lng = chain.iloc[(chain.strike - (s.strike - WIDTH)).abs().argsort()].iloc[0]
    if abs(lng.strike - (s.strike - WIDTH)) > WIDTH_TOL:
        return None, "sin strike comprado"
    if not (s.usable and lng.usable):
        return None, "cotización no usable"
    credit_mid = round(s.mid - lng.mid, 2)
    if credit_mid < MIN_CREDIT:
        return None, "crédito < mínimo"
    return {"exp": exp, "dte": dte, "ks": float(s.strike), "kl": float(lng.strike), "width": float(s.strike - lng.strike),
            "credit_mid": credit_mid, "credit_nat": float(s.bid - lng.ask), "delta": float(s.delta)}, None


def simulate(puts: pd.DataFrame, spot: pd.Series, vix: pd.Series, start: str, end: str, natural: bool = True,
             comm: float = COMM) -> dict:
    days = sorted(d for d in puts.date.unique() if start <= d <= end)
    by_day = {d: g for d, g in puts[(puts.date >= start) & (puts.date <= end)].groupby("date")}
    pos, mtm_prev, pnl, trades, skips = None, 0.0, {}, [], {}
    for d in days:
        day = by_day[d]
        today = 0.0
        exited = False
        if pos is not None:
            qs, ql = quote(day, pos["exp"], pos["ks"]), quote(day, pos["exp"], pos["kl"])
            if qs is not None and ql is not None:
                val_mid = qs.mid - ql.mid
                dte = (date.fromisoformat(pos["exp"]) - date.fromisoformat(d)).days
                loss = val_mid - pos["credit_mid"]
                reason = ("STOP_LOSS" if loss >= SL * pos["credit_mid"] else
                          "TAKE_PROFIT" if val_mid <= (1 - TP) * pos["credit_mid"] else
                          "TIME_EXIT" if dte <= TIME_EXIT else None)
                if reason:
                    exit_px = (qs.ask - ql.bid) if natural else val_mid
                    entry_px = pos["credit_nat"] if natural else pos["credit_mid"]
                    realized = (entry_px - exit_px) * 100 - 4 * comm
                    today += realized - mtm_prev
                    trades.append({**pos, "exit_date": d, "reason": reason, "pnl": round(realized, 2)})
                    pos, mtm_prev, exited = None, 0.0, True
                else:
                    entry_px = pos["credit_nat"] if natural else pos["credit_mid"]
                    mtm = (entry_px - val_mid) * 100 - 2 * comm
                    today += mtm - mtm_prev
                    mtm_prev = mtm
        if pos is None and not exited:
            v = vix.get(d)
            if v is None:
                skips["sin VIX"] = skips.get("sin VIX", 0) + 1
            elif v >= VIX_MAX:
                skips["VIX >= 30"] = skips.get("VIX >= 30", 0) + 1
            elif d in spot.index:
                c, why = candidate(day, float(spot[d]))
                if c is None:
                    skips[why] = skips.get(why, 0) + 1
                else:
                    pos = {**c, "entry_date": d, "vix": v}
                    entry_px = c["credit_nat"] if natural else c["credit_mid"]
                    mtm_prev = (entry_px - c["credit_mid"]) * 100 - 2 * comm
                    today += mtm_prev
        pnl[d] = today
    return {"pnl": pd.Series(pnl), "trades": trades, "skips": skips, "open_at_end": pos}


def stationary_bootstrap(x: np.ndarray, rng) -> np.ndarray:
    """Politis-Romano: blocks with geometric lengths (mean BLOCK) starting at uniform positions, wrapping around."""
    n = len(x)
    means = np.empty(N_BOOT)
    for b in range(N_BOOT):
        lengths = rng.geometric(1.0 / BLOCK, size=n // BLOCK * 3 + 10)
        starts = rng.integers(n, size=len(lengths))
        idx = np.concatenate([(s0 + np.arange(k)) % n for s0, k in zip(starts, lengths, strict=True)])[:n]
        means[b] = x[idx].mean()
    return means


def summarize(sim: dict, rf: pd.Series, label: str, rng) -> dict:
    pnl = sim["pnl"]
    rfd = rf.reindex(pnl.index).ffill().fillna(0) / 100 / 252
    ex = (pnl / CAPITAL - rfd).to_numpy()
    est = ex.mean() * 252
    boot = stationary_bootstrap(ex, rng) * 252
    lo, hi = np.percentile(boot, [5, 95])
    cum = pnl.cumsum()
    dd = float((cum - cum.cummax()).min())
    tr = pd.DataFrame(sim["trades"])
    closed = len(tr)
    episodes = {k: round(float(pnl[(pnl.index >= a) & (pnl.index <= b)].sum()), 2) for k, (a, b) in STRESS.items()
                if pnl.index.min() <= a and b <= pnl.index.max()}
    sufficient = closed >= 60 and len(episodes) >= 2
    verdict = ("insuficiente" if not sufficient else
               "refuta" if est <= 0 or hi < 0 else "apoya (estadístico)" if lo > 0 else "no concluyente")
    return {
        "label": label, "days": len(pnl), "closed_trades": closed,
        "exits": tr.reason.value_counts().to_dict() if closed else {},
        "win_rate": round(float((tr.pnl > 0).mean()), 3) if closed else None,
        "avg_trade_usd": round(float(tr.pnl.mean()), 2) if closed else None,
        "worst_trade_usd": round(float(tr.pnl.min()), 2) if closed else None,
        "best_trade_usd": round(float(tr.pnl.max()), 2) if closed else None,
        "total_pnl_usd": round(float(pnl.sum()), 2),
        "excess_annual_est": round(float(est), 4), "ci90": [round(float(lo), 4), round(float(hi), 4)],
        "max_drawdown_usd": round(dd, 2), "max_drawdown_pct_capital": round(dd / CAPITAL, 4),
        "stress_episodes_pnl_usd": episodes, "entry_skips": sim["skips"],
        "sufficient": sufficient, "statistical_verdict": verdict,
        "open_at_end": sim["open_at_end"],
    }


def main(out: str) -> int:
    vix, rf = fred("VIXCLS"), fred("DTB3")
    u = pd.read_parquet(DATA / "spy_underlying_prices.parquet")
    spot = pd.Series(u.close.to_numpy(), index=u.date.astype(str).str[:10])
    rng = np.random.default_rng(RNG_SEED)
    puts = load_puts(range(2013, 2024))
    main_nat = simulate(puts, spot, vix, *MAIN)
    main_mid = simulate(puts, spot, vix, *MAIN, natural=False, comm=0.0)
    ext_puts = load_puts(range(2024, 2026))
    ext = simulate(ext_puts, spot, vix, *EXT)
    result = {
        "strategy": "strategy:spy_prima_varianza_30_45d/1.0.3",
        "spec_hash": "sha256:19884e779e3722f6221cf86c03b411307cdc41e04880e26f8f88395cf960bc51",
        "design": "ver docstring de hypothesis_study.py (commiteado antes de correr)",
        "sources": ["evidence:2026-09-27-spy-hipotesis-fred-vixcls", "evidence:2026-09-27-spy-hipotesis-fred-dtb3",
                    "file:GaleCore/research/data/spy_options (cadenas EOD SPY 2013-2025)"],
        "main": summarize(main_nat, rf, "2013-2023, fills naturales + comisiones (principal)", rng),
        "sensitivity_mid_no_commissions": summarize(main_mid, rf, "2013-2023, fills a mid sin comisiones", rng),
        "extension_2024_2025": summarize(ext, rf, "2024-2025 (extensión declarada; no cambia el veredicto)", rng),
        "trades_main": main_nat["trades"],
    }
    Path(out).write_text(json.dumps(result, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    for k in ("main", "sensitivity_mid_no_commissions", "extension_2024_2025"):
        r = {x: result[k][x] for x in result[k] if x not in ("open_at_end",)}
        print(json.dumps(r, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
