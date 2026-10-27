"""Bajo H2: para cada dia OOS que NO dispara, que gate(s) lo bloquean.
Y: cuanto edge le falta a los dias que solo mueren por el edge gate."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
t = pd.read_parquet(f"{BASE}/derived/bt3_trades_spy.parquet")
obs = pd.read_parquet(f"{BASE}/derived/pop_obs_puts_spy.parquet")
gex = pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date", "gex_b"]]
walls = pd.read_parquet(f"{BASE}/derived/spy_walls_daily.parquet")
skew = pd.read_parquet(f"{BASE}/derived/spy_skew25_daily.parquet")[["date", "skew25"]]
vvix = pd.read_csv(f"{BASE}/vvix_history.csv")
vvix.columns = ["date", "vvix"]
vvix["date"] = pd.to_datetime(vvix["date"], format="%m/%d/%Y")
t = t.merge(gex, on="date", how="left").merge(walls, on="date", how="left")

daily = skew.sort_values("date").reset_index(drop=True)
daily["skew_roc5"] = daily["skew25"] / daily["skew25"].shift(5) - 1
daily = daily.merge(vvix, on="date", how="left")
daily["vvix"] = daily["vvix"].ffill()
def pts(x, w, b): return np.where(x >= b, 2, np.where(x >= w, 1, 0))
daily["tail_out"] = (pts(daily["vvix"], 110, 130) + pts(daily["skew_roc5"], 0.05, 0.08)) >= 2
out = daily["tail_out"].to_numpy().copy()
ti = np.flatnonzero(out)
for a, b in zip(ti[:-1], ti[1:]):
    if 1 < b - a <= 3: out[a:b] = True
daily["tail_out_sm"] = out
t = t.merge(daily[["date", "tail_out_sm"]], on="date", how="left")
t["tail_out_sm"] = t["tail_out_sm"].fillna(False)

def trailing(cutoff):
    o = obs[obs.expiration < cutoff]
    g = o.groupby("bucket").agg(x=("absd", "mean"), y=("itm", "mean"), n=("absd", "size"))
    g = g[g.n >= 50].sort_values("x")
    return g["x"].to_numpy(), g["y"].to_numpy()

t["p_trail"] = np.nan
for y in range(2018, 2026):
    xs, ys = trailing(pd.Timestamp(f"{y}-01-01"))
    m = t.date.dt.year == y
    t.loc[m, "p_trail"] = np.interp(t.loc[m, "absd"], xs, ys)

oos = t[t.date.dt.year.isin(range(2018, 2026))].copy()
oos["bar"] = oos.regime.map({"low_vol": 1.10, "normal": 1.05, "elevated": 1.10, "caution": 1.20}).fillna(9)
oos["edge_h2"] = (oos.credit / 5.0) / ((oos.absd + oos.p_trail) / 2.0)

gates = {
    "regimen (flags rapidos)": oos.regime != "engine_out",
    "VRP>=1.2":               oos.vrp >= 1.2,
    "GEX>=0":                 oos.gex_b >= 0,
    "muro":                   oos.strike <= oos.put_wall,
    "tail_score":             ~oos.tail_out_sm,
    "edge_H2>=barra":         oos.edge_h2 >= oos.bar,
}
gdf = pd.DataFrame(gates)
fired = gdf.all(axis=1)
print(f"OOS dias: {len(oos)} | señales H2: {fired.sum()}")
print("\n%% de dias OOS que cada gate rechaza (individual):")
for k in gates: print(f"  {k:<24} {(~gdf[k]).mean()*100:5.1f}%")
print("\nbloqueador MARGINAL (dias donde falla SOLO ese gate y ningun otro):")
for k in gates:
    others = gdf.drop(columns=k).all(axis=1)
    print(f"  {k:<24} {(others & ~gdf[k]).sum():>5} dias ({(others & ~gdf[k]).mean()*100:.1f}% del OOS)")

# los dias donde solo falta el edge: cuanto les falta y que P&L hubieran tenido
others = gdf.drop(columns="edge_H2>=barra").all(axis=1)
solo_edge = oos[others & ~gdf["edge_H2>=barra"]]
print(f"\ndias bloqueados SOLO por el edge H2: {len(solo_edge)} ({len(solo_edge)/8:.0f}/año)")
print(f"  edge_H2: mediana {solo_edge.edge_h2.median():.2f} | p90 {solo_edge.edge_h2.quantile(0.9):.2f} (barra 1.05/1.10)")
print(f"  P&L contrafactual de esos dias: win {(solo_edge.pnl_hold>0).mean()*100:.1f}%, avg ${solo_edge.pnl_hold.mean():.1f}, "
      f"total ${solo_edge.pnl_hold.sum():.0f}, p5 ${solo_edge.pnl_hold.quantile(0.05):.0f}, min ${solo_edge.pnl_hold.min():.0f}")
yearly = solo_edge.groupby(solo_edge.date.dt.year).pnl_hold.sum().round(0)
print(f"  por año: {yearly.to_dict()}")
# credito que exige el shrinkage: p_loss >= absd/2 => credit minimo para cruzar barra
oos["credit_req"] = oos.bar * 5 * (oos.absd + oos.p_trail) / 2
print(f"\ncredito requerido para cruzar la barra con shrinkage: mediana ${oos.credit_req.median():.2f} "
      f"vs credito ofrecido mediana ${oos.credit.median():.2f}")
print(f"dias operables (todos los gates menos edge) con credito ofrecido >= requerido: "
      f"{(oos[others].credit >= oos[others].credit_req).mean()*100:.1f}%")
