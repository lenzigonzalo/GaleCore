"""Descomposición del colapso de ocurrencia H2 (BT-9b) — SPY only.

Walk-forward idéntico a la spec BT-9/BT-9b: ventana expansiva, recalibración anual
de la tabla POP de puts usando SOLO vencimientos <= corte (anti-lookahead),
gates congelados (régimen operable, VRP>=1.2, GEX>=0, muro-sanidad, anti-pennies),
barras min_edge congeladas (1.05 normal / 1.10 low_vol y elevated / 1.20 caution).

4 variantes:
  V0  trailing puro                (= BT-9, reprobado)
  V1  shrinkage 50% solo
  V2  trailing + tail_score
  V3  shrinkage + tail_score       (= H2, aprobado)
"""
import pandas as pd
import numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
OOS_YEARS = range(2018, 2026)
MIN_EDGE = {"low_vol": 1.10, "normal": 1.05, "elevated": 1.10, "caution": 1.20}

# ---------- carga ----------
t = pd.read_parquet(f"{BASE}/derived/bt3_trades_spy.parquet")
obs = pd.read_parquet(f"{BASE}/derived/pop_obs_puts_spy.parquet")
gex = pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date", "gex_b"]]
walls = pd.read_parquet(f"{BASE}/derived/spy_walls_daily.parquet")
skew = pd.read_parquet(f"{BASE}/derived/spy_skew25_daily.parquet")[["date", "skew25"]]
vvix = pd.read_csv(f"{BASE}/vvix_history.csv")
vvix.columns = ["date", "vvix"]
vvix["date"] = pd.to_datetime(vvix["date"], format="%m/%d/%Y")

t = t.merge(gex, on="date", how="left").merge(walls, on="date", how="left")

# ---------- tail_score diario (VVIX nivel + skew25 RoC5d), huecos <=2d ----------
daily = skew.sort_values("date").reset_index(drop=True)
daily["skew_roc5"] = daily["skew25"] / daily["skew25"].shift(5) - 1
daily = daily.merge(vvix, on="date", how="left")
daily["vvix"] = daily["vvix"].ffill()

def pts(x, warn, block):
    return np.where(x >= block, 2, np.where(x >= warn, 1, 0))

daily["score"] = pts(daily["vvix"], 110, 130) + pts(daily["skew_roc5"], 0.05, 0.08)
daily["tail_out"] = daily["score"] >= 2

# suavizado: huecos False de <=2 días de trading entre días True se cierran
out = daily["tail_out"].to_numpy().copy()
true_idx = np.flatnonzero(out)
for a, b in zip(true_idx[:-1], true_idx[1:]):
    if 1 < b - a <= 3:  # hueco de 1 o 2 días entre a y b
        out[a:b] = True
daily["tail_out_sm"] = out
t = t.merge(daily[["date", "tail_out_sm"]], on="date", how="left")
t["tail_out_sm"] = t["tail_out_sm"].fillna(False)

# ---------- gates congelados (pre-edge) ----------
gate = (
    (t.regime != "engine_out")
    & (t.vrp >= 1.2)
    & (t.gex_b >= 0)
    & (t.strike <= t.put_wall)
    & (t.credit >= 0.30)   # como BT-9 original: solo credit_min (el ratio 10% NO estaba en la corrida)
)
t["gate_base"] = gate
t["bar"] = t.regime.map(MIN_EDGE)

# ---------- calibración trailing por ventana (solo puts, vencimiento <= corte) ----------
def trailing_table(cutoff):
    o = obs[obs.expiration < cutoff]
    g = o.groupby("bucket").agg(x=("absd", "mean"), y=("itm", "mean"), n=("absd", "size"))
    g = g[g.n >= 50].sort_values("x")
    return g["x"].to_numpy(), g["y"].to_numpy()

t["p_trail"] = np.nan
for y in OOS_YEARS:
    cutoff = pd.Timestamp(f"{y}-01-01")
    xs, ys = trailing_table(cutoff)
    m = t.date.dt.year == y
    t.loc[m, "p_trail"] = np.interp(t.loc[m, "absd"], xs, ys)

