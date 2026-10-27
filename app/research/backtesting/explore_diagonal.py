"""EXPLORATORIO — Diagonales/calendar put con short adelante, en el entorno H3.
Mismas 115 señales gated H3 SPY OOS 2018-2025. Un ciclo por señal, sin rolls.
  D1: short 45d delta-0.30 / long ~90d strike-5   (wing durable, mismos strikes que ref)
  D2: short 45d delta-0.30 / long ~90d delta~0.10 (diagonal clasica)
  D3: short 45d delta-0.30 / long ~90d mismo strike (calendar: pinning + vega neta)
  PCS $5 referencia.
Salida primaria: HOLD al vencimiento del front (short a intrinseco, long al mark real
de ese dia — sin modelo). Secundaria "B-analogo": cierre cuando P&L >= 50% de la prima
del short de entrada (declarado: NO es la regla B del PCS, que es 50% del credito neto).
Max loss nominal: (ancho - credito_neto)x100 para D1/D2; debito x100 para D3.
Friccion $6.30 (2 legs). Genera hipotesis; NO habilita nada (ventana agotada)."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
COLS = ["date", "expiration", "strike", "type", "mark", "delta"]
TGT, WING_D = 0.30, 0.10
FR = 6.30
RISK = 500.0

und = pd.read_parquet(f"{BASE}/spy_options/spy_underlying_prices.parquet")[["date", "close"]]
und["date"] = pd.to_datetime(und["date"]); und = und.sort_values("date").reset_index(drop=True)
LAST = und.date.max()

# ---------- señales H3 (misma maquinaria de siempre) ----------
rows = []
for y in range(2018, 2026):
    df = pd.read_parquet(f"{BASE}/spy_options/spy_options_{y}.parquet", columns=COLS)
    df = df[df.type == "put"].copy()
    df["date"] = pd.to_datetime(df["date"]); df["expiration"] = pd.to_datetime(df["expiration"])
    df["dte"] = (df.expiration - df.date).dt.days
    f = df[(df.dte >= 35) & (df.dte <= 50) & df.mark.notna() & df.delta.notna()].copy()
    f["absd"] = f.delta.abs()
    pick = f.loc[(f.dte - 45).abs().groupby(f.date).idxmin(), ["date", "expiration"]].rename(columns={"expiration": "exp_pick"})
    f = f.merge(pick, on="date"); f = f[f.expiration == f.exp_pick]
    marks = f.set_index(["date", "strike"]).mark
    s = f.loc[(f.absd - TGT).abs().groupby(f.date).idxmin()].copy()
    s["w5"] = [marks.get(k, np.nan) for k in zip(s.date, s.strike - 5.0)]
    s = s[s.w5.notna()]; s["credit5"] = s["mark"] - s["w5"]
    # back-month: DTE 75-115 mas cercano a 90, misma fecha
    b = df[(df.dte >= 75) & (df.dte <= 115) & df.mark.notna() & df.delta.notna()].copy()
    b["absd"] = b.delta.abs()
    bpick = b.loc[(b.dte - 90).abs().groupby(b.date).idxmin(), ["date", "expiration"]].rename(columns={"expiration": "bexp"})
    b = b.merge(bpick, on="date"); b = b[b.expiration == b.bexp]
    bmarks = b.set_index(["date", "strike"]).mark
    s = s.merge(bpick.drop_duplicates("date"), on="date", how="left")
    s["bl_k5"] = [bmarks.get(k, np.nan) for k in zip(s.date, s.strike - 5.0)]     # D1
    s["bl_same"] = [bmarks.get(k, np.nan) for k in zip(s.date, s.strike)]         # D3
    b10 = b[b.absd.between(0.04, 0.20)]
    i10 = (b10.absd - WING_D).abs().groupby(b10.date).idxmin()
    w10 = b.loc[i10.values, ["date", "strike", "mark", "absd"]].rename(
        columns={"strike": "k_d10", "mark": "bl_d10", "absd": "absd_d10"})
    s = s.merge(w10, on="date", how="left")
    rows.append(s[["date", "expiration", "strike", "mark", "absd", "w5", "credit5",
                   "bexp", "bl_k5", "bl_same", "k_d10", "bl_d10", "absd_d10"]])
sig = pd.concat(rows, ignore_index=True)
sig = pd.merge_asof(sig.sort_values("expiration"),
                    und.rename(columns={"date": "expiration", "close": "exp_close"}),
                    on="expiration", direction="backward")

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
for a, b_ in zip(ti[:-1], ti[1:]):
    if 1 < b_ - a <= 3: out[a:b_] = True
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
print(f"señales gated H3: {len(sig)} | back-month DTE~90 disponible en {sig.bexp.notna().sum()}")

# ---------- marks diarios de todas las patas ----------
pairs = set()
for r in sig.itertuples():
    pairs.add((r.expiration, r.strike)); pairs.add((r.expiration, r.strike - 5.0))
    if pd.notna(r.bexp):
        pairs.add((r.bexp, r.strike - 5.0)); pairs.add((r.bexp, r.strike))
        if pd.notna(r.k_d10): pairs.add((r.bexp, r.k_d10))
exps = {p[0] for p in pairs}; ks = {p[1] for p in pairs}
chunks = []
for y in range(2018, 2026):
    df = pd.read_parquet(f"{BASE}/spy_options/spy_options_{y}.parquet",
                         columns=["date", "expiration", "strike", "type", "mark"])
    df = df[df.type == "put"].copy()
    df["expiration"] = pd.to_datetime(df["expiration"])
    df = df[df.expiration.isin(exps) & df.strike.isin(ks) & df.mark.notna()]
    df["date"] = pd.to_datetime(df["date"])
    chunks.append(df[["date", "expiration", "strike", "mark"]])
pm = pd.concat(chunks, ignore_index=True).set_index(["expiration", "strike"]).sort_index()
def path(exp, k):
    try:
        s = pm.loc[(exp, k)]
        return s.set_index("date").mark.sort_index()
    except KeyError:
        return None

def long_exit_mark(bexp, k, t_exit):
    """mark del long en t_exit (o ultimo disponible <= t_exit, max 7d atras)"""
    p = path(bexp, k)
    if p is None: return np.nan, True
    p = p[p.index <= t_exit]
    if not len(p) or (t_exit - p.index[-1]).days > 7: return np.nan, True
    return p.iloc[-1], p.index[-1] != t_exit

# ---------- evaluar variantes ----------
def eval_diag(label, lk_fn, lmark_col):
    res, fallbacks = [], 0
    for r in sig.itertuples():
        if pd.isna(r.bexp): continue
        kl = lk_fn(r); ml0 = getattr(r, lmark_col)
        if kl is None or pd.isna(kl) or pd.isna(ml0): continue
        cnet = r.mark - ml0                      # >0 credito, <0 debito
        width = r.strike - kl
        maxloss = (width - cnet) * 100 if width > 0 else max(-cnet, 0.01) * 100
        intr = max(0, r.strike - r.exp_close)
        mlT, fb = long_exit_mark(r.bexp, kl, r.expiration)
        if np.isnan(mlT): continue
        fallbacks += int(fb)
        pnl_hold = 100 * (cnet - intr + mlT) - FR
        # B-analogo: P&L diario >= 50% de la prima del short
        pnl_B, days, exit_kind = pnl_hold, (r.expiration - r.date).days, "hold"
        ps, pl = path(r.expiration, r.strike), path(r.bexp, kl)
        if ps is not None and pl is not None:
            v = pd.concat([ps.rename("s"), pl.rename("l")], axis=1).dropna()
            v = v[(v.index > r.date) & (v.index <= r.expiration)]
            pnl_t = 100 * ((r.mark - v.s) + (v.l - ml0))
            hit = pnl_t[pnl_t >= 50 * r.mark]
            if len(hit):
                pnl_B = hit.iloc[0] - FR; days = (hit.index[0] - r.date).days; exit_kind = "tp"
        res.append((r.date, cnet, maxloss, pnl_hold, pnl_B, days, exit_kind, mlT / ml0 if ml0 > 0 else np.nan))
    t = pd.DataFrame(res, columns=["date", "cnet", "maxloss", "pnl_hold", "pnl_B", "days", "exit", "wing_ret"])
    t["sc_hold"] = t.pnl_hold * RISK / t.maxloss
    t["sc_B"] = t.pnl_B * RISK / t.maxloss
    print(f"  [{label}] fallbacks de mark long en salida: {fallbacks}")
    return label, t

def eval_pcs():
    res = []
    for r in sig.itertuples():
        cnet = r.credit5; maxloss = (5 - cnet) * 100
        intr_s = max(0, r.strike - r.exp_close); intr_l = max(0, r.strike - 5 - r.exp_close)
        pnl_hold = 100 * (cnet - intr_s + intr_l) - FR
        pnl_B, days, exit_kind = pnl_hold, (r.expiration - r.date).days, "hold"
        ps, pl = path(r.expiration, r.strike), path(r.expiration, r.strike - 5.0)
        if ps is not None and pl is not None:
            v = (ps - pl).dropna(); v = v[(v.index > r.date) & (v.index <= r.expiration)]
            hit = v[v <= 0.5 * cnet]
            if len(hit):
                pnl_B = 100 * (cnet - hit.iloc[0]) - FR; days = (hit.index[0] - r.date).days; exit_kind = "tp"
        res.append((r.date, cnet, maxloss, pnl_hold, pnl_B, days, exit_kind, 0.0))
    t = pd.DataFrame(res, columns=["date", "cnet", "maxloss", "pnl_hold", "pnl_B", "days", "exit", "wing_ret"])
    t["sc_hold"] = t.pnl_hold * RISK / t.maxloss
    t["sc_B"] = t.pnl_B * RISK / t.maxloss
    return "PCS $5 (ref, B=50% cred)", t

structs = [
    eval_pcs(),
    eval_diag("D1 diag K-5 ~90d", lambda r: r.strike - 5.0, "bl_k5"),
    eval_diag("D2 diag d0.10 ~90d", lambda r: r.k_d10, "bl_d10"),
    eval_diag("D3 calendar mismo K", lambda r: r.strike, "bl_same"),
]

print(f"\n{'variante':<24}{'n':>4}{'cnet$':>7}{'maxL$':>7}{'winH%':>7}{'avgH$':>8}{'minH$':>8}"
      f"{'winB%':>7}{'avgB$':>8}{'dias':>6} | {'$500 riesgo:':<12}{'avgH$':>7}{'totH$':>8}{'peorañoH':>10}")
for label, t in structs:
    byy = t.groupby(t.date.dt.year).sc_hold.sum()
    print(f"{label:<24}{len(t):>4}{t.cnet.mean():>7.2f}{t.maxloss.mean():>7.0f}"
          f"{(t.pnl_hold>0).mean()*100:>7.1f}{t.pnl_hold.mean():>8.1f}{t.pnl_hold.min():>8.0f}"
          f"{(t.pnl_B>0).mean()*100:>7.1f}{t.pnl_B.mean():>8.1f}{t.days.mean():>6.1f}"
          f" | {'':<12}{t.sc_hold.mean():>7.1f}{t.sc_hold.sum():>8.0f}{byy.min():>7.0f} ({int(byy.idxmin())})")

print("\n--- por año, HOLD a riesgo constante $500 ---")
tab = pd.DataFrame({label: t.groupby(t.date.dt.year).sc_hold.sum() for label, t in structs})
print(tab.round(0).to_string())

print("\n--- por año, B-analogo a riesgo constante $500 ---")
tab = pd.DataFrame({label: t.groupby(t.date.dt.year).sc_B.sum() for label, t in structs})
print(tab.round(0).to_string())

print("\n--- recuperacion del wing (valor long al vto front / costo entrada) ---")
for label, t in structs[1:]:
    h = t[t.exit == "hold"]
    print(f"{label:<24} media {t.wing_ret.mean()*100:5.1f}%  mediana {t.wing_ret.median()*100:5.1f}%  "
          f"(solo holds: {h.wing_ret.mean()*100:5.1f}%)")

print("\n--- convexidad: peores 5 trades del PCS ref vs mismas fechas en diagonales (hold, 1 contrato) ---")
ref = structs[0][1].nsmallest(5, "pnl_hold")[["date", "pnl_hold"]]
for label, t in structs[1:]:
    m = ref.merge(t[["date", "pnl_hold"]], on="date", suffixes=("_ref", ""))
    print(f"{label:<24} " + "  ".join(f"{r.date.date()}: ref {r.pnl_hold_ref:>5.0f} vs {r.pnl_hold:>6.0f}" for r in m.itertuples()))
