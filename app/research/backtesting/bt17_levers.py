"""BT-17: descomposicion de clavijas de ocurrencia/renta.
Spec pre-declarada en docs/galecore-research-backtesting.md (2026-07-14).

Clavijas: P1 quitar GEX>=0 | P2 delta 0.30->0.25 | P3 ancho $5->$10.
Variantes: A baseline | B sin GEX | C +delta0.25 | D +ancho10.
Cartera V2 (2 pos escalonadas), gestion B. Una corrida, sin retoques.

Criterios de cola normalizados por riesgo (max loss por variante)."""
import pandas as pd, numpy as np
from bt15_portfolio import BASE, COLS, FRIC, NL0, run_portfolio

def build_signals(tgt_delta, width, use_gex):
    sym="spy"
    und=pd.read_parquet(f"{BASE}/{sym}_options/{sym}_underlying_prices.parquet")[["date","close"]]
    und["date"]=pd.to_datetime(und["date"]); und=und.sort_values("date")
    rows=[]
    for y in range(2018,2026):
        df=pd.read_parquet(f"{BASE}/{sym}_options/{sym}_options_{y}.parquet",columns=COLS)
        df=df[df.type=="put"].copy()
        df["date"]=pd.to_datetime(df["date"]); df["expiration"]=pd.to_datetime(df["expiration"])
        df["dte"]=(df.expiration-df.date).dt.days
        df=df[(df.dte>=35)&(df.dte<=50)&df.mark.notna()&df.delta.notna()]
        df["absd"]=df.delta.abs()
        pick=df.loc[(df.dte-45).abs().groupby(df.date).idxmin(),["date","expiration"]].rename(columns={"expiration":"exp_pick"})
        df=df.merge(pick,on="date"); df=df[df.expiration==df.exp_pick]
        marks=df.set_index(["date","strike"]).mark
        s=df.loc[(df.absd-tgt_delta).abs().groupby(df.date).idxmin()].copy()
        s["lmark"]=[marks.get(k,np.nan) for k in zip(s.date,s.strike-float(width))]
        s=s[s.lmark.notna()]; s["credit"]=s["mark"]-s["lmark"]
        rows.append(s[["date","expiration","strike","absd","credit","dte"]])
    pcs=pd.concat(rows,ignore_index=True); pcs=pcs[pcs.credit>0]
    pcs=pd.merge_asof(pcs.sort_values("expiration"),und.rename(columns={"date":"expiration","close":"exp_close"}),
                      on="expiration",direction="backward")
    pcs["pnl_hold"]=100*(pcs.credit-np.maximum(0,pcs.strike-pcs.exp_close)+np.maximum(0,pcs.strike-width-pcs.exp_close))-FRIC
    env=pd.read_parquet(f"{BASE}/derived/bt3_trades_{sym}.parquet")[["date","regime","vrp"]]
    walls=pd.read_parquet(f"{BASE}/derived/{sym}_walls_daily.parquet")
    skew=pd.read_parquet(f"{BASE}/derived/spy_skew25_daily.parquet")
    vvix=pd.read_csv(f"{BASE}/vvix_history.csv"); vvix.columns=["date","vvix"]
    vvix["date"]=pd.to_datetime(vvix["date"],format="%m/%d/%Y")
    d=skew.sort_values("date").reset_index(drop=True)
    d["skew_roc5"]=d["skew25"]/d["skew25"].shift(5)-1
    d=d.merge(vvix,on="date",how="left"); d["vvix"]=d["vvix"].ffill()
    def pts(x,w,b): return np.where(x>=b,2,np.where(x>=w,1,0))
    d["tail_out"]=(pts(d["vvix"],110,130)+pts(d["skew_roc5"],0.05,0.08))>=2
    out=d["tail_out"].to_numpy().copy(); ti=np.flatnonzero(out)
    for a,b in zip(ti[:-1],ti[1:]):
        if 1<b-a<=3: out[a:b]=True
    d["tail_out_sm"]=out
    pcs=pcs.merge(env,on="date",how="left").merge(walls,on="date",how="left")\
           .merge(d[["date","tail_out_sm"]],on="date",how="left")
    pcs["tail_out_sm"]=pcs["tail_out_sm"].fillna(False)
    pcs=pcs[pcs.regime.notna()]
    obs=pd.read_parquet(f"{BASE}/derived/pop_obs_puts_{sym}.parquet")
    def trailing(cutoff):
        o=obs[obs.expiration<cutoff]
        g=o.groupby("bucket").agg(x=("absd","mean"),y=("itm","mean"),n=("absd","size"))
        g=g[g.n>=50].sort_values("x"); return g["x"].to_numpy(),g["y"].to_numpy()
    pcs["p_trail"]=np.nan
    for y in range(2018,2026):
        xs,ys=trailing(pd.Timestamp(f"{y}-01-01")); m=pcs.date.dt.year==y
        pcs.loc[m,"p_trail"]=np.interp(pcs.loc[m,"absd"],xs,ys)
    pcs["bar"]=pcs.regime.map({"low_vol":1.10,"normal":1.05,"elevated":1.10,"caution":1.20}).fillna(9)
    pcs["edge"]=(pcs.credit/width)/pcs.p_trail
    gexd=pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date","gex_b"]]
    pcs=pcs.merge(gexd,on="date",how="left")
    gate=(pcs.regime!="engine_out")&(pcs.vrp>=1.2)&(pcs.strike<=pcs.put_wall)&(pcs.credit>=0.30)&(~pcs.tail_out_sm)&(pcs.edge>=pcs.bar)
    if use_gex:
        gate=gate&(pcs.gex_b>=0)
    sig=pcs[gate].copy()
    last=und.date.max()
    sig=sig[sig.expiration<=last]
    return sig.sort_values("date").reset_index(drop=True), und