oos = t[t.date.dt.year.isin(OOS_YEARS)].copy()
oos["edge_v0"] = (oos.credit / 5.0) / oos.p_trail
oos["edge_v1"] = (oos.credit / 5.0) / ((oos.absd + oos.p_trail) / 2.0)

pennies = oos.credit >= 0.50  # piso ratio>=10% de ancho $5 (adoptado en BT-3 run 2, ausente en la corrida BT-9)
variants = {
    "V0 trailing puro (BT-9)":        (oos.edge_v0 >= oos.bar) & oos.gate_base,
    "V1 shrinkage solo":              (oos.edge_v1 >= oos.bar) & oos.gate_base,
    "V2 trailing + tail_score":       (oos.edge_v0 >= oos.bar) & oos.gate_base & ~oos.tail_out_sm,
    "V3 shrinkage + tail (H2)":       (oos.edge_v1 >= oos.bar) & oos.gate_base & ~oos.tail_out_sm,
    "V4 trailing + piso $0.50":       (oos.edge_v0 >= oos.bar) & oos.gate_base & pennies,
    "V5 trailing + piso + tail":      (oos.edge_v0 >= oos.bar) & oos.gate_base & pennies & ~oos.tail_out_sm,
    "V6 H2 + piso $0.50":             (oos.edge_v1 >= oos.bar) & oos.gate_base & pennies & ~oos.tail_out_sm,
}

print(f"OOS 2018-2025 SPY — días-trade candidatos: {len(oos)}")
print(f"tail_out (suavizado) % de días candidatos: {oos.tail_out_sm.mean()*100:.1f}%")
print(f"engine_out (flags rápidos) % de días: {(oos.regime=='engine_out').mean()*100:.1f}%")
print(f"engine_out ∪ tail_out: {((oos.regime=='engine_out')|oos.tail_out_sm).mean()*100:.1f}%\n")

rows = []
for name, mask in variants.items():
    s = oos[mask]
    yearly = s.groupby(s.date.dt.year).pnl_hold.sum()
    rows.append({
        "variante": name,
        "señales": len(s),
        "señ/año": round(len(s) / 8, 1),
        "win%": round((s.pnl_hold > 0).mean() * 100, 1) if len(s) else None,
        "avg$": round(s.pnl_hold.mean(), 1) if len(s) else None,
        "total$": round(s.pnl_hold.sum(), 0),
        "peor año$": round(yearly.min(), 0) if len(s) else 0,
        "año peor": int(yearly.idxmin()) if len(s) else None,
        "2018$": round(yearly.get(2018, 0), 0),
    })
print(pd.DataFrame(rows).to_string(index=False))

print("\n--- detalle por año (suma pnl_hold por variante) ---")
det = pd.DataFrame({
    name: oos[mask].groupby(oos[mask].date.dt.year).pnl_hold.sum()
    for name, mask in variants.items()
}).round(0).fillna(0)
print(det.to_string())

print("\n--- dónde muere cada señal de V1 que H2 (V3) rechaza ---")
v1 = variants["V1 shrinkage solo"]
v3 = variants["V3 shrinkage + tail (H2)"]
killed = oos[v1 & ~v3]
print(f"señales V1 mata-tail: {len(killed)}; por año: {killed.groupby(killed.date.dt.year).size().to_dict()}")
print(f"P&L de lo que el tail_score mató (bajo shrinkage): total ${killed.pnl_hold.sum():.0f}, "
      f"win {(killed.pnl_hold>0).mean()*100:.0f}%, min ${killed.pnl_hold.min():.0f}" if len(killed) else "")

print("\n--- reproducción BT-9 (check): V0 2018 debería aproximar -$5.496 ---")
v0_2018 = oos[variants["V0 trailing puro (BT-9)"] & (oos.date.dt.year == 2018)]
print(f"V0 2018: {len(v0_2018)} señales, suma ${v0_2018.pnl_hold.sum():.0f}, win {(v0_2018.pnl_hold>0).mean()*100:.0f}%")
