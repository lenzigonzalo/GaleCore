"""Scan exploratorio familias 1-3: sobre los dias OOS operables (todos los gates
menos edge), medir si edad-de-regimen, nivel de skew, percentil GEX, IV pct,
RV cayendo y distancia al muro separan ganadores de los clusters 2018/2020.
EXPLORATORIO: genera hipotesis; la confirmacion exige pre-declaracion + walk-forward."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
t = pd.read_parquet(f"{BASE}/derived/bt3_trades_spy.parquet")
obs = pd.read_parquet(f"{BASE}/derived/pop_obs_puts_spy.parquet")
gexd = pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")  # date, gex_gamma_oi, spot, gex_b
walls = pd.read_parquet(f"{BASE}/derived/spy_walls_daily.parquet")
skew = pd.read_parquet(f"{BASE}/derived/spy_skew25_daily.parquet")
vvix = pd.read_csv(f"{BASE}/vvix_history.csv"); vvix.columns = ["date","vvix"]
vvix["date"] = pd.to_datetime(vvix["date"], format="%m/%d/%Y")

t = t.merge(gexd[["date","gex_b","spot"]], on="date", how="left").merge(walls, on="date", how="left")

# --- tail_out diario ---
daily = skew.sort_values("date").reset_index(drop=True)
daily["skew_roc5"] = daily["skew25"]/daily["skew25"].shift(5)-1
daily = daily.merge(vvix, on="date", how="left"); daily["vvix"] = daily["vvix"].ffill()
def pts(x,w,b): return np.where(x>=b,2,np.where(x>=w,1,0))
daily["tail_out"] = (pts(daily["vvix"],110,130)+pts(daily["skew_roc5"],0.05,0.08))>=2
out = daily["tail_out"].to_numpy().copy(); ti = np.flatnonzero(out)
for a,b in zip(ti[:-1],ti[1:]):
    if 1 < b-a <= 3: out[a:b] = True
daily["tail_out_sm"] = out
# percentil rolling del NIVEL de skew (252d)
daily["skew_pct"] = daily["skew25"].rolling(252, min_periods=100).rank(pct=True)
t = t.merge(daily[["date","tail_out_sm","skew_pct","skew25"]], on="date", how="left")
t["tail_out_sm"] = t["tail_out_sm"].fillna(False)

# --- discriminadores diarios sobre la serie completa de t (ordenada) ---
t = t.sort_values("date").reset_index(drop=True)
blocked_regime = (t.regime=="engine_out") | t.tail_out_sm
# edad del regimen: dias (filas) desde el ultimo dia bloqueado
age = np.zeros(len(t)); c = 999
for i, blk in enumerate(blocked_regime.to_numpy()):
    c = 0 if blk else c+1
    age[i] = c
t["regime_age"] = age
t["iv_pct"]  = t["atm_iv"].rolling(252, min_periods=100).rank(pct=True)
t["gex_pct"] = t["gex_b"].rolling(252, min_periods=100).rank(pct=True)
t["rv_chg10"] = t["rv30"] - t["rv30"].shift(10)   # <0 = RV cayendo (resaca)
t["wall_dist"] = (t.spot - t.put_wall)/t.spot*100  # % spot sobre el muro

# --- trailing p + edge H2 ---
def trailing(cutoff):
    o = obs[obs.expiration<cutoff]
    g = o.groupby("bucket").agg(x=("absd","mean"),y=("itm","mean"),n=("absd","size"))
    g = g[g.n>=50].sort_values("x"); return g["x"].to_numpy(), g["y"].to_numpy()
t["p_trail"] = np.nan
for y in range(2018,2026):
    xs,ys = trailing(pd.Timestamp(f"{y}-01-01")); m = t.date.dt.year==y
    t.loc[m,"p_trail"] = np.interp(t.loc[m,"absd"],xs,ys)

oos = t[t.date.dt.year.isin(range(2018,2026))].copy()
oos["bar"] = oos.regime.map({"low_vol":1.10,"normal":1.05,"elevated":1.10,"caution":1.20}).fillna(9)
oos["edge_h2"] = (oos.credit/5)/((oos.absd+oos.p_trail)/2)
operable = (oos.regime!="engine_out")&(oos.vrp>=1.2)&(oos.gex_b>=0)&(oos.strike<=oos.put_wall)&(oos.credit>=0.30)&(~oos.tail_out_sm)
op = oos[operable].copy()
op["bad_cluster"] = op.date.dt.year.isin([2018,2020]) & (op.pnl_hold<0)
print(f"dias OOS operables (todos los gates menos edge): {len(op)}")
print(f"  P&L: win {(op.pnl_hold>0).mean()*100:.1f}% avg ${op.pnl_hold.mean():.1f} total ${op.pnl_hold.sum():.0f}")
print(f"  perdedores 2018/2020: {op.bad_cluster.sum()} dias, suma ${op[op.bad_cluster].pnl_hold.sum():.0f}")

DISC = ["regime_age","skew_pct","gex_pct","iv_pct","rv_chg10","wall_dist","vrp"]
for d in DISC:
    print(f"\n=== {d} (cuartiles sobre dias operables) ===")
    try:
        op["q"] = pd.qcut(op[d], 4, duplicates="drop")
    except Exception as e:
        print("  no binneable:", e); continue
    g = op.groupby("q", observed=True).agg(
        n=("pnl_hold","size"), win=("pnl_hold", lambda s:(s>0).mean()*100),
        avg=("pnl_hold","mean"), total=("pnl_hold","sum"),
        perdida_1820=("pnl_hold", lambda s: s[(s<0)].sum()),
        n_bad=("bad_cluster","sum"))
    print(g.round(1).to_string())

# counterfactual condicional (EXPLORATORIO): permitir tabla trailing plena solo si
# el discriminador esta en su mitad "buena"; sino, edge H2. Medir total y peor anio.
print("\n=== counterfactual: edge trailing pleno SOLO si condicion; si no, shrinkage ===")
oos["edge_v0"] = (oos.credit/5)/oos.p_trail
conds = {
    "regime_age > mediana": oos.regime_age > op.regime_age.median(),
    "regime_age <= mediana (resaca joven)": oos.regime_age <= op.regime_age.median(),
    "skew_pct > 0.5": oos.skew_pct > 0.5,
    "gex_pct > 0.5": oos.gex_pct > 0.5,
    "iv_pct > 0.5": oos.iv_pct > 0.5,
    "rv cayendo (chg10<0)": oos.rv_chg10 < 0,
}
base_gates = operable
for name, c in conds.items():
    edge_mix = np.where(c, oos.edge_v0, oos.edge_h2)
    sig = base_gates & (edge_mix >= oos.bar)
    s = oos[sig]
    yearly = s.groupby(s.date.dt.year).pnl_hold.sum()
    worst = yearly.min() if len(s) else 0
    print(f"{name:<38} n={len(s):>4} ({len(s)/8:.1f}/año) win {(s.pnl_hold>0).mean()*100 if len(s) else 0:5.1f}% "
          f"total ${s.pnl_hold.sum():>7.0f} peor-año ${worst:>7.0f} ({int(yearly.idxmin()) if len(s) else '-'})")
