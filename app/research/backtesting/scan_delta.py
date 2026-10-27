"""Familia 5: PCS a delta objetivo 0.25 / 0.30 (vs 0.20 canonico), ancho $5,
DTE 35-50, OOS 2018-2025, mismo pipeline H2 (gates + trailing por ventana + shrinkage).
Pregunta: el edge shrunk cruza la barra mas seguido en deltas mayores? A que costo?"""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
TARGETS = [0.20, 0.25, 0.30]
COLS = ["date","expiration","strike","type","mark","delta"]

und = pd.read_parquet(f"{BASE}/spy_options/spy_underlying_prices.parquet")[["date","close"]]
und["date"] = pd.to_datetime(und["date"])
und = und.sort_values("date")

rows = []
for y in range(2018, 2026):
    df = pd.read_parquet(f"{BASE}/spy_options/spy_options_{y}.parquet", columns=COLS)
    df = df[df.type == "put"].copy()
    df["date"] = pd.to_datetime(df["date"]); df["expiration"] = pd.to_datetime(df["expiration"])
    df["dte"] = (df.expiration - df.date).dt.days
    df = df[(df.dte >= 35) & (df.dte <= 50) & df.mark.notna() & df.delta.notna()]
    df["absd"] = df.delta.abs()
    # expiracion por dia: la mas cercana a 45 DTE
    pick_exp = df.groupby("date").apply(lambda g: g.loc[(g.dte - 45).abs().idxmin(), "expiration"])
    df = df.merge(pick_exp.rename("exp_pick"), on="date")
    df = df[df.expiration == df.exp_pick]
    marks = df.set_index(["date","strike"]).mark
    for tgt in TARGETS:
        short = df.loc[(df.absd - tgt).abs().groupby(df.date).idxmin()].copy()
        key = list(zip(short.date, short.strike - 5.0))
        short["lmark"] = [marks.get(k, np.nan) for k in key]
        short = short[short.lmark.notna()]
        short["credit"] = short["mark"] - short["lmark"]
        short["target"] = tgt
        rows.append(short[["date","expiration","strike","absd","credit","target"]])
    del df, marks

pcs = pd.concat(rows, ignore_index=True)
pcs = pcs[pcs.credit > 0]
# settlement: ultimo close <= expiration
pcs = pd.merge_asof(pcs.sort_values("expiration"), und.rename(columns={"date":"expiration","close":"exp_close"}),
                    on="expiration", direction="backward")
pcs["pnl_hold"] = 100*(pcs.credit - np.maximum(0, pcs.strike - pcs.exp_close)
                        + np.maximum(0, pcs.strike - 5 - pcs.exp_close)) - 6.3

# --- entorno + tail + trailing (mismo pipeline) ---
t = pd.read_parquet(f"{BASE}/derived/bt3_trades_spy.parquet")[["date","regime","vrp"]]
gexd = pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date","gex_b"]]
walls = pd.read_parquet(f"{BASE}/derived/spy_walls_daily.parquet")
skew = pd.read_parquet(f"{BASE}/derived/spy_skew25_daily.parquet")
vvix = pd.read_csv(f"{BASE}/vvix_history.csv"); vvix.columns=["date","vvix"]
vvix["date"] = pd.to_datetime(vvix["date"], format="%m/%d/%Y")
daily = skew.sort_values("date").reset_index(drop=True)
daily["skew_roc5"] = daily["skew25"]/daily["skew25"].shift(5)-1
daily = daily.merge(vvix,on="date",how="left"); daily["vvix"]=daily["vvix"].ffill()
def pts(x,w,b): return np.where(x>=b,2,np.where(x>=w,1,0))
daily["tail_out"]=(pts(daily["vvix"],110,130)+pts(daily["skew_roc5"],0.05,0.08))>=2
out=daily["tail_out"].to_numpy().copy(); ti=np.flatnonzero(out)
for a,b in zip(ti[:-1],ti[1:]):
    if 1<b-a<=3: out[a:b]=True
daily["tail_out_sm"]=out

pcs = pcs.merge(t,on="date",how="left").merge(gexd,on="date",how="left")\
         .merge(walls,on="date",how="left").merge(daily[["date","tail_out_sm"]],on="date",how="left")
pcs["tail_out_sm"]=pcs["tail_out_sm"].fillna(False)

obs = pd.read_parquet(f"{BASE}/derived/pop_obs_puts_spy.parquet")
def trailing(cutoff):
    o=obs[obs.expiration<cutoff]
    g=o.groupby("bucket").agg(x=("absd","mean"),y=("itm","mean"),n=("absd","size"))
    g=g[g.n>=50].sort_values("x"); return g["x"].to_numpy(),g["y"].to_numpy()
pcs["p_trail"]=np.nan
for y in range(2018,2026):
    xs,ys=trailing(pd.Timestamp(f"{y}-01-01")); m=pcs.date.dt.year==y
    pcs.loc[m,"p_trail"]=np.interp(pcs.loc[m,"absd"],xs,ys)

pcs["bar"]=pcs.regime.map({"low_vol":1.10,"normal":1.05,"elevated":1.10,"caution":1.20}).fillna(9)
pcs["edge_h2"]=(pcs.credit/5)/((pcs.absd+pcs.p_trail)/2)
pcs["edge_v0"]=(pcs.credit/5)/pcs.p_trail
gate=(pcs.regime!="engine_out")&(pcs.vrp>=1.2)&(pcs.gex_b>=0)&(pcs.strike<=pcs.put_wall)&(pcs.credit>=0.30)&(~pcs.tail_out_sm)

print("=== por delta objetivo (OOS 2018-2025, gates completos) ===")
for tgt in TARGETS:
    sub=pcs[(pcs.target==tgt)]
    op=sub[gate.reindex(sub.index).fillna(False)]
    print(f"\n-- target {tgt} | dias con candidato: {len(sub)} | operables: {len(op)} | "
          f"credit mediana ${op.credit.median():.2f} | muro rechaza {((sub.strike>sub.put_wall)).mean()*100:.1f}% de dias")
    for lbl,e in [("edge_H2",op.edge_h2),("edge_trailing",op.edge_v0)]:
        sig=op[e>=op.bar]
        if len(sig)==0:
            print(f"   {lbl:<14} 0 señales"); continue
        yearly=sig.groupby(sig.date.dt.year).pnl_hold.sum()
        print(f"   {lbl:<14} n={len(sig):>4} ({len(sig)/8:.1f}/año) win {(sig.pnl_hold>0).mean()*100:5.1f}% "
              f"avg ${sig.pnl_hold.mean():>6.1f} total ${sig.pnl_hold.sum():>7.0f} "
              f"peor-año ${yearly.min():>7.0f} ({int(yearly.idxmin())})")
    print(f"   edge_H2 mediana operables: {op.edge_h2.median():.2f} (barra {op.bar.mode().iat[0] if len(op) else '-'})")

# sanity: replica delta 0.20 vs bt3_trades
b3=pd.read_parquet(f"{BASE}/derived/bt3_trades_spy.parquet")
b3=b3[b3.date.dt.year.isin(range(2018,2026))]
rep=pcs[(pcs.target==0.20)].merge(b3[["date","credit","pnl_hold"]],on="date",suffixes=("_new","_bt3"))
print(f"\nsanity delta-0.20 vs bt3: corr credit {rep.credit_new.corr(rep.credit_bt3):.3f}, "
      f"diff credit mediana ${ (rep.credit_new-rep.credit_bt3).abs().median():.3f}")
