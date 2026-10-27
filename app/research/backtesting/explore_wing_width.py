"""EXPLORATORIO — Ancho del wing en el PCS: ¿cuanto del 87% de prima que se lleva
el wing se recupera ensanchando el spread, sin pasar a riesgo indefinido?
Mismas señales gated H3 SPY OOS 2018-2025 (delta 0.30 + trailing + tail + GEX>=0);
solo cambia la estructura: wing $5 (ref) / $10 / $20 / wing delta~0.10 / CSP (asintota).
Gestion B (cierre al 50% del credito) y hold; friccion $6.30 spread, $3.15 CSP.
Vara principal: P&L a RIESGO CONSTANTE (cada trade escalado a $500 de max loss) —
la comparacion que respeta heat/sizing de la estrategia.
Genera hipotesis; NO habilita nada (ventana agotada)."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
COLS = ["date", "expiration", "strike", "type", "mark", "delta"]
TGT, WING_D = 0.30, 0.10
FR_SPREAD, FR_LEG = 6.30, 3.15
RISK = 500.0

und = pd.read_parquet(f"{BASE}/spy_options/spy_underlying_prices.parquet")[["date", "close"]]
und["date"] = pd.to_datetime(und["date"]); und = und.sort_values("date").reset_index(drop=True)
LAST = und.date.max()

# ---------- señales H3 (identico a bt10_mgmtB/explore_wheel_csp) + wings ----------
rows, put_pool = [], []
for y in range(2018, 2026):
    df = pd.read_parquet(f"{BASE}/spy_options/spy_options_{y}.parquet", columns=COLS)
    df = df[df.type == "put"].copy()
    df["date"] = pd.to_datetime(df["date"]); df["expiration"] = pd.to_datetime(df["expiration"])
    df["dte"] = (df.expiration - df.date).dt.days
    df = df[(df.dte >= 35) & (df.dte <= 50) & df.mark.notna() & df.delta.notna()]
    df["absd"] = df.delta.abs()
    pick = df.loc[(df.dte - 45).abs().groupby(df.date).idxmin(), ["date", "expiration"]].rename(columns={"expiration": "exp_pick"})
    df = df.merge(pick, on="date"); df = df[df.expiration == df.exp_pick]
    put_pool.append(df[["date", "expiration", "strike", "mark", "absd"]])
    s = df.loc[(df.absd - TGT).abs().groupby(df.date).idxmin()].copy()
    rows.append(s[["date", "expiration", "strike", "mark", "absd", "dte"]])
pool = pd.concat(put_pool, ignore_index=True)
sig = pd.concat(rows, ignore_index=True)
marks = pool.set_index(["date", "strike"]).mark

# wings: $5/$10/$20 exactos + delta~0.10 de la misma expiracion
sig["w5"] = [marks.get(k, np.nan) for k in zip(sig.date, sig.strike - 5.0)]
sig["w10"] = [marks.get(k, np.nan) for k in zip(sig.date, sig.strike - 10.0)]
sig["w20"] = [marks.get(k, np.nan) for k in zip(sig.date, sig.strike - 20.0)]
p10 = pool[pool.absd.between(0.03, 0.20)].copy()
idx = (p10.absd - WING_D).abs().groupby(p10.date).idxmin()
w = pool.loc[idx.values, ["date", "strike", "mark", "absd"]].rename(
    columns={"strike": "kd10", "mark": "wd10", "absd": "d10_absd"})
sig = sig.merge(w, on="date", how="left")
sig["credit5"] = sig["mark"] - sig["w5"]
sig = pd.merge_asof(sig.sort_values("expiration"),
                    und.rename(columns={"date": "expiration", "close": "exp_close"}),
                    on="expiration", direction="backward")

# gates (mismos de H3, sobre credit del $5 como en la config de referencia)
env = pd.read_parquet(f"{BASE}/derived/bt3_trades_spy.parquet")[["date", "regime", "vrp"]]
walls = pd.read_parquet(f"{BASE}/derived/spy_walls_daily.parquet")
skew = pd.read_parquet(f"{BASE}/derived/spy_skew25_daily.parquet")
vvix = pd.read_csv(f"{BASE}/vvix_history.csv"); vvix.columns = ["date", "vvix"]
vvix["date"] = pd.to_datetime(vvix["date"], format="%m/%d/%Y")
d = skew.sort_values("date").reset_index(drop=True)
d["skew_roc5"] = d["skew25"] / d["skew25"].shift(5) - 1
d = d.merge(vvix, on="date", how="left"); d["vvix"] = d["vvix"].ffill()
def pts(x, wv, b): return np.where(x >= b, 2, np.where(x >= wv, 1, 0))
d["tail_out"] = (pts(d["vvix"], 110, 130) + pts(d["skew_roc5"], 0.05, 0.08)) >= 2
out = d["tail_out"].to_numpy().copy(); ti = np.flatnonzero(out)
for a, b in zip(ti[:-1], ti[1:]):
    if 1 < b - a <= 3: out[a:b] = True
d["tail_out_sm"] = out
sig = sig.merge(env, on="date", how="left").merge(walls, on="date", how="left") \
         .merge(d[["date", "tail_out_sm"]], on="date", how="left")
sig["tail_out_sm"] = sig["tail_out_sm"].fillna(False)
sig = sig[sig.regime.notna() & (sig.credit5 > 0)]
obs = pd.read_parquet(f"{BASE}/derived/pop_obs_puts_spy.parquet")
def trailing(cutoff):
    o = obs[obs.expiration < cutoff]
    g = o.groupby("bucket").agg(x=("absd", "mean"), y=("itm", "mean"), n=("absd", "size"))
    g = g[g.n >= 50].sort_values("x"); return g["x"].to_numpy(), g["y"].to_numpy()
sig["p_trail"] = np.nan
for y in range(2018, 2026):
    xs, ys = trailing(pd.Timestamp(f"{y}-01-01")); m = sig.date.dt.year == y
    sig.loc[m, "p_trail"] = np.interp(sig.loc[m, "absd"], xs, ys)
sig["bar"] = sig.regime.map({"low_vol": 1.10, "normal": 1.05, "elevated": 1.10, "caution": 1.20}).fillna(9)
sig["edge"] = (sig.credit5 / 5) / sig.p_trail
gexd = pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date", "gex_b"]]
sig = sig.merge(gexd, on="date", how="left")
gate = (sig.regime != "engine_out") & (sig.vrp >= 1.2) & (sig.strike <= sig.put_wall) & \
       (sig.credit5 >= 0.30) & (~sig.tail_out_sm) & (sig.gex_b >= 0) & (sig.edge >= sig.bar)
sig = sig[gate & (sig.expiration <= LAST)].sort_values("date").reset_index(drop=True)
print(f"señales gated H3: {len(sig)}")
print(f"wing delta~0.10: ancho mediano ${ (sig.strike - sig.kd10).median():.0f} "
      f"(p10 ${ (sig.strike - sig.kd10).quantile(.1):.0f} / p90 ${ (sig.strike - sig.kd10).quantile(.9):.0f}), "
      f"|delta| medio {sig.d10_absd.mean():.3f}")

# ---------- marks diarios de todos los strikes involucrados ----------
need_exp = set(sig.expiration)
strikes = set(sig.strike) | set(sig.strike - 5.0) | set(sig.strike - 10.0) | \
          set(sig.strike - 20.0) | set(sig.kd10.dropna())
chunks = []
for y in range(2018, 2026):
    df = pd.read_parquet(f"{BASE}/spy_options/spy_options_{y}.parquet",
                         columns=["date", "expiration", "strike", "type", "mark"])
    df = df[df.type == "put"].copy()
    df["expiration"] = pd.to_datetime(df["expiration"])
    df = df[df.expiration.isin(need_exp) & df.strike.isin(strikes) & df.mark.notna()]
    df["date"] = pd.to_datetime(df["date"])
    chunks.append(df[["date", "expiration", "strike", "mark"]])
pm = pd.concat(chunks, ignore_index=True).set_index(["expiration", "strike"]).sort_index()
def path(exp, k):
    try:
        return pm.loc[(exp, k)].set_index("date").mark.sort_index()
    except KeyError:
        return None

# ---------- evaluar cada estructura ----------
def eval_structure(label, wing_col, wing_strike_fn):
    res = []
    for r in sig.itertuples():
        wmark = getattr(r, wing_col) if wing_col else 0.0
        if wing_col and (pd.isna(wmark)): continue
        kw = wing_strike_fn(r)
        credit = r.mark - wmark
        if credit <= 0: continue
        width = r.strike - kw if kw is not None else np.inf
        maxloss = (width - credit) * 100 if np.isfinite(width) else r.strike * 100 - credit * 100
        fr = FR_SPREAD if wing_col else FR_LEG
        itm_s = max(0, r.strike - r.exp_close)
        itm_w = max(0, kw - r.exp_close) if kw is not None else 0.0
        pnl_hold = 100 * (credit - itm_s + itm_w) - fr
        pnl_B, days = pnl_hold, (r.expiration - r.date).days
        sh = path(r.expiration, r.strike)
        lo = path(r.expiration, kw) if kw is not None else None
        v = None
        if sh is not None and (kw is None or lo is not None):
            v = (sh - lo).dropna() if kw is not None else sh
            v = v[(v.index > r.date) & (v.index <= r.expiration)].sort_index()
            hit = v[v <= 0.5 * credit]
            if len(hit):
                pnl_B = 100 * (credit - hit.iloc[0]) - fr
                days = (hit.index[0] - r.date).days
        res.append((r.date, credit, maxloss, pnl_hold, pnl_B, days))
    t = pd.DataFrame(res, columns=["date", "credit", "maxloss", "pnl_hold", "pnl_B", "days"])
    t["scaled_B"] = t.pnl_B * (RISK / t.maxloss)          # riesgo constante $500
    t["scaled_hold"] = t.pnl_hold * (RISK / t.maxloss)
    return label, t

structs = [
    eval_structure("PCS $5 (ref)", "w5", lambda r: r.strike - 5.0),
    eval_structure("PCS $10", "w10", lambda r: r.strike - 10.0),
    eval_structure("PCS $20", "w20", lambda r: r.strike - 20.0),
    eval_structure("PCS wing d0.10", "wd10", lambda r: r.kd10),
    eval_structure("CSP (asintota)", None, lambda r: None),
]

print(f"\n{'estructura':<16}{'n':>4}{'cred$':>7}{'maxL$':>7}{'c/w%':>6}"
      f"{'winB%':>7}{'avgB$':>7}{'p5B$':>7}{'minB$':>7} | {'riesgo cte $500:':<16}"
      f"{'avgB$':>7}{'totB$':>8}{'peor-añoB$':>11}{'p5B$':>7}")
for label, t in structs:
    cw = (t.credit / (t.maxloss / 100 + t.credit)).mean() * 100
    byy = t.groupby(t.date.dt.year).scaled_B.sum()
    print(f"{label:<16}{len(t):>4}{t.credit.mean():>7.2f}{t.maxloss.mean():>7.0f}{cw:>6.1f}"
          f"{(t.pnl_B>0).mean()*100:>7.1f}{t.pnl_B.mean():>7.1f}{t.pnl_B.quantile(.05):>7.0f}{t.pnl_B.min():>7.0f}"
          f" | {'':<16}{t.scaled_B.mean():>7.1f}{t.scaled_B.sum():>8.0f}"
          f"{byy.min():>8.0f} ({int(byy.idxmin())}){t.scaled_B.quantile(.05):>7.0f}")

print("\n--- hold (sin gestion), riesgo constante $500 ---")
for label, t in structs:
    byy = t.groupby(t.date.dt.year).scaled_hold.sum()
    print(f"{label:<16} avg ${t.scaled_hold.mean():>6.1f}  total ${t.scaled_hold.sum():>7.0f}  "
          f"peor-año ${byy.min():>6.0f} ({int(byy.idxmin())})  win {(t.pnl_hold>0).mean()*100:.1f}%")

print("\n--- por año, gestion B a riesgo constante $500 ---")
tab = pd.DataFrame({label: t.groupby(t.date.dt.year).scaled_B.sum() for label, t in structs})
print(tab.round(0).to_string())

# captura de prima: % del credito CSP que retiene cada estructura
print("\n--- % de la prima CSP que retiene cada estructura (credito medio / credito CSP medio) ---")
csp_credit = structs[-1][1].credit.mean()
for label, t in structs:
    print(f"{label:<16} {t.credit.mean()/csp_credit*100:5.1f}%")
