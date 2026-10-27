"""BT-14 — Libro combinado L2-long + overlay PCS-B. CORRIDA UNICA conforme a la
especificacion pre-declarada del 2026-07-11 (doc galecore-backtesting-pendientes.md).
Pipeline congelado: filtro L2 (regimen operable ∧ ¬tail_out; sin GEX, sin VRP en la pata
stock), variantes V1-V4 (V4 = histeresis N=3 + apertura siguiente = variante de VEREDICTO),
retorno total (dividend_amount, devengado si long), slippage 2bp/via por switch, cash 0%.
Overlay: señales H3 (SPY con GEX / QQQ sin GEX) + gestion B, cartera secuencial 1 posicion,
1 contrato, base $10k. Veredicto C1-C5 sobre 2018-2025; 2013-2017 solo contexto.
Sin retoques post-resultado."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
COLS = ["date", "expiration", "strike", "type", "mark", "delta"]
TGT = 0.30
SLIP = 0.0002          # 2bp por via
CAP = 10_000.0

# ---------------- datos comunes ----------------
def load_und(sym):
    u = pd.read_parquet(f"{BASE}/{sym}_options/{sym}_underlying_prices.parquet")[
        ["date", "open", "close", "dividend_amount"]]
    u["date"] = pd.to_datetime(u["date"])
    u = u.sort_values("date").reset_index(drop=True)
    u["div"] = u["dividend_amount"].fillna(0.0)
    return u

skew = pd.read_parquet(f"{BASE}/derived/spy_skew25_daily.parquet").sort_values("date")
vvix = pd.read_csv(f"{BASE}/vvix_history.csv"); vvix.columns = ["date", "vvix"]
vvix["date"] = pd.to_datetime(vvix["date"], format="%m/%d/%Y")
skew["skew_roc5"] = skew["skew25"] / skew["skew25"].shift(5) - 1
skew = skew.merge(vvix, on="date", how="left"); skew["vvix"] = skew["vvix"].ffill()
def pts(x, w, b): return np.where(x >= b, 2, np.where(x >= w, 1, 0))
skew["tail_out"] = (pts(skew["vvix"], 110, 130) + pts(skew["skew_roc5"], 0.05, 0.08)) >= 2
out = skew["tail_out"].to_numpy().copy(); ti = np.flatnonzero(out)
for a, b in zip(ti[:-1], ti[1:]):
    if 1 < b - a <= 3: out[a:b] = True
skew["tail_out_sm"] = out
TAIL = skew[["date", "tail_out_sm"]]

def build_l2(sym, und):
    env = pd.read_parquet(f"{BASE}/derived/bt3_trades_{sym}.parquet")[["date", "regime"]]
    d = und[["date"]].merge(env, on="date", how="left")
    d["regime"] = d["regime"].ffill(limit=5)
    d = d.merge(TAIL, on="date", how="left")
    d["tail_out_sm"] = d["tail_out_sm"].fillna(False).astype(bool)
    d["l2"] = d.regime.notna() & (d.regime != "engine_out") & ~d.tail_out_sm
    return d["l2"].to_numpy()

def hysteresis(raw, n=3):
    """degradacion inmediata; mejora tras n dias consecutivos de raw=True"""
    sig = np.zeros(len(raw), dtype=bool); streak = 0; on = False
    for i, r in enumerate(raw):
        if not r:
            on = False; streak = 0
        else:
            streak += 1
            if streak >= n: on = True
        sig[i] = on
    return sig

# ---------------- motor de retornos (total return + slippage) ----------------
def run_variant(und, sig, next_open):
    """sig: señal EOD del dia t. V close-exec: posicion del dia t (close[t-1]->close[t]) =
    sig[t-1]. V open-exec: intradia (open->close) = sig[t-1]; overnight (close[t-1]->open[t])
    = sig[t-2]; transiciones al open. Dividendo ex-date t lo cobra quien tiene el overnight.
    Devuelve serie diaria de retornos netos del libro stock."""
    close, opn, div = und["close"].to_numpy(), und["open"].to_numpy(), und["div"].to_numpy()
    n = len(und)
    s1 = np.concatenate([[False], sig[:-1]])            # sig[t-1]
    s2 = np.concatenate([[False, False], sig[:-2]])     # sig[t-2]
    r = np.zeros(n)
    if not next_open:
        pos = s1
        for t in range(1, n):
            if pos[t]:
                r[t] = (close[t] + div[t]) / close[t - 1] - 1
            if pos[t] != pos[t - 1]:
                r[t] -= SLIP
    else:
        for t in range(1, n):
            ov = (opn[t] + div[t]) / close[t - 1] - 1 if s2[t] else 0.0
            it = close[t] / opn[t] - 1 if s1[t] else 0.0
            r[t] = (1 + ov) * (1 + it) - 1
            if s1[t] != s2[t]:
                r[t] -= SLIP
    return pd.Series(r, index=und["date"]), pd.Series(s1, index=und["date"])

def metrics(eq):
    r = eq.pct_change().dropna(); yrs = len(r) / 252
    cagr = (eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1
    sharpe = r.mean() / r.std() * np.sqrt(252) if r.std() > 0 else np.nan
    maxdd = (eq / eq.cummax() - 1).min()
    yr = eq.groupby(eq.index.year).apply(lambda x: x.iloc[-1] / x.iloc[0] - 1)
    return cagr, sharpe, maxdd, yr

# ---------------- overlay: señales H3 + cartera secuencial B ----------------
def build_signals(sym, use_gex, und):
    last = und.date.max()
    rows = []
    for y in range(2018, 2026):
        df = pd.read_parquet(f"{BASE}/{sym}_options/{sym}_options_{y}.parquet", columns=COLS)
        df = df[df.type == "put"].copy()
        df["date"] = pd.to_datetime(df["date"]); df["expiration"] = pd.to_datetime(df["expiration"])
        df["dte"] = (df.expiration - df.date).dt.days
        df = df[(df.dte >= 35) & (df.dte <= 50) & df.mark.notna() & df.delta.notna()]
        df["absd"] = df.delta.abs()
        pick = df.loc[(df.dte - 45).abs().groupby(df.date).idxmin(), ["date", "expiration"]].rename(columns={"expiration": "exp_pick"})
        df = df.merge(pick, on="date"); df = df[df.expiration == df.exp_pick]
        marks = df.set_index(["date", "strike"]).mark
        s = df.loc[(df.absd - TGT).abs().groupby(df.date).idxmin()].copy()
        s["lmark"] = [marks.get(k, np.nan) for k in zip(s.date, s.strike - 5.0)]
        s = s[s.lmark.notna()]; s["credit"] = s["mark"] - s["lmark"]
        rows.append(s[["date", "expiration", "strike", "absd", "credit", "dte"]])
    pcs = pd.concat(rows, ignore_index=True); pcs = pcs[pcs.credit > 0]
    pcs = pd.merge_asof(pcs.sort_values("expiration"),
                        und[["date", "close"]].rename(columns={"date": "expiration", "close": "exp_close"}),
                        on="expiration", direction="backward")
    pcs["pnl_hold"] = 100 * (pcs.credit - np.maximum(0, pcs.strike - pcs.exp_close)
                             + np.maximum(0, pcs.strike - 5 - pcs.exp_close)) - 6.3
    env = pd.read_parquet(f"{BASE}/derived/bt3_trades_{sym}.parquet")[["date", "regime", "vrp"]]
    walls = pd.read_parquet(f"{BASE}/derived/{sym}_walls_daily.parquet")
    pcs = pcs.merge(env, on="date", how="left").merge(walls, on="date", how="left") \
             .merge(TAIL, on="date", how="left")
    pcs["tail_out_sm"] = pcs["tail_out_sm"].fillna(False)
    pcs = pcs[pcs.regime.notna()]
    obs = pd.read_parquet(f"{BASE}/derived/pop_obs_puts_{sym}.parquet")
    def trailing(cutoff):
        o = obs[obs.expiration < cutoff]
        g = o.groupby("bucket").agg(x=("absd", "mean"), y=("itm", "mean"), n=("absd", "size"))
        g = g[g.n >= 50].sort_values("x"); return g["x"].to_numpy(), g["y"].to_numpy()
    pcs["p_trail"] = np.nan
    for y in range(2018, 2026):
        xs, ys = trailing(pd.Timestamp(f"{y}-01-01")); m = pcs.date.dt.year == y
        pcs.loc[m, "p_trail"] = np.interp(pcs.loc[m, "absd"], xs, ys)
    pcs["bar"] = pcs.regime.map({"low_vol": 1.10, "normal": 1.05, "elevated": 1.10, "caution": 1.20}).fillna(9)
    pcs["edge"] = (pcs.credit / 5) / pcs.p_trail
    gate = (pcs.regime != "engine_out") & (pcs.vrp >= 1.2) & (pcs.strike <= pcs.put_wall) & \
           (pcs.credit >= 0.30) & (~pcs.tail_out_sm)
    if use_gex:
        gexd = pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date", "gex_b"]]
        pcs = pcs.merge(gexd, on="date", how="left")
        gate = gate & (pcs.gex_b >= 0)
    sig = pcs[gate & (pcs.edge >= pcs.bar) & (pcs.expiration <= last)].copy()
    return sig.sort_values("date").reset_index(drop=True)

def overlay_pnl_daily(sym, use_gex, und):
    sig = build_signals(sym, use_gex, und)
    need_exp = set(sig.expiration); strikes = set(sig.strike) | set(sig.strike - 5.0)
    chunks = []
    for y in range(2018, 2026):
        df = pd.read_parquet(f"{BASE}/{sym}_options/{sym}_options_{y}.parquet",
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
    events = []; busy = pd.Timestamp("2000-01-01")
    for r in sig.itertuples():
        if r.date < busy: continue
        sh, lo = path(r.expiration, r.strike), path(r.expiration, r.strike - 5.0)
        if sh is not None and lo is not None:
            v = (sh - lo).dropna(); v = v[(v.index > r.date) & (v.index <= r.expiration)]
            hit = v[v <= 0.5 * r.credit]
            if len(hit):
                events.append((hit.index[0], 100 * (r.credit - hit.iloc[0]) - 6.3))
                busy = hit.index[0]; continue
        events.append((r.expiration, r.pnl_hold)); busy = r.expiration
    ev = pd.DataFrame(events, columns=["d", "pnl"])
    return ev.groupby("d").pnl.sum(), len(ev)

# ---------------- corrida por simbolo ----------------
def run_symbol(sym, use_gex):
    und = load_und(sym)
    und = und[(und.date >= "2013-01-01")].reset_index(drop=True)
    l2 = build_l2(sym, und)
    variants = {
        "V1 close":       (l2, False),
        "V2 next-open":   (l2, True),
        "V3 hist+close":  (hysteresis(l2), False),
        "V4 hist+open":   (hysteresis(l2), True),
    }
    # ventana de veredicto
    W = (und.date >= "2018-01-01")
    idx = und.loc[W, "date"]
    # B&H total return
    r_bh = ((und["close"] + und["div"]) / und["close"].shift(1) - 1).fillna(0.0)
    r_bh.index = und.date
    eq_bh = CAP * (1 + r_bh[W.values]).cumprod()
    c_bh, s_bh, dd_bh, yr_bh = metrics(eq_bh)
    print(f"\n================ {sym.upper()} — ventana de veredicto 2018-2025 ================")
    print(f"{'B&H (total return)':<22} CAGR {c_bh*100:6.2f}%  Sharpe {s_bh:5.2f}  maxDD {dd_bh*100:6.1f}%")
    res = {}
    for name, (sg, nxt) in variants.items():
        r, pos = run_variant(und, sg, nxt)
        rw = r[W.values]
        eq = CAP * (1 + rw).cumprod()
        c, s, dd, yr = metrics(eq)
        nsw = int((pd.Series(sg, index=und.date)[W.values].astype(int).diff().abs() == 1).sum())
        exp_pct = pd.Series(sg, index=und.date)[W.values].mean() * 100
        c1 = (dd >= dd_bh * (2 / 3) * 1.0) and False  # placeholder, se computa abajo bien
        res[name] = dict(eq=eq, cagr=c, sharpe=s, dd=dd, yr=yr, sig=sg, r=r)
        print(f"{name:<22} CAGR {c*100:6.2f}%  Sharpe {s:5.2f}  maxDD {dd*100:6.1f}%  "
              f"switches {nsw:>3}  exp {exp_pct:4.1f}%")
    # criterios C1/C2 sobre la pata stock
    def c1_ok(v):
        return (abs(v["dd"]) <= abs(dd_bh) * 2 / 3) and (v["cagr"] >= c_bh - 0.015)
    print("\nC1 por variante (maxDD<=2/3 B&H  Y  CAGR>=B&H-1.5pp):")
    for name, v in res.items():
        print(f"  {name:<20} maxDD {abs(v['dd'])/abs(dd_bh)*100:5.1f}% del B&H · "
              f"CAGR gap {(v['cagr']-c_bh)*100:+5.2f}pp -> {'PASA' if c1_ok(v) else 'FALLA'}")
    verdicts = [c1_ok(v) for v in res.values()]
    print(f"C2 (veredicto no flipea entre variantes): {'PASA' if len(set(verdicts))==1 else 'FALLA'}")
    # C3: no-concentracion (sobre V4)
    v4 = res["V4 hist+open"]
    sg = pd.Series(v4["sig"], index=und.date)
    off = ~sg & W.values
    # segmentos OFF contiguos y contribucion B&H en cada uno
    dates = idx.reset_index(drop=True)
    offw = off[W.values].reset_index(drop=True)
    rbhw = r_bh[W.values].reset_index(drop=True)
    seg, segs = [], []
    for i in range(len(dates)):
        if offw[i]: seg.append(i)
        elif seg: segs.append(seg); seg = []
    if seg: segs.append(seg)
    contrib = [( (1 + rbhw.iloc[s]).prod() - 1, s) for s in segs]
    contrib.sort(key=lambda x: x[0])
    worst_ret, worst_seg = contrib[0]
    d0, d1 = dates.iloc[worst_seg[0]], dates.iloc[worst_seg[-1]]
    keep = np.ones(len(dates), dtype=bool); keep[worst_seg] = False
    eq_bh_x = CAP * (1 + rbhw[keep]).cumprod()
    r4w = v4["r"][W.values].reset_index(drop=True)
    eq_v4_x = CAP * (1 + r4w[keep]).cumprod()
    dd_bh_x = (eq_bh_x / eq_bh_x.cummax() - 1).min()
    dd_v4_x = (eq_v4_x / eq_v4_x.cummax() - 1).min()
    c3 = abs(dd_v4_x) <= 0.8 * abs(dd_bh_x)
    print(f"C3 (sin el episodio de mayor contribucion: {d0.date()}..{d1.date()}, B&H {worst_ret*100:.1f}%):")
    print(f"  maxDD V4 {dd_v4_x*100:.1f}% vs B&H {dd_bh_x*100:.1f}% -> ratio {abs(dd_v4_x)/abs(dd_bh_x)*100:.1f}% -> {'PASA' if c3 else 'FALLA'}")
    # contexto 2013-2025 V4
    eq_full = CAP * (1 + v4["r"]).cumprod()
    cf, sf, df_, _ = metrics(eq_full)
    rbh_full = CAP * (1 + r_bh).cumprod()
    cbf, sbf, dbf, _ = metrics(rbh_full)
    print(f"contexto 2013-2025 V4: CAGR {cf*100:.2f}% Sharpe {sf:.2f} maxDD {df_*100:.1f}% "
          f"(B&H: {cbf*100:.2f}% / {sbf:.2f} / {dbf*100:.1f}%)")
    # C5: overlay
    ov, ntr = overlay_pnl_daily(sym, use_gex, und)
    ovw = ov.reindex(idx).fillna(0.0)
    eq_v4 = v4["eq"]
    eq_comb = eq_v4 + ovw.cumsum().values
    cc, sc, dc, yrc = metrics(eq_comb)
    c4v = res["V4 hist+open"]
    c5 = (abs(dc) <= abs(c4v["dd"]) + 1e-9) and (sc >= c4v["sharpe"] - 1e-9) and (ovw.sum() > 0)
    print(f"C5 overlay ({ntr} trades, P&L total ${ovw.sum():,.0f}):")
    print(f"  stock solo V4: Sharpe {c4v['sharpe']:.3f} maxDD {c4v['dd']*100:.2f}% | "
          f"combinado: Sharpe {sc:.3f} maxDD {dc*100:.2f}% CAGR {cc*100:.2f}% -> {'PASA' if c5 else 'FALLA'}")
    print(f"  por año combinado: {(yrc*100).round(1).to_dict()}")
    return dict(c1=c1_ok(v4), c2=len(set(verdicts)) == 1, c3=c3, c5=c5,
                cagr=v4["cagr"], dd=v4["dd"], sharpe=v4["sharpe"],
                bh=(c_bh, s_bh, dd_bh))

spy = run_symbol("spy", use_gex=True)
qqq = run_symbol("qqq", use_gex=False)

print("\n================ VEREDICTO BT-14 (V4 = variante de referencia) ================")
print(f"C1 (SPY, promesa central):        {'PASA' if spy['c1'] else 'FALLA'}")
print(f"C2 (robustez de ejecucion SPY):   {'PASA' if spy['c2'] else 'FALLA'}")
print(f"C3 (no-concentracion SPY):        {'PASA' if spy['c3'] else 'FALLA'}")
print(f"C4 (replica QQQ, criterios C1):   {'PASA' if qqq['c1'] else 'FALLA'}")
print(f"C5 (aditividad overlay SPY):      {'PASA' if spy['c5'] else 'FALLA'}")
allpass = spy["c1"] and spy["c2"] and spy["c3"] and qqq["c1"] and spy["c5"]
print(f"\nVEREDICTO: {'APROBADO — habilita discusion de paper del libro combinado' if allpass else 'REPROBADO — el libro queda como curiosidad documentada; produccion sigue PCS-only'}")