def spread_paths_w(sig, width):
    need_exp=set(sig.expiration)
    strikes=set(sig.strike)|set(sig.strike-float(width))
    chunks=[]
    for y in range(2018,2026):
        df=pd.read_parquet(f"{BASE}/spy_options/spy_options_{y}.parquet",
                           columns=["date","expiration","strike","type","mark"])
        df=df[df.type=="put"].copy()
        df["expiration"]=pd.to_datetime(df["expiration"])
        df=df[df.expiration.isin(need_exp)&df.strike.isin(strikes)&df.mark.notna()]
        df["date"]=pd.to_datetime(df["date"])
        chunks.append(df[["date","expiration","strike","mark"]])
    ch=pd.concat(chunks,ignore_index=True).set_index(["expiration","strike"]).sort_index()
    paths={}
    for key in sig[["expiration","strike"]].drop_duplicates().itertuples(index=False):
        try:
            sh=ch.loc[(key.expiration,key.strike)].set_index("date").mark
            lo=ch.loc[(key.expiration,key.strike-float(width))].set_index("date").mark
        except KeyError:
            continue
        paths[(key.expiration,key.strike)]=(sh-lo).dropna().sort_index()
    return paths

VARIANTS=[
    ("A baseline (d0.30 $5 +GEX)", 0.30, 5, True,  500),
    ("B sin GEX     (d0.30 $5)",   0.30, 5, False, 500),
    ("C +delta      (d0.25 $5)",   0.25, 5, False, 500),
    ("D +ancho      (d0.25 $10)",  0.25,10, False,1000),
]

if __name__=="__main__":
    results={}
    for name,tgt,width,use_gex,coll in VARIANTS:
        sig,und=build_signals(tgt,width,use_gex)
        paths=spread_paths_w(sig,width)
        # parche: run_portfolio usa hardcode strike-5.0 y COLLATERAL=500; reimplemento inline el ancho
        import bt15_portfolio as bt15
        bt15.COLLATERAL=coll
        # run_portfolio referencia strike-5.0 solo en spread_paths (ya pasamos paths); el sim usa p['path']
        r=run_portfolio(sig,und,paths,2,name)
        maxloss=width*100-  (sig.credit.median()*100) + FRIC
        r["maxloss"]=width*100  # cota superior de max loss por trade
        r["nsig"]=len(sig)
        results[name]=r
    print("\n"+"="*78)
    print("### RESUMEN NORMALIZADO POR RIESGO")
    print(f"{'variante':30}{'señ':>5}{'trades/a':>9}{'total$':>9}{'peor año':>10}{'/maxloss':>10}")
    A=results[VARIANTS[0][0]]
    for name,tgt,width,use_gex,coll in VARIANTS:
        r=results[name]
        norm=r["total"]/ (width*100/500)   # normaliza a riesgo de ancho $5
        print(f"{name:30}{r['nsig']:>5}{r['n_yr']:>9.1f}{r['total']:>9.0f}{r['worst_year']:>10.0f}{norm:>10.0f}")
    print("\n### CRITERIOS")
    C=results[VARIANTS[2][0]]; D=results[VARIANTS[3][0]]; B=results[VARIANTS[1][0]]
    c1=all(results[n[0]]["win"]>=0.90 and results[n[0]]["worst_year"]>=-(n[2]*100*1.5*0.93) for n in VARIANTS)
    c2=A["n_yr"]<=B["n_yr"]<=C["n_yr"]
    c3=D["total"]>A["total"]
    print(f"C1 (todas win>=90% y ningun año < -1.5 maxloss): {'PASA' if c1 else 'FALLA'}")
    print(f"C2 (trades/año sube A->B->C): {'PASA' if c2 else 'FALLA'} ({A['n_yr']:.1f}->{B['n_yr']:.1f}->{C['n_yr']:.1f})")
    print(f"C3 (D supera total de A): {'PASA' if c3 else 'FALLA'} (${D['total']:.0f} vs ${A['total']:.0f})")
