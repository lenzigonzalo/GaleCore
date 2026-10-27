"""Diagnostico profundo del hallazgo delta 0.25/0.30 + tabla trailing:
detalle anual, C2, sensibilidad de barras, rol del tail_score, factor de calibracion."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
COLS = ["date","expiration","strike","type","mark","delta"]
und = pd.read_parquet(f"{BASE}/spy_options/spy_underlying_prices.parquet")[["date","close"]]
und["date"]=pd.to_datetime(und["date"]); und=und.sort_values("date")

rows=[]
for y in range(2018,2026):
    df=pd.read_parquet(f"{BASE}/spy_options/spy_options_{y}.parquet",columns=COLS)
    df=df[df.type=="put"].copy()
    df["date"]=pd.to_datetime(df["date"]); df["expiration"]=pd.to_datetime(df["expiration"])
    df["dte"]=(df.expiration-df.date).dt.days
    df=df[(df.dte>=35)&(df.dte<=50)&df.mark.notna()&df.delta.notna()]
    df["absd"]=df.delta.abs()
    pick=df.loc[(df.dte-45).abs().groupby(df.date).idxmin(),["date","expiration"]].rename(columns={"expiration":"exp_pick"})
    df=df.merge(pick,on="date"); df=df[df.expiration==df.exp_pick]
    marks=df.set_index(["date","strike"]).mark
    for tgt in [0.25,0.30]:
        s=df.loc[(df.absd-tgt).abs().groupby(df.date).idxmin()].copy()
        s["lmark"]=[marks.get(k,np.nan) for k in zip(s.date,s.strike-5.0)]
        s=s[s.lmark.notna()]; s["credit"]=s["mark"]-s["lmark"]; s["target"]=tgt
        rows.append(s[["date","expiration","strike","absd","credit","target"]])
pcs=pd.concat(rows,ignore_index=True); pcs=pcs[pcs.credit>0]
pcs=pd.merge_asof(pcs.sort_values("expiration"),und.rename(columns={"date":"expiration","close":"exp_close"}),
                  on="expiration",direction="backward")
pcs["pnl_hold"]=100*(pcs.credit-np.maximum(0,pcs.strike-pcs.exp_close)+np.maximum(0,pcs.strike-5-pcs.exp_close))-6.3

t=pd.read_parquet(f"{BASE}/derived/bt3_trades_spy.parquet")[["date","regime","vrp"]]
gexd=pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date","gex_b"]]
walls=pd.read_parquet(f"{BASE}/derived/spy_walls_daily.parquet")
skew=pd.read_parquet(f"{BASE}/derived/spy_skew25_daily.parquet")
vvix=pd.read_csv(f"{BASE}/vvix_history.csv"); vvix.columns=["date","vvix"]
vvix["date"]=pd.to_datetime(vvix["date"],format="%m/%d/%Y")
daily=skew.sort_values("date").reset_index(drop=True)
daily["skew_roc5"]=daily["skew25"]/daily["skew25"].shift(5)-1
daily=daily.merge(vvix,on="date",how="left"); daily["vvix"]=daily["vvix"].ffill()
def pts(x,w,b): return np.where(x>=b,2,np.where(x>=w,1,0))
daily["tail_out"]=(pts(daily["vvix"],110,130)+pts(daily["skew_roc5"],0.05,0.08))>=2
out=daily["tail_out"].to_numpy().copy(); ti=np.flatnonzero(out)
for a,b in zip(ti[:-1],ti[1:]):
    if 1<b-a<=3: out[a:b]=True
daily["tail_out_sm"]=out
pcs=pcs.merge(t,on="date",how="left").merge(gexd,on="date",how="left")\
       .merge(walls,on="date",how="left").merge(daily[["date","tail_out_sm"]],on="date",how="left")
pcs["tail_out_sm"]=pcs["tail_out_sm"].fillna(False)

obs=pd.read_parquet(f"{BASE}/derived/pop_obs_puts_spy.parquet")
def trailing(cutoff):
    o=obs[obs.expiration<cutoff]
    g=o.groupby("bucket").agg(x=("absd","mean"),y=("itm","mean"),n=("absd","size"))
    g=g[g.n>=50].sort_values("x"); return g["x"].to_numpy(),g["y"].to_numpy()
pcs["p_trail"]=np.nan
for y in range(2018,2026):
    xs,ys=trailing(pd.Timestamp(f"{y}-01-01")); m=pcs.date.dt.year==y
    pcs.loc[m,"p_trail"]=np.interp(pcs.loc[m,"absd"],xs,ys)
pcs["bar"]=pcs.regime.map({"low_vol":1.10,"normal":1.05,"elevated":1.10,"caution":1.20}).fillna(9)
pcs["edge_v0"]=(pcs.credit/5)/pcs.p_trail

for tgt in [0.25,0.30]:
    sub=pcs[pcs.target==tgt].copy()
    gate=(sub.regime!="engine_out")&(sub.vrp>=1.2)&(sub.gex_b>=0)&(sub.strike<=sub.put_wall)&(sub.credit>=0.30)
    print("\n"+"="*78)
    print(f"### target delta {tgt} — edge con tabla TRAILING (sin shrinkage)")
    print(f"factor trailing usado p/delta (por ventana): "
          f"{(sub.groupby(sub.date.dt.year).apply(lambda g:(g.p_trail/g.absd).median())).round(2).to_dict()}")
    for lbl,g2 in [("CON tail_score",gate&~sub.tail_out_sm),("SIN tail_score",gate)]:
        sig=sub[g2&(sub.edge_v0>=sub.bar)]
        yearly=sig.groupby(sig.date.dt.year).pnl_hold.sum().round(0)
        nyr=sig.groupby(sig.date.dt.year).size()
        rej=sub[g2&(sub.edge_v0<sub.bar)]
        print(f"\n  [{lbl}] n={len(sig)} ({len(sig)/8:.1f}/año) win {(sig.pnl_hold>0).mean()*100:.1f}% "
              f"avg ${sig.pnl_hold.mean():.1f} total ${sig.pnl_hold.sum():.0f}")
        print(f"    C2: seleccionadas ${sig.pnl_hold.mean():.1f} vs rechazadas-por-edge ${rej.pnl_hold.mean():.1f} (n={len(rej)})")
        print(f"    por año $: {yearly.to_dict()}")
        print(f"    n por año: {nyr.to_dict()}")
    # sensibilidad de barras (con tail): desplazar +-0.05
    print("  sensibilidad de barras (CON tail):")
    for shift in [-0.05,0.0,0.05]:
        sig=sub[(gate&~sub.tail_out_sm)&(sub.edge_v0>=sub.bar+shift)]
        yearly=sig.groupby(sig.date.dt.year).pnl_hold.sum()
        print(f"    barra{'+' if shift>=0 else ''}{shift:.2f}: n={len(sig):>3} win {(sig.pnl_hold>0).mean()*100:5.1f}% "
              f"total ${sig.pnl_hold.sum():>6.0f} peor-año ${yearly.min():>6.0f} ({int(yearly.idxmin())})")
