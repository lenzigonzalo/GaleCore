"""BT-10c — H3 delta 0.30 sobre QQQ OOS 2018-2025. UNA corrida, spec pre-declarada.
Pipeline: PCS delta~0.30 ancho $5 DTE~45; edge trailing sin shrinkage (obs QQQ, anti-lookahead);
gates: regimen operable, VRP>=1.2, muro, credit>=0.30, tail_score de mercado (SPY); SIN GEX.
Criterios: C1 avg>0 & win>=90 | C2 sel>rech | C3 sin anio < -700 | C4 saltos factor <=0.15 |
robustez barras +-0.05 sobre C3."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
COLS = ["date","expiration","strike","type","mark","delta"]
TGT = 0.30

und = pd.read_parquet(f"{BASE}/qqq_options/qqq_underlying_prices.parquet")[["date","close"]]
und["date"]=pd.to_datetime(und["date"]); und=und.sort_values("date")

rows=[]
for y in range(2018,2026):
    df=pd.read_parquet(f"{BASE}/qqq_options/qqq_options_{y}.parquet",columns=COLS)
    df=df[df.type=="put"].copy()
    df["date"]=pd.to_datetime(df["date"]); df["expiration"]=pd.to_datetime(df["expiration"])
    df["dte"]=(df.expiration-df.date).dt.days
    df=df[(df.dte>=35)&(df.dte<=50)&df.mark.notna()&df.delta.notna()]
    df["absd"]=df.delta.abs()
    pick=df.loc[(df.dte-45).abs().groupby(df.date).idxmin(),["date","expiration"]].rename(columns={"expiration":"exp_pick"})
    df=df.merge(pick,on="date"); df=df[df.expiration==df.exp_pick]
    marks=df.set_index(["date","strike"]).mark
    s=df.loc[(df.absd-TGT).abs().groupby(df.date).idxmin()].copy()
    s["lmark"]=[marks.get(k,np.nan) for k in zip(s.date,s.strike-5.0)]
    s=s[s.lmark.notna()]; s["credit"]=s["mark"]-s["lmark"]
    rows.append(s[["date","expiration","strike","absd","credit"]])
pcs=pd.concat(rows,ignore_index=True); pcs=pcs[pcs.credit>0]
pcs=pd.merge_asof(pcs.sort_values("expiration"),und.rename(columns={"date":"expiration","close":"exp_close"}),
                  on="expiration",direction="backward")
pcs["pnl_hold"]=100*(pcs.credit-np.maximum(0,pcs.strike-pcs.exp_close)+np.maximum(0,pcs.strike-5-pcs.exp_close))-6.3

# entorno QQQ (regimen/vrp) + muro QQQ + tail de mercado (SPY)
env=pd.read_parquet(f"{BASE}/derived/bt3_trades_qqq.parquet")[["date","regime","vrp"]]
walls=pd.read_parquet(f"{BASE}/derived/qqq_walls_daily.parquet")
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
pcs=pcs.merge(env,on="date",how="left").merge(walls,on="date",how="left")\
       .merge(daily[["date","tail_out_sm"]],on="date",how="left")
pcs["tail_out_sm"]=pcs["tail_out_sm"].fillna(False)
pcs=pcs[pcs.regime.notna()]

obs=pd.read_parquet(f"{BASE}/derived/pop_obs_puts_qqq.parquet")
def trailing(cutoff):
    o=obs[obs.expiration<cutoff]
    g=o.groupby("bucket").agg(x=("absd","mean"),y=("itm","mean"),n=("absd","size"))
    g=g[g.n>=50].sort_values("x"); return g["x"].to_numpy(),g["y"].to_numpy()
pcs["p_trail"]=np.nan
for y in range(2018,2026):
    xs,ys=trailing(pd.Timestamp(f"{y}-01-01")); m=pcs.date.dt.year==y
    pcs.loc[m,"p_trail"]=np.interp(pcs.loc[m,"absd"],xs,ys)
pcs["bar"]=pcs.regime.map({"low_vol":1.10,"normal":1.05,"elevated":1.10,"caution":1.20}).fillna(9)
pcs["edge"]=(pcs.credit/5)/pcs.p_trail
gate=(pcs.regime!="engine_out")&(pcs.vrp>=1.2)&(pcs.strike<=pcs.put_wall)&(pcs.credit>=0.30)&(~pcs.tail_out_sm)

op=pcs[gate]
sig=op[op.edge>=op.bar]; rej=op[op.edge<op.bar]
yearly=sig.groupby(sig.date.dt.year).pnl_hold.sum().round(0)
nyr=sig.groupby(sig.date.dt.year).size()
print(f"QQQ delta 0.30 OOS 2018-2025 | dias candidato {len(pcs)} | operables {len(op)} | credit mediana op ${op.credit.median():.2f}")
print(f"\nSEÑALES: n={len(sig)} ({len(sig)/8:.1f}/año) win {(sig.pnl_hold>0).mean()*100:.1f}% avg ${sig.pnl_hold.mean():.1f} total ${sig.pnl_hold.sum():.0f}")
print(f"por año $: {yearly.to_dict()}")
print(f"n por año: {nyr.to_dict()}")
print(f"\nC1 (avg>0 y win>=90): avg ${sig.pnl_hold.mean():.2f}, win {(sig.pnl_hold>0).mean()*100:.1f}% -> {'PASA' if sig.pnl_hold.mean()>0 and (sig.pnl_hold>0).mean()>=0.90 else 'FALLA'}")
print(f"C2 (sel>rech): ${sig.pnl_hold.mean():.1f} vs ${rej.pnl_hold.mean():.1f} (n rech={len(rej)}) -> {'PASA' if sig.pnl_hold.mean()>rej.pnl_hold.mean() else 'FALLA'}")
print(f"C3 (sin año < -700): peor ${yearly.min():.0f} ({int(yearly.idxmin())}) -> {'PASA' if yearly.min()>=-700 else 'FALLA'}")
fac=op.groupby(op.date.dt.year).apply(lambda g:(g.p_trail/g.absd).median()).round(3)
jumps=fac.diff().abs().dropna()
print(f"C4 (saltos factor <=0.15): factores {fac.to_dict()}")
print(f"   salto max {jumps.max():.3f} -> {'PASA' if jumps.max()<=0.15 else 'FALLA (condiciona, no invalida)'}")
print("\nRobustez barras (C3):")
for sh in [-0.05,0.0,0.05]:
    s2=op[op.edge>=op.bar+sh]; y2=s2.groupby(s2.date.dt.year).pnl_hold.sum()
    print(f"  barra{'+' if sh>=0 else ''}{sh:.2f}: n={len(s2):>3} win {(s2.pnl_hold>0).mean()*100:5.1f}% total ${s2.pnl_hold.sum():>6.0f} peor-año ${y2.min():>6.0f} ({int(y2.idxmin())}) -> C3 {'PASA' if y2.min()>=-700 else 'FALLA'}")
