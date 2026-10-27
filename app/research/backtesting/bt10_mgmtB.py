"""(a) H3 delta-0.30 con gestion B (cierre al 50% del credito, sin salida por DTE),
path-level (MTM diario EOD), sobre las señales gated OOS 2018-2025. QQQ y SPY.
Politica identica a BT-4: si el spread cotiza <= 50% del credito -> cierre ese dia
al valor observado; si nunca, hold a vencimiento. Friccion $6.30 (igual que hold;
BT-4 ya noto que hold worthless paga menos cierre -> A levemente subestimada)."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
COLS = ["date","expiration","strike","type","mark","delta"]
TGT = 0.30

def build_signals(sym, use_gex):
    und = pd.read_parquet(f"{BASE}/{sym}_options/{sym}_underlying_prices.parquet")[["date","close"]]
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
        s=df.loc[(df.absd-TGT).abs().groupby(df.date).idxmin()].copy()
        s["lmark"]=[marks.get(k,np.nan) for k in zip(s.date,s.strike-5.0)]
        s=s[s.lmark.notna()]; s["credit"]=s["mark"]-s["lmark"]
        rows.append(s[["date","expiration","strike","absd","credit","dte"]])
    pcs=pd.concat(rows,ignore_index=True); pcs=pcs[pcs.credit>0]
    pcs=pd.merge_asof(pcs.sort_values("expiration"),und.rename(columns={"date":"expiration","close":"exp_close"}),
                      on="expiration",direction="backward")
    pcs["pnl_hold"]=100*(pcs.credit-np.maximum(0,pcs.strike-pcs.exp_close)+np.maximum(0,pcs.strike-5-pcs.exp_close))-6.3
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
    pcs["edge"]=(pcs.credit/5)/pcs.p_trail
    if use_gex:
        gexd=pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date","gex_b"]]
        pcs=pcs.merge(gexd,on="date",how="left")
    gate=(pcs.regime!="engine_out")&(pcs.vrp>=1.2)&(pcs.strike<=pcs.put_wall)&(pcs.credit>=0.30)&(~pcs.tail_out_sm)
    if use_gex:
        gate=gate&(pcs.gex_b>=0)
    sig=pcs[gate&(pcs.edge>=pcs.bar)].copy()
    # truncar señales cuyo vencimiento excede los datos
    last=und.date.max()
    trunc=(sig.expiration>last).sum()
    sig=sig[sig.expiration<=last]
    return sig, trunc

def path_close50(sym, sig):
    need_exp=set(sig.expiration)
    strikes=set(sig.strike)|set(sig.strike-5.0)
    chunks=[]
    for y in range(2018,2026):
        df=pd.read_parquet(f"{BASE}/{sym}_options/{sym}_options_{y}.parquet",
                           columns=["date","expiration","strike","type","mark"])
        df=df[df.type=="put"].copy()
        df["expiration"]=pd.to_datetime(df["expiration"])
        df=df[df.expiration.isin(need_exp)&df.strike.isin(strikes)&df.mark.notna()]
        df["date"]=pd.to_datetime(df["date"])
        chunks.append(df[["date","expiration","strike","mark"]])
    ch=pd.concat(chunks,ignore_index=True)
    ch=ch.set_index(["expiration","strike"]).sort_index()
    out=[]
    for r in sig.itertuples():
        try:
            sh=ch.loc[(r.expiration,r.strike)].set_index("date").mark
            lo=ch.loc[(r.expiration,r.strike-5.0)].set_index("date").mark
        except KeyError:
            out.append((np.nan,np.nan,"nopath")); continue
        val=(sh-lo).dropna()
        val=val[(val.index>r.date)&(val.index<=r.expiration)].sort_index()
        thr=0.5*r.credit
        hit=val[val<=thr]
        if len(hit):
            d0=hit.index[0]
            pnl=100*(r.credit-hit.iloc[0])-6.3
            out.append((pnl,(d0-r.date).days,"tp50"))
        else:
            out.append((r.pnl_hold,(r.expiration-r.date).days,"hold"))
    sig=sig.copy()
    sig[["pnl_B","days_B","exit_B"]]=pd.DataFrame(out,index=sig.index)
    return sig

for sym,use_gex in [("qqq",False),("spy",True)]:
    sig,trunc=build_signals(sym,use_gex)
    sig=path_close50(sym,sig)
    ok=sig[sig.exit_B!="nopath"]
    print("\n"+"="*74)
    print(f"### {sym.upper()} H3 delta-0.30 — señales gated OOS: {len(sig)} (truncadas por fin de datos: {trunc}, sin path: {(sig.exit_B=='nopath').sum()})")
    A=ok.pnl_hold; B=ok.pnl_B
    dA=ok.dte; dB=ok.days_B
    print(f"{'':14}{'win%':>7}{'avg$':>8}{'total$':>9}{'p5$':>8}{'min$':>8}{'dias':>6}{'$/dia':>7}")
    print(f"{'A hold':14}{(A>0).mean()*100:>7.1f}{A.mean():>8.1f}{A.sum():>9.0f}{A.quantile(0.05):>8.0f}{A.min():>8.0f}{dA.mean():>6.1f}{A.sum()/dA.sum():>7.2f}")
    print(f"{'B cierre 50%':14}{(B>0).mean()*100:>7.1f}{B.mean():>8.1f}{B.sum():>9.0f}{B.quantile(0.05):>8.0f}{B.min():>8.0f}{dB.mean():>6.1f}{B.sum()/dB.sum():>7.2f}")
    print(f"  B: cerro en tp50 el {(ok.exit_B=='tp50').mean()*100:.1f}% de las señales")
    ya=ok.groupby(ok.date.dt.year).pnl_hold.sum().round(0)
    yb=ok.groupby(ok.date.dt.year).pnl_B.sum().round(0)
    print(f"  por año A: {ya.to_dict()}")
    print(f"  por año B: {yb.to_dict()}")
    print(f"  C3 bajo B (sin año < -700): peor ${yb.min():.0f} ({int(yb.idxmin())}) -> {'PASA' if yb.min()>=-700 else 'FALLA'}")
    print(f"  C1 bajo B: avg ${B.mean():.2f}, win {(B>0).mean()*100:.1f}% -> {'PASA' if B.mean()>0 and (B>0).mean()>=0.90 else 'FALLA'}")
