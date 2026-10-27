"""EXPLORATORIO — ¿Que estructuras monetizan mejor el entorno medido?
Sobre las MISMAS señales gated H3 SPY (delta 0.30, trailing, tail, GEX>=0) OOS 2018-2025:
  A. CSP (cash-secured put, sin wing) vs PCS — el wing que compramos es premio de crash
     sobrepreciado (BT-10b); ¿cuanto paga ahorrarselo y a que costo de cola?
  B. The wheel: CSP -> asignacion -> covered calls delta 0.30 hasta called-away.
     Variantes: (a) clasica (CC siempre) (b) CC solo si regimen operable.
     Hipotesis previa MEDIDA: la tabla de calls dice que el delta subestima el riesgo
     call 1.4-1.7x -> la pata CC vende seguro subvaluado (edge negativo esperado).
  C. Libro combinado: long SPY filtrado por L2 (regimen+tail) + overlay PCS-B en ARMED.
Friccion: $6.30 spread 2-legs, $3.15 single-leg round trip, $5 por evento de asignacion.
Sin dividendos en fases de stock (subestima la wheel ~1.3%/año prorrateado — declarado).
Genera hipotesis; NO habilita nada (ventana agotada)."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
COLS = ["date", "expiration", "strike", "type", "mark", "delta"]
TGT = 0.30
FR_SPREAD, FR_LEG, FR_ASSIGN = 6.30, 3.15, 5.0

und = pd.read_parquet(f"{BASE}/spy_options/spy_underlying_prices.parquet")[["date", "close"]]
und["date"] = pd.to_datetime(und["date"]); und = und.sort_values("date").reset_index(drop=True)
LAST = und.date.max()
close = und.set_index("date")["close"]

# ---------- señales H3 SPY (identico a bt10_mgmtB con GEX) ----------
def build_signals():
    rows = []
    for y in range(2018, 2026):
        df = pd.read_parquet(f"{BASE}/spy_options/spy_options_{y}.parquet", columns=COLS)
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
        rows.append(s[["date", "expiration", "strike", "mark", "absd", "credit", "dte"]])
    pcs = pd.concat(rows, ignore_index=True); pcs = pcs[pcs.credit > 0]
    pcs = pd.merge_asof(pcs.sort_values("expiration"),
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
    def pts(x, w, b): return np.where(x >= b, 2, np.where(x >= w, 1, 0))
    d["tail_out"] = (pts(d["vvix"], 110, 130) + pts(d["skew_roc5"], 0.05, 0.08)) >= 2
    out = d["tail_out"].to_numpy().copy(); ti = np.flatnonzero(out)
    for a, b in zip(ti[:-1], ti[1:]):
        if 1 < b - a <= 3: out[a:b] = True
    d["tail_out_sm"] = out
    pcs = pcs.merge(env, on="date", how="left").merge(walls, on="date", how="left") \
             .merge(d[["date", "tail_out_sm"]], on="date", how="left")
    pcs["tail_out_sm"] = pcs["tail_out_sm"].fillna(False)
    pcs = pcs[pcs.regime.notna()]
    obs = pd.read_parquet(f"{BASE}/derived/pop_obs_puts_spy.parquet")
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
    gexd = pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date", "gex_b"]]
    pcs = pcs.merge(gexd, on="date", how="left")
    gate = (pcs.regime != "engine_out") & (pcs.vrp >= 1.2) & (pcs.strike <= pcs.put_wall) & \
           (pcs.credit >= 0.30) & (~pcs.tail_out_sm) & (pcs.gex_b >= 0)
    sig = pcs[gate & (pcs.edge >= pcs.bar)].copy()
    sig = sig[sig.expiration <= LAST]
    return sig.sort_values("date").reset_index(drop=True), d[["date", "tail_out_sm"]]

sig, tail_daily = build_signals()
print(f"señales gated H3 SPY OOS: {len(sig)}")

# ---------- marks diarios de los strikes involucrados (puts) ----------
need_exp = set(sig.expiration); strikes = set(sig.strike) | set(sig.strike - 5.0)
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

def put_path(exp, k):
    try:
        return pm.loc[(exp, k)].set_index("date").mark.sort_index()
    except KeyError:
        return None

# ---------- A. PCS vs CSP sobre cada señal (hold y gestion B 50%) ----------
rows = []
for r in sig.itertuples():
    sh, lo = put_path(r.expiration, r.strike), put_path(r.expiration, r.strike - 5.0)
    itm = max(0, r.strike - r.exp_close)
    pcs_hold = 100 * (r.credit - itm + max(0, r.strike - 5 - r.exp_close)) - FR_SPREAD
    csp_hold = 100 * (r.mark - itm) - FR_LEG          # credito = mark del short solo
    pcs_B, csp_B = pcs_hold, csp_hold
    dpc = dcs = (r.expiration - r.date).days
    if sh is not None and lo is not None:
        v = (sh - lo).dropna(); v = v[(v.index > r.date) & (v.index <= r.expiration)]
        hit = v[v <= 0.5 * r.credit]
        if len(hit): pcs_B = 100 * (r.credit - hit.iloc[0]) - FR_SPREAD; dpc = (hit.index[0] - r.date).days
    if sh is not None:
        v = sh[(sh.index > r.date) & (sh.index <= r.expiration)]
        hit = v[v <= 0.5 * r.mark]
        if len(hit): csp_B = 100 * (r.mark - hit.iloc[0]) - FR_LEG; dcs = (hit.index[0] - r.date).days
    rows.append((r.date, r.strike, r.mark, r.credit, pcs_hold, pcs_B, dpc, csp_hold, csp_B, dcs, itm > 0))
A = pd.DataFrame(rows, columns=["date", "strike", "mark", "credit", "pcs_hold", "pcs_B", "d_pcs",
                                "csp_hold", "csp_B", "d_csp", "assigned"])
print("\n===== A. ESTRUCTURA sobre las mismas señales (n=%d) =====" % len(A))
print(f"{'':16}{'win%':>6}{'avg$':>8}{'total$':>9}{'p5$':>8}{'min$':>9}{'dias':>6}{'capital':>9}{'ret/señal':>10}")
for c, dcol, cap_desc in [("pcs_hold", "d_pcs", 500), ("pcs_B", "d_pcs", 500),
                          ("csp_hold", "d_csp", None), ("csp_B", "d_csp", None)]:
    s = A[c]; cap = A.strike * 100 if cap_desc is None else pd.Series(cap_desc, index=A.index)
    print(f"{c:16}{(s>0).mean()*100:>6.1f}{s.mean():>8.1f}{s.sum():>9.0f}{s.quantile(.05):>8.0f}"
          f"{s.min():>9.0f}{A[dcol].mean():>6.1f}{cap.mean():>9.0f}{(s/cap).mean()*100:>9.2f}%")
yr = A.groupby(A.date.dt.year)[["pcs_B", "csp_B", "csp_hold"]].sum().round(0)
print("\npor año:"); print(yr.to_string())
print(f"asignaciones (exp ITM): {A.assigned.sum()} de {len(A)} ({A.assigned.mean()*100:.1f}%)")

# ---------- B. THE WHEEL (cartera secuencial, 1 posicion por vez) ----------
# cargar calls delta~0.30 por dia (para la fase covered call)
cc_rows = []
for y in range(2018, 2026):
    df = pd.read_parquet(f"{BASE}/spy_options/spy_options_{y}.parquet", columns=COLS)
    df = df[df.type == "call"].copy()
    df["date"] = pd.to_datetime(df["date"]); df["expiration"] = pd.to_datetime(df["expiration"])
    df["dte"] = (df.expiration - df.date).dt.days
    df = df[(df.dte >= 35) & (df.dte <= 50) & df.mark.notna() & df.delta.notna()]
    df["absd"] = df.delta.abs()
    df = df[(df.absd > 0.10) & (df.absd < 0.50)]
    pick = df.loc[(df.dte - 45).abs().groupby(df.date).idxmin(), ["date", "expiration"]].rename(columns={"expiration": "exp_pick"})
    df = df.merge(pick, on="date"); df = df[df.expiration == df.exp_pick]
    s = df.loc[(df.absd - TGT).abs().groupby(df.date).idxmin()]
    cc_rows.append(s[["date", "expiration", "strike", "mark"]])
cc = pd.concat(cc_rows, ignore_index=True).set_index("date").sort_index()
cc = pd.merge_asof(cc.reset_index().sort_values("expiration"),
                   und.rename(columns={"date": "expiration", "close": "exp_close"}),
                   on="expiration", direction="backward").set_index("date").sort_index()

env_full = pd.read_parquet(f"{BASE}/derived/bt3_trades_spy.parquet")[["date", "regime"]]
gexd = pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date", "spot", "gex_b"]]
denv = gexd.merge(env_full, on="date", how="left").sort_values("date")
denv["regime"] = denv["regime"].ffill(limit=5)
denv = denv.merge(tail_daily, on="date", how="left")
denv["tail_out_sm"] = denv["tail_out_sm"].fillna(False).astype(bool)
denv["operable"] = denv.regime.notna() & (denv.regime != "engine_out") & ~denv.tail_out_sm
operable = denv.set_index("date")["operable"]
dates_all = denv.date.reset_index(drop=True)

def next_trading_day(dt):
    i = dates_all.searchsorted(dt, side="right")
    return dates_all.iloc[i] if i < len(dates_all) else None

def run_wheel(cc_env_aware):
    events, pnl_total = [], 0.0
    busy_until = pd.Timestamp("2000-01-01")
    for r in sig.itertuples():
        if r.date < busy_until: continue          # 1 posicion por vez
        # fase 1: CSP con gestion B
        sh = put_path(r.expiration, r.strike)
        closed = False
        if sh is not None:
            v = sh[(sh.index > r.date) & (sh.index <= r.expiration)]
            hit = v[v <= 0.5 * r.mark]
            if len(hit):
                pnl = 100 * (r.mark - hit.iloc[0]) - FR_LEG
                events.append((r.date, hit.index[0], "csp_tp50", pnl))
                pnl_total += pnl; busy_until = hit.index[0]; closed = True
        if closed: continue
        itm = r.strike - r.exp_close
        if itm <= 0:                               # expiro OTM
            pnl = 100 * r.mark - FR_LEG
            events.append((r.date, r.expiration, "csp_otm", pnl))
            pnl_total += pnl; busy_until = r.expiration; continue
        # asignado: compra 100 acciones a strike (credito ya cobrado)
        pnl_total += 100 * r.mark - FR_LEG - FR_ASSIGN
        events.append((r.date, r.expiration, "csp_assigned", 100 * r.mark - FR_LEG - FR_ASSIGN))
        basis = r.strike
        day = next_trading_day(r.expiration)
        # fase 2: covered calls hasta called-away (o fin de datos)
        while day is not None and day <= LAST:
            if cc_env_aware and not bool(operable.reindex([day]).fillna(False).iloc[0]):
                day = next_trading_day(day); continue     # espera sin CC
            row = cc[cc.index >= day]
            if not len(row): break
            c0 = row.iloc[0]; day = row.index[0]
            prem = 100 * c0["mark"] - FR_LEG
            if c0["exp_close"] > c0["strike"]:            # called away
                pnl = prem + 100 * (c0["strike"] - basis) - FR_ASSIGN
                events.append((day, c0["expiration"], "cc_called", pnl))
                pnl_total += pnl; busy_until = c0["expiration"]; day = None
            else:
                events.append((day, c0["expiration"], "cc_otm", prem))
                pnl_total += prem
                day = next_trading_day(c0["expiration"])
        if day is not None and day > LAST:                # fin de datos con stock
            last_px = close.iloc[-1]
            pnl = 100 * (last_px - basis)
            events.append((LAST, LAST, "trunc_stock", pnl)); pnl_total += pnl
            busy_until = LAST
    ev = pd.DataFrame(events, columns=["d0", "d1", "kind", "pnl"])
    return ev, pnl_total

def run_csp_only():
    """CSP con gestion B; si asigna, vende el stock al cierre de expiracion (sin wheel)"""
    events = []
    busy_until = pd.Timestamp("2000-01-01")
    for r in sig.itertuples():
        if r.date < busy_until: continue
        sh = put_path(r.expiration, r.strike)
        if sh is not None:
            v = sh[(sh.index > r.date) & (sh.index <= r.expiration)]
            hit = v[v <= 0.5 * r.mark]
            if len(hit):
                events.append((r.date, hit.index[0], "tp50", 100 * (r.mark - hit.iloc[0]) - FR_LEG))
                busy_until = hit.index[0]; continue
        pnl = 100 * (r.mark - max(0, r.strike - r.exp_close)) - FR_LEG - (FR_ASSIGN if r.strike > r.exp_close else 0)
        events.append((r.date, r.expiration, "exp", pnl)); busy_until = r.expiration
    return pd.DataFrame(events, columns=["d0", "d1", "kind", "pnl"])

def run_pcs_B():
    events = []
    busy_until = pd.Timestamp("2000-01-01")
    for r in sig.itertuples():
        if r.date < busy_until: continue
        sh, lo = put_path(r.expiration, r.strike), put_path(r.expiration, r.strike - 5.0)
        if sh is not None and lo is not None:
            v = (sh - lo).dropna(); v = v[(v.index > r.date) & (v.index <= r.expiration)]
            hit = v[v <= 0.5 * r.credit]
            if len(hit):
                events.append((r.date, hit.index[0], "tp50", 100 * (r.credit - hit.iloc[0]) - FR_SPREAD))
                busy_until = hit.index[0]; continue
        itm = max(0, r.strike - r.exp_close)
        pnl = 100 * (r.credit - itm + max(0, r.strike - 5 - r.exp_close)) - FR_SPREAD
        events.append((r.date, r.expiration, "exp", pnl)); busy_until = r.expiration
    return pd.DataFrame(events, columns=["d0", "d1", "kind", "pnl"])

print("\n===== B. CARTERAS SECUENCIALES (1 posicion por vez, señales H3) =====")
for name, ev in [("PCS-B (referencia)", run_pcs_B()), ("CSP-only (liquida si asigna)", run_csp_only()),
                 ("WHEEL clasica (CC siempre)", run_wheel(False)[0]),
                 ("WHEEL env-aware (CC si operable)", run_wheel(True)[0])]:
    tot = ev.pnl.sum(); n = len(ev)
    byy = ev.groupby(ev.d0.dt.year).pnl.sum()
    kinds = ev.kind.value_counts().to_dict()
    print(f"\n{name}: eventos {n}, total ${tot:,.0f}, peor año ${byy.min():,.0f} ({int(byy.idxmin())})")
    print(f"  por año: {byy.round(0).to_dict()}")
    print(f"  eventos: {kinds}")

# ---------- C. LIBRO COMBINADO: L2-long SPY + overlay PCS-B ----------
print("\n===== C. LIBRO COMBINADO (fraccional, base $10k, 1 contrato PCS) =====")
dl = denv.copy()
dl["armed"] = dl.operable & (dl.gex_b >= 0)
env_vrp = pd.read_parquet(f"{BASE}/derived/bt3_trades_spy.parquet")[["date", "vrp"]]
dl = dl.merge(env_vrp, on="date", how="left"); dl["vrp"] = dl["vrp"].ffill(limit=5)
dl["armed"] = dl["armed"] & (dl.vrp >= 1.2)
dl = dl[dl.date.dt.year >= 2018].reset_index(drop=True)
dl["ret"] = dl.spot.pct_change()
pos = dl["operable"].shift(1).fillna(False).astype(bool)   # L2 filter long
dl["r_stock"] = dl["ret"].where(pos, 0.0)
pcsB = run_pcs_B(); pnl_day = pcsB.groupby("d1").pnl.sum()  # P&L al dia de salida
dl["pnl_pcs"] = dl.date.map(pnl_day).fillna(0.0)
CAP = 10_000
eq_stock = CAP * (1 + dl.r_stock.fillna(0)).cumprod()
eq_comb = eq_stock + dl.pnl_pcs.cumsum()
eq_bh = CAP * (1 + dl.ret.fillna(0)).cumprod()
def summ(eq, label):
    r = eq.pct_change().dropna(); yrs = len(r) / 252
    cagr = (eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1
    dd = (eq / eq.cummax() - 1).min()
    print(f"{label:<34} final ${eq.iloc[-1]:>9,.0f}  CAGR {cagr*100:5.2f}%  Sharpe {r.mean()/r.std()*np.sqrt(252):5.2f}  maxDD {dd*100:6.1f}%")
summ(eq_bh, "Buy&Hold SPY")
summ(eq_stock, "L2-long solo (regimen+tail)")
summ(CAP + dl.pnl_pcs.cumsum() + 0 * eq_stock, "PCS-B solo (cash + overlay)")
summ(eq_comb, "COMBINADO L2-long + PCS-B overlay")
print("(P&L del PCS atribuido al dia de salida — lumpy; Sharpe/maxDD del combinado aproximados)")
