"""EXPLORATORIO — Put Broken Wing Butterfly en el entorno H3.
Mismas 115 señales gated H3 SPY OOS 2018-2025. Estructura (misma expiracion ~45d):
  long 1 put K3 = K2+5  ·  short 2 puts K2 (delta~0.30, el de la ref)  ·  long 1 put K1 = K2-W
  W en {10, 15, 20}. Se exige credito neto > 0 (los debitos se cuentan y excluyen).
Decomposicion: PCS ancho (K2/K1) + put debit spread (K3/K2).
Prediccion pre-declarada: avg$/señal < PCS $5 (el debit spread compra la prima mas
sobrepreciada de la curva), peores-años mejores (la carpa cubre la zona de perdida
del PCS: selloff moderado). La pregunta: ¿mejor dial de suavidad que PCS $20 / D2?
Salidas: hold a vencimiento + gestion B (valor estructura <= 50% del credito, como PCS).
Friccion $12.60 (4 legs). Max loss = (W - 5 - cnet)*100. Vara: riesgo cte $500.
Genera hipotesis; NO habilita nada (ventana agotada)."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
COLS = ["date", "expiration", "strike", "type", "mark", "delta"]
TGT = 0.30
FR_BWB, FR_SPREAD = 12.60, 6.30
RISK = 500.0

und = pd.read_parquet(f"{BASE}/spy_options/spy_underlying_prices.parquet")[["date", "close"]]
und["date"] = pd.to_datetime(und["date"]); und = und.sort_values("date").reset_index(drop=True)
LAST = und.date.max()

# ---------- señales H3 + marks de entrada de todas las patas ----------
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
    for off, col in [(-5.0, "w5"), (5.0, "u5"), (-10.0, "w10"), (-15.0, "w15"), (-20.0, "w20")]:
        s[col] = [marks.get(k, np.nan) for k in zip(s.date, s.strike + off)]
    s["credit5"] = s["mark"] - s["w5"]
    rows.append(s[["date", "expiration", "strike", "mark", "absd", "w5", "u5", "w10", "w15", "w20", "credit5"]])
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
print(f"señales gated H3: {len(sig)}")

# ---------- marks diarios ----------
need_exp = set(sig.expiration)
ks = set()
for r in sig.itertuples():
    ks |= {r.strike, r.strike + 5.0, r.strike - 5.0, r.strike - 10.0, r.strike - 15.0, r.strike - 20.0}
chunks = []
for y in range(2018, 2026):
    df = pd.read_parquet(f"{BASE}/spy_options/spy_options_{y}.parquet",
                         columns=["date", "expiration", "strike", "type", "mark"])
    df = df[df.type == "put"].copy()
    df["expiration"] = pd.to_datetime(df["expiration"])
    df = df[df.expiration.isin(need_exp) & df.strike.isin(ks) & df.mark.notna()]
    df["date"] = pd.to_datetime(df["date"])
    chunks.append(df[["date", "expiration", "strike", "mark"]])
pm = pd.concat(chunks, ignore_index=True).set_index(["expiration", "strike"]).sort_index()
def path(exp, k):
    try:
        return pm.loc[(exp, k)].set_index("date").mark.sort_index()
    except KeyError:
        return None

def intr(k, s): return max(0.0, k - s)

# ---------- BWB ----------
def eval_bwb(W, wcol):
    res, n_debit = [], 0
    for r in sig.itertuples():
        mu, mw = r.u5, getattr(r, wcol)
        if pd.isna(mu) or pd.isna(mw): continue
        cnet = 2 * r.mark - mu - mw
        if cnet <= 0: n_debit += 1; continue
        k2, k3, k1 = r.strike, r.strike + 5.0, r.strike - W
        maxloss = (W - 5 - cnet) * 100
        s_exp = r.exp_close
        pnl_hold = 100 * (cnet - 2 * intr(k2, s_exp) + intr(k3, s_exp) + intr(k1, s_exp)) - FR_BWB
        zone = "up" if s_exp >= k3 else ("tent" if s_exp > k1 else "maxloss")
        pnl_B, days, exit_kind = pnl_hold, (r.expiration - r.date).days, "hold"
        p2, p3, p1 = path(r.expiration, k2), path(r.expiration, k3), path(r.expiration, k1)
        if all(p is not None for p in (p2, p3, p1)):
            v = pd.concat([p2.rename("k2"), p3.rename("k3"), p1.rename("k1")], axis=1).dropna()
            v = v[(v.index > r.date) & (v.index <= r.expiration)]
            V = 2 * v.k2 - v.k3 - v.k1          # costo de cerrar la estructura
            hit = V[V <= 0.5 * cnet]
            if len(hit):
                pnl_B = 100 * (cnet - hit.iloc[0]) - FR_BWB
                days = (hit.index[0] - r.date).days; exit_kind = "tp"
        res.append((r.date, cnet, maxloss, pnl_hold, pnl_B, days, exit_kind, zone))
    t = pd.DataFrame(res, columns=["date", "cnet", "maxloss", "pnl_hold", "pnl_B", "days", "exit", "zone"])
    t["sc_hold"] = t.pnl_hold * RISK / t.maxloss
    t["sc_B"] = t.pnl_B * RISK / t.maxloss
    return f"BWB +5/-{W:.0f}", t, n_debit

def eval_pcs(width, wcol):
    res = []
    for r in sig.itertuples():
        mw = getattr(r, wcol)
        if pd.isna(mw): continue
        cnet = r.mark - mw
        if cnet <= 0: continue
        k2, k1 = r.strike, r.strike - width
        maxloss = (width - cnet) * 100
        pnl_hold = 100 * (cnet - intr(k2, r.exp_close) + intr(k1, r.exp_close)) - FR_SPREAD
        pnl_B, days, exit_kind = pnl_hold, (r.expiration - r.date).days, "hold"
        ps, pl = path(r.expiration, k2), path(r.expiration, k1)
        if ps is not None and pl is not None:
            v = (ps - pl).dropna(); v = v[(v.index > r.date) & (v.index <= r.expiration)]
            hit = v[v <= 0.5 * cnet]
            if len(hit):
                pnl_B = 100 * (cnet - hit.iloc[0]) - FR_SPREAD
                days = (hit.index[0] - r.date).days; exit_kind = "tp"
        res.append((r.date, cnet, maxloss, pnl_hold, pnl_B, days, exit_kind, "-"))
    t = pd.DataFrame(res, columns=["date", "cnet", "maxloss", "pnl_hold", "pnl_B", "days", "exit", "zone"])
    t["sc_hold"] = t.pnl_hold * RISK / t.maxloss
    t["sc_B"] = t.pnl_B * RISK / t.maxloss
    return f"PCS ${width:.0f} (ref)", t, 0

structs = [eval_pcs(5, "w5"), eval_pcs(20, "w20"),
           eval_bwb(10, "w10"), eval_bwb(15, "w15"), eval_bwb(20, "w20")]

print(f"\n{'variante':<16}{'n':>4}{'deb':>4}{'cnet$':>7}{'maxL$':>7}{'winH%':>7}{'avgH$':>8}{'minH$':>8}"
      f"{'winB%':>7}{'avgB$':>8}{'dias':>6} | {'$500:':<6}{'avgH$':>7}{'totH$':>8}{'peorañoH':>11}{'avgB$':>7}{'totB$':>8}{'peorañoB':>11}")
for label, t, nd in structs:
    byh = t.groupby(t.date.dt.year).sc_hold.sum(); byb = t.groupby(t.date.dt.year).sc_B.sum()
    print(f"{label:<16}{len(t):>4}{nd:>4}{t.cnet.mean():>7.2f}{t.maxloss.mean():>7.0f}"
          f"{(t.pnl_hold>0).mean()*100:>7.1f}{t.pnl_hold.mean():>8.1f}{t.pnl_hold.min():>8.0f}"
          f"{(t.pnl_B>0).mean()*100:>7.1f}{t.pnl_B.mean():>8.1f}{t.days.mean():>6.1f}"
          f" | {'':<6}{t.sc_hold.mean():>7.1f}{t.sc_hold.sum():>8.0f}{byh.min():>7.0f} ({int(byh.idxmin())})"
          f"{t.sc_B.mean():>7.1f}{t.sc_B.sum():>8.0f}{byb.min():>7.0f} ({int(byb.idxmin())})")

print("\n--- zonas al vencimiento (solo BWB) ---")
for label, t, _ in structs[2:]:
    z = t.zone.value_counts()
    tent = t[t.zone == "tent"]
    print(f"{label:<16} up {z.get('up',0):>3}  tent {z.get('tent',0):>2}  maxloss {z.get('maxloss',0):>2}"
          f"   avg$ en tent: {tent.pnl_hold.mean() if len(tent) else float('nan'):>7.1f}")

print("\n--- por año, HOLD a riesgo constante $500 ---")
tab = pd.DataFrame({label: t.groupby(t.date.dt.year).sc_hold.sum() for label, t, _ in structs})
print(tab.round(0).to_string())

print("\n--- por año, gestion B a riesgo constante $500 ---")
tab = pd.DataFrame({label: t.groupby(t.date.dt.year).sc_B.sum() for label, t, _ in structs})
print(tab.round(0).to_string())

print("\n--- peores 5 trades del PCS $5 vs BWB mismas fechas (hold, 1 contrato) ---")
ref = structs[0][1].nsmallest(5, "pnl_hold")[["date", "pnl_hold"]]
for label, t, _ in structs[2:]:
    m = ref.merge(t[["date", "pnl_hold", "zone"]], on="date", suffixes=("_ref", ""))
    print(f"{label:<16} " + "  ".join(f"{r.date.date()}: {r.pnl_hold_ref:>5.0f} vs {r.pnl_hold:>6.0f} ({r.zone})" for r in m.itertuples()))
