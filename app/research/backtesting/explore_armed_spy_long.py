"""EXPLORATORIO — Long SPY (stock) condicionado al estado ARMED.
Pregunta: si el sistema esta ARMED (Tier A completo: regimen operable + tail_score ok
+ GEX>=0 + VRP>=1.2), ¿conviene estar comprado en SPY? Comprar al prenderse, vender
al apagarse. Independiente del trigger de opciones.

Implementacion honesta: la senal se conoce EOD -> se entra al cierre del dia que se
prende y se sale al cierre del dia que se apaga (pos[t] = ARMED[t-1]).
Retornos de precio (sin dividendos, ~1.3%/anio no capturado al estar afuera).
Regimen/VRP: ffill max 5 dias sobre huecos del cache (entorno lento); resto = OFF.
Genera hipotesis; NO habilita nada (ventana 2018-2025 agotada, resto in-sample)."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"

# --- serie diaria completa ---
g = pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date", "spot", "gex_b"]]
env = pd.read_parquet(f"{BASE}/derived/bt3_trades_spy.parquet")[["date", "regime", "vrp"]]
d = g.merge(env, on="date", how="left").sort_values("date").reset_index(drop=True)
d[["regime", "vrp"]] = d[["regime", "vrp"]].ffill(limit=5)

# --- tail_out diario (VVIX 110/130 + skew25 RoC5d 5%/8%, score>=2, huecos <=2d) ---
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
d = d.merge(skew[["date", "tail_out_sm"]], on="date", how="left")
d["tail_out_sm"] = d["tail_out_sm"].fillna(False)

# --- escalera de estados (cada gate acumulativo) ---
d["g_regime"] = d.regime.notna() & (d.regime != "engine_out")
d["g_tail"]   = d.g_regime & ~d.tail_out_sm
d["g_gex"]    = d.g_tail & (d.gex_b >= 0)
d["armed"]    = d.g_gex & (d.vrp >= 1.2)

d["ret"] = d.spot.pct_change()

def stats(ret, pos, label, spot):
    """pos ya laggeada: earn ret[t] si pos[t]"""
    r = ret.where(pos, 0.0).iloc[1:]
    eq = (1 + r).cumprod()
    n_in = int(pos.iloc[1:].sum()); yrs = len(r) / 252
    cagr = eq.iloc[-1] ** (1 / yrs) - 1
    rin = ret[pos].dropna()
    vol_in = rin.std() * np.sqrt(252)
    sharpe = (r.mean() / r.std() * np.sqrt(252)) if r.std() > 0 else np.nan
    dd = (eq / eq.cummax() - 1).min()
    # episodios
    p = pos.astype(int).to_numpy()
    starts = np.flatnonzero(np.diff(p, prepend=0) == 1)
    ends   = np.flatnonzero(np.diff(p, append=0) == -1)
    ep_ret = [spot.iloc[min(e, len(spot)-1)] / spot.iloc[max(s-1, 0)] - 1 for s, e in zip(starts, ends)]
    ep_ret = pd.Series(ep_ret)
    print(f"{label:<28} exp {n_in/len(r)*100:4.1f}%  CAGR {cagr*100:6.2f}%  "
          f"Sharpe {sharpe:5.2f}  maxDD {dd*100:6.1f}%  "
          f"avg-dia-IN {rin.mean()*1e4:5.1f}bp (ann {rin.mean()*252*100:5.1f}%)  vol-IN {vol_in*100:4.1f}%  "
          f"episodios {len(ep_ret)} (win {(ep_ret>0).mean()*100:4.1f}%, med {ep_ret.median()*100:5.2f}%, "
          f"peor {ep_ret.min()*100:6.2f}%)")
    return r

def run(dd_, tag):
    print(f"\n================ {tag} ================")
    ret, spot = dd_["ret"], dd_["spot"]
    bh = ret.iloc[1:]
    eq = (1 + bh).cumprod(); yrs = len(bh) / 252
    print(f"{'Buy & Hold':<28} exp 100.0%  CAGR {(eq.iloc[-1]**(1/yrs)-1)*100:6.2f}%  "
          f"Sharpe {bh.mean()/bh.std()*np.sqrt(252):5.2f}  maxDD {((eq/eq.cummax()-1).min())*100:6.1f}%")
    rs = {}
    for col, lab in [("g_regime", "L1 regimen operable"), ("g_tail", "L2 +tail_score"),
                     ("g_gex", "L3 +GEX>=0"), ("armed", "L4 +VRP>=1.2 (=ARMED)")]:
        pos = dd_[col].shift(1).fillna(False)   # senal EOD -> posicion desde el cierre
        rs[col] = stats(ret, pos, lab, spot)
    # dentro vs fuera (dias ARMED vs no, sin lag — caracter informativo)
    a = dd_["armed"].shift(1).fillna(False)
    rin, rout = ret[a].dropna(), ret[~a].iloc[1:].dropna()
    t = (rin.mean() - rout.mean()) / np.sqrt(rin.var()/len(rin) + rout.var()/len(rout))
    print(f"\n  dias ARMED: avg {rin.mean()*1e4:.1f}bp/dia  |  dias OFF: avg {rout.mean()*1e4:.1f}bp/dia  "
          f"| diff t-stat {t:.2f}")
    # por anio: estrategia ARMED vs B&H
    dd2 = dd_.iloc[1:].copy()
    dd2["strat"] = dd2["ret"].where(dd_["armed"].shift(1).fillna(False).iloc[1:], 0.0)
    ytab = dd2.groupby(dd2.date.dt.year).apply(
        lambda x: pd.Series({"exp%": x["strat"].ne(0).mean()*100 if len(x) else 0,
                             "ARMED%": ((1+x["strat"]).prod()-1)*100,
                             "B&H%": ((1+x["ret"]).prod()-1)*100}), include_groups=False)
    print("\n  Por anio (ARMED long vs B&H):")
    print(ytab.round(1).to_string())

run(d, "FULL 2013-2025 (in-sample para gates)")
run(d[d.date.dt.year >= 2018].reset_index(drop=True), "OOS-window 2018-2025 (agotada, exploratorio)")

# sanity: cuantos dias quedaron sin clasificar tras ffill
print(f"\ndias sin regime tras ffill(5): {d.regime.isna().sum()} de {len(d)} (tratados como OFF)")
