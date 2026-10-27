"""BT-12: robustez/monotonia del delta. Grilla 0.15-0.35, pipeline H3+B identico,
SPY+QQQ OOS 2018-2025. UNA corrida. La config queda en 0.30 sea cual sea el resultado."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
COLS = ["date","expiration","strike","type","mark","delta"]
TARGETS = [0.15, 0.20, 0.25, 0.28, 0.30, 0.32, 0.35]
BARS = {"low_vol":1.10,"normal":1.05,"elevated":1.10,"caution":1.20}

def tail_daily():
    skew=pd.read_parquet(f"{BASE}/derived/spy_skew25_daily.parquet")
    vvix=pd.read_csv(f"{BASE}/vvix_history.csv"); vvix.columns=["date","vvix"]
    vvix["date"]=pd.to_datetime(vvix["date"],format="%m/%d/%Y")
    d=skew.sort_values("date").reset_index(drop=True)
    d["skew_roc5"]=d["skew25"]/d["skew25"].shift(5)-1
    d=d.merge(vvix,on="date",how="left"); d["vvix"]=d["vvix"].ffill()
    p=lambda x,w,b: np.where(x>=b,2,np.where(x>=w,1,0))
    d["tail_out"]=(p(d["vvix"],110,130)+p(d["skew_roc5"],0.05,0.08))>=2
    out=d["tail_out"].to_numpy().copy(); ti=np.flatnonzero(out)
    for a,b in zip(ti[:-1],ti[1:]):
        if 1<b-a<=3: out[a:b]=True
    d["tail_out_sm"]=out
    return d[["date","tail_out_sm"]]
TAIL=tail_daily()

def run(sym, use_gex):
    und=pd.read_parquet(f"{BASE}/{sym}_options/{sym}_underlying_prices.parquet")[["date","close"]]
    und["date"]=pd.to_datetime(und["date"]); und=und.sort_values("date")
    last=und.date.max()
    # candidatos: una pasada por anio, todos los targets
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
        for tgt in TARGETS:
            s=df.loc[(df.absd-tgt).abs().groupby(df.date).idxmin()].copy()
            s["lmark"]=[marks.get(k,np.nan) for k in zip(s.date,s.strike-5.0)]
            s=s[s.lmark.notna()]; s["credit"]=s["mark"]-s["lmark"]; s["target"]=tgt
            rows.append(s[["date","expiration","strike","absd","credit","dte","target"]])
        del df,marks
    pcs=pd.concat(rows,ignore_index=True); pcs=pcs[pcs.credit>0]
    pcs=pd.merge_asof(pcs.sort_values("expiration"),und.rename(columns={"date":"expiration","close":"exp_close"}),
                      on="expiration",direction="backward")
    pcs["pnl_hold"]=100*(pcs.credit-np.maximum(0,pcs.strike-pcs.exp_close)+np.maximum(0,pcs.strike-5-pcs.exp_close))-6.3
    env=pd.read_parquet(f"{BASE}/derived/bt3_trades_{sym}.parquet")[["date","regime","vrp"]]
    walls=pd.read_parquet(f"{BASE}/derived/{sym}_walls_daily.parquet")
    pcs=pcs.merge(env,on="date",how="left").merge(walls,on="date",how="left").merge(TAIL,on="date",how="left")
    pcs["tail_out_sm"]=pcs["tail_out_sm"].fillna(False)
    pcs=pcs[pcs.regime.notna()]
    if use_gex:
        gexd=pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date","gex_b"]]
        pcs=pcs.merge(gexd,on="date",how="left")
    obs=pd.read_parquet(f"{BASE}/derived/pop_obs_puts_{sym}.parquet")
    def trailing(cutoff):
        o=obs[obs.expiration<cutoff]
        g=o.groupby("bucket").agg(x=("absd","mean"),y=("itm","mean"),n=("absd","size"))
        g=g[g.n>=50].sort_values("x"); return g["x"].to_numpy(),g["y"].to_numpy()
    pcs["p_trail"]=np.nan
    for y in range(2018,2026):
        xs,ys=trailing(pd.Timestamp(f"{y}-01-01")); m=pcs.date.dt.year==y
        pcs.loc[m,"p_trail"]=np.interp(pcs.loc[m,"absd"],xs,ys)
    pcs["bar"]=pcs.regime.map(BARS).fillna(9)
    pcs["edge"]=(pcs.credit/5)/pcs.p_trail
    gate=(pcs.regime!="engine_out")&(pcs.vrp>=1.2)&(pcs.strike<=pcs.put_wall)&(pcs.credit>=0.30)&(~pcs.tail_out_sm)
    if use_gex: gate=gate&(pcs.gex_b>=0)
    sig=pcs[gate&(pcs.edge>=pcs.bar)&(pcs.expiration<=last)].copy()

    # paths: una sola carga para todos los targets
    need_exp=set(sig.expiration)
    strikes=set(sig.strike)|{s-5 for s in set(sig.strike)}
    chunks=[]
    for y in range(2018,2026):
        df=pd.read_parquet(f"{BASE}/{sym}_options/{sym}_options_{y}.parquet",
                           columns=["date","expiration","strike","type","mark"])
        df=df[df.type=="put"].copy()
        df["expiration"]=pd.to_datetime(df["expiration"])
        df=df[df.expiration.isin(need_exp)&df.strike.isin(strikes)&df.mark.notna()]
        df["date"]=pd.to_datetime(df["date"])
        chunks.append(df[["date","expiration","strike","mark"]])
    ch=pd.concat(chunks,ignore_index=True).set_index(["expiration","strike"]).sort_index()
    out=[]
    for r in sig.itertuples():
        try:
            a=ch.loc[(r.expiration,r.strike)].set_index("date").mark
            b=ch.loc[(r.expiration,r.strike-5.0)].set_index("date").mark
        except KeyError:
            out.append((np.nan,np.nan)); continue
        val=(a-b).dropna()
        val=val[(val.index>r.date)&(val.index<=r.expiration)].sort_index()
        hit=val[val<=0.5*r.credit]
        if len(hit): out.append((100*(r.credit-hit.iloc[0])-6.3,(hit.index[0]-r.date).days))
        else: out.append((r.pnl_hold,(r.expiration-r.date).days))
    sig[["pnl_B","days_B"]]=pd.DataFrame(out,index=sig.index)
    sig=sig[sig.pnl_B.notna()]

    print("\n"+"="*100)
    print(f"### {sym.upper()} BT-12 — grilla de deltas (gestion B, OOS 2018-2025)")
    print(f"{'tgt':>5}{'n':>5}{'n/año':>7}{'credit':>8}{'factor':>8}{'winB%':>7}{'avgB$':>8}{'totB$':>8}{'p5B$':>7}{'peorAñoB$':>11}{'C1':>4}{'C3':>4}{'winH%':>7}{'totH$':>8}{'peorAñoH$':>11}")
    for tgt in TARGETS:
        s=sig[sig.target==tgt]
        if len(s)==0:
            print(f"{tgt:>5}{0:>5}"); continue
        yb=s.groupby(s.date.dt.year).pnl_B.sum(); yh=s.groupby(s.date.dt.year).pnl_hold.sum()
        c1="OK" if s.pnl_B.mean()>0 and (s.pnl_B>0).mean()>=0.90 else "X"
        c3="OK" if yb.min()>=-700 else "X"
        fac=(s.p_trail/s.absd).median()
        print(f"{tgt:>5}{len(s):>5}{len(s)/8:>7.1f}{s.credit.median():>8.2f}{fac:>8.2f}"
              f"{(s.pnl_B>0).mean()*100:>7.1f}{s.pnl_B.mean():>8.1f}{s.pnl_B.sum():>8.0f}{s.pnl_B.quantile(0.05):>7.0f}"
              f"{yb.min():>11.0f}{c1:>4}{c3:>4}{(s.pnl_hold>0).mean()*100:>7.1f}{s.pnl_hold.sum():>8.0f}{yh.min():>11.0f}")
    # detalle anual B de la meseta
    for tgt in [0.28,0.30,0.32]:
        s=sig[sig.target==tgt]
        print(f"  {tgt} por año B: {s.groupby(s.date.dt.year).pnl_B.sum().round(0).to_dict()}")

for sym,ug in [("spy",True),("qqq",False)]:
    run(sym,ug)
