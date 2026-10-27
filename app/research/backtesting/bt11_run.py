"""BT-11: motor de estructuras (reglas 1/6/7/8 — sin flow) con config H3, OOS 2018-2025.
Por dia operable: estructura segun structure_selection congelado; legs delta 0.30 espejado,
ancho $5; edge por lado con tabla trailing propia; IC: edge=(credito/5)/(p_put+p_call),
friccion $12.60 (spreads $6.30); gates H3; gestion B path-level sobre credito total.
UNA corrida. Criterios C1-C4 + robustez barras + comparacion vs baseline PCS-only H3+B."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"
COLS = ["date","expiration","strike","type","mark","delta"]
BARS = {"low_vol":1.10,"normal":1.05,"elevated":1.10,"caution":1.20}

def tail_daily():
    skew = pd.read_parquet(f"{BASE}/derived/spy_skew25_daily.parquet")
    vvix = pd.read_csv(f"{BASE}/vvix_history.csv"); vvix.columns=["date","vvix"]
    vvix["date"] = pd.to_datetime(vvix["date"], format="%m/%d/%Y")
    d = skew.sort_values("date").reset_index(drop=True)
    d["skew_roc5"] = d["skew25"]/d["skew25"].shift(5)-1
    d = d.merge(vvix, on="date", how="left"); d["vvix"]=d["vvix"].ffill()
    p = lambda x,w,b: np.where(x>=b,2,np.where(x>=w,1,0))
    d["tail_out"] = (p(d["vvix"],110,130)+p(d["skew_roc5"],0.05,0.08))>=2
    out = d["tail_out"].to_numpy().copy(); ti = np.flatnonzero(out)
    for a,b in zip(ti[:-1],ti[1:]):
        if 1<b-a<=3: out[a:b]=True
    d["tail_out_sm"]=out
    return d[["date","tail_out_sm"]]

def trailing_fn(obs):
    tables={}
    for y in range(2018,2026):
        o=obs[obs.expiration<pd.Timestamp(f"{y}-01-01")]
        g=o.groupby("bucket").agg(x=("absd","mean"),y=("itm","mean"),n=("absd","size"))
        g=g[g.n>=50].sort_values("x")
        tables[y]=(g["x"].to_numpy(),g["y"].to_numpy())
    return tables

def legs_by_delta(sym, opt_type, tgt, sign_long):
    """Por dia: expiracion DTE~45 en [35,50]; short = |delta| mas cercano a tgt;
    long = short + sign_long*5. Devuelve date, expiration, strike, absd, credit."""
    rows=[]
    for y in range(2018,2026):
        df=pd.read_parquet(f"{BASE}/{sym}_options/{sym}_options_{y}.parquet",columns=COLS)
        df=df[df.type==opt_type].copy()
        df["date"]=pd.to_datetime(df["date"]); df["expiration"]=pd.to_datetime(df["expiration"])
        df["dte"]=(df.expiration-df.date).dt.days
        df=df[(df.dte>=35)&(df.dte<=50)&df.mark.notna()&df.delta.notna()]
        df["absd"]=df.delta.abs()
        pick=df.loc[(df.dte-45).abs().groupby(df.date).idxmin(),["date","expiration"]].rename(columns={"expiration":"exp_pick"})
        df=df.merge(pick,on="date"); df=df[df.expiration==df.exp_pick]
        marks=df.set_index(["date","strike"]).mark
        s=df.loc[(df.absd-tgt).abs().groupby(df.date).idxmin()].copy()
        s["lmark"]=[marks.get(k,np.nan) for k in zip(s.date,s.strike+sign_long*5.0)]
        s=s[s.lmark.notna()]; s["credit"]=s["mark"]-s["lmark"]
        rows.append(s[["date","expiration","strike","absd","credit","dte"]])
    r=pd.concat(rows,ignore_index=True)
    return r[r.credit>0]

def run(sym, use_gex):
    und=pd.read_parquet(f"{BASE}/{sym}_options/{sym}_underlying_prices.parquet")[["date","close","dividend_amount"]]
    und["date"]=pd.to_datetime(und["date"]); und=und.sort_values("date")
    last=und.date.max()

    puts=legs_by_delta(sym,"put",0.30,-1).add_prefix("p_").rename(columns={"p_date":"date"})
    calls=legs_by_delta(sym,"call",0.30,+1).add_prefix("c_").rename(columns={"c_date":"date"})
    day=puts.merge(calls,on="date",how="outer")

    env=pd.read_parquet(f"{BASE}/derived/bt3_trades_{sym}.parquet")[["date","regime","vrp"]]
    walls=pd.read_parquet(f"{BASE}/derived/{sym}_walls_daily.parquet")
    si=pd.read_parquet(f"{BASE}/derived/{sym}_structinputs_daily.parquet")[["date","gex_skew","call_wall","zscore","trend"]]
    day=day.merge(env,on="date",how="left").merge(walls,on="date",how="left")\
           .merge(si,on="date",how="left").merge(tail_daily(),on="date",how="left")
    day["tail_out_sm"]=day["tail_out_sm"].fillna(False)
    day=day[day.regime.notna()]
    if use_gex:
        gexd=pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date","gex_b"]]
        day=day.merge(gexd,on="date",how="left")

    # ex-div (solo SPY, block CCS): ex-div dentro de los proximos 3 dias calendario
    exdiv=und[und.dividend_amount>0].date
    def near_exdiv(d): return ((exdiv-d).dt.days.between(0,3)).any()
    if sym=="spy":
        uniq=day.date.drop_duplicates()
        nd={d:near_exdiv(d) for d in uniq}
        day["exdiv_block"]=day.date.map(nd)
    else:
        day["exdiv_block"]=False

    # entorno ARMED
    envok=(day.regime!="engine_out")&(day.vrp>=1.2)&(~day.tail_out_sm)
    if use_gex: envok=envok&(day.gex_b>=0)

    # motor de estructuras (reglas 1/6/7/8, sin flow)
    sk=pd.cut(day.gex_skew,[-.001,0.4,0.6,1.001],labels=["put_dominant","symmetric","call_dominant"])
    z=day.zscore
    day["structure"]=np.select(
        [ (z.abs()<1.0)&(sk=="symmetric"),
          (z>1.5)&(sk=="symmetric")&(day.trend=="up"),
          (z<-1.5)&(sk=="symmetric")&(day.trend=="down") ],
        ["iron_condor","put_credit_spread","call_credit_spread"], default="no_trade")

    # tablas trailing por lado
    tp=trailing_fn(pd.read_parquet(f"{BASE}/derived/pop_obs_puts_{sym}.parquet"))
    tc=trailing_fn(pd.read_parquet(f"{BASE}/derived/pop_obs_calls_{sym}.parquet"))
    day["yr"]=day.date.dt.year
    day["p_put"]=np.nan; day["p_call"]=np.nan
    for y in range(2018,2026):
        m=day.yr==y
        xs,ys=tp[y]; day.loc[m,"p_put"]=np.interp(day.loc[m,"p_absd"],xs,ys)
        xs,ys=tc[y]; day.loc[m,"p_call"]=np.interp(day.loc[m,"c_absd"],xs,ys)
    day["bar"]=day.regime.map(BARS).fillna(9)

    # señales por estructura
    st=day.structure
    put_ok=day.p_strike.notna()&(day.p_strike<=day.put_wall)
    call_ok=day.c_strike.notna()&(day.c_strike>=day.call_wall)
    day["credit_tot"]=np.select(
        [st=="iron_condor", st=="put_credit_spread", st=="call_credit_spread"],
        [day.p_credit.fillna(0)+day.c_credit.fillna(0), day.p_credit, day.c_credit], np.nan)
    day["edge_st"]=np.select(
        [st=="iron_condor", st=="put_credit_spread", st=="call_credit_spread"],
        [(day.credit_tot/5)/(day.p_put+day.p_call), (day.p_credit/5)/day.p_put, (day.c_credit/5)/day.p_call], np.nan)
    struct_ok=np.select(
        [st=="iron_condor", st=="put_credit_spread", st=="call_credit_spread"],
        [put_ok&call_ok, put_ok, call_ok&(~day.exdiv_block)], False).astype(bool)
    sig=day[envok&(st!="no_trade")&struct_ok&(day.credit_tot>=0.30)&(day.edge_st>=day.bar)].copy()
    sig=sig[(sig.p_expiration.fillna(sig.c_expiration)<=last)]

    # pnl hold
    close_map=und.set_index("date").close
    def expclose(exps):
        e=pd.DataFrame({"expiration":exps}).sort_values("expiration")
        e=pd.merge_asof(e,und[["date","close"]].rename(columns={"date":"expiration","close":"ec"}),on="expiration",direction="backward")
        return e.set_index("expiration").ec
    sig["exp"]=sig.p_expiration.fillna(sig.c_expiration)
    ecm=expclose(sig["exp"].drop_duplicates())
    sig["ec"]=sig["exp"].map(ecm)
    put_pay=lambda s: 100*(-np.maximum(0,s.p_strike-s.ec)+np.maximum(0,s.p_strike-5-s.ec))
    call_pay=lambda s: 100*(-np.maximum(0,s.ec-s.c_strike)+np.maximum(0,s.ec-s.c_strike-5))
    fr=np.where(sig.structure=="iron_condor",12.6,6.3)
    sig["pnl_hold"]=100*sig.credit_tot - fr \
        + np.where(sig.structure!="call_credit_spread", put_pay(sig), 0) \
        + np.where(sig.structure!="put_credit_spread", call_pay(sig), 0)

    # gestion B path-level
    need_exp=set(sig["exp"])
    pstr=set(sig.p_strike.dropna()); pstr|= {s-5 for s in pstr}
    cstr=set(sig.c_strike.dropna()); cstr|= {s+5 for s in cstr}
    chunks=[]
    for y in range(2018,2026):
        df=pd.read_parquet(f"{BASE}/{sym}_options/{sym}_options_{y}.parquet",
                           columns=["date","expiration","strike","type","mark"])
        df["expiration"]=pd.to_datetime(df["expiration"])
        df=df[df.expiration.isin(need_exp)&df.mark.notna()]
        df=df[((df.type=="put")&df.strike.isin(pstr))|((df.type=="call")&df.strike.isin(cstr))]
        df["date"]=pd.to_datetime(df["date"])
        chunks.append(df)
    ch=pd.concat(chunks,ignore_index=True).set_index(["type","expiration","strike"]).sort_index()
    def leg(tp,e,k):
        try: return ch.loc[(tp,e,k)].set_index("date").mark
        except KeyError: return None
    out=[]
    for r in sig.itertuples():
        val=None
        if r.structure!="call_credit_spread":
            a=leg("put",r.exp,r.p_strike); b=leg("put",r.exp,r.p_strike-5)
            if a is None or b is None: out.append((np.nan,np.nan,"nopath")); continue
            val=(a-b).dropna()
        if r.structure!="put_credit_spread":
            a=leg("call",r.exp,r.c_strike); b=leg("call",r.exp,r.c_strike+5)
            if a is None or b is None: out.append((np.nan,np.nan,"nopath")); continue
            v2=(a-b).dropna()
            val=v2 if val is None else (val+v2).dropna()
        val=val[(val.index>r.date)&(val.index<=r.exp)].sort_index()
        fr_i=12.6 if r.structure=="iron_condor" else 6.3
        hit=val[val<=0.5*r.credit_tot]
        if len(hit):
            out.append((100*(r.credit_tot-hit.iloc[0])-fr_i,(hit.index[0]-r.date).days,"tp50"))
        else:
            out.append((r.pnl_hold,(r.exp-r.date).days,"hold"))
    sig[["pnl_B","days_B","exit_B"]]=pd.DataFrame(out,index=sig.index)

    # ---------- reporte ----------
    print("\n"+"="*78)
    opdays=day[envok]
    print(f"### {sym.upper()} BT-11 | dias entorno-ARMED OOS: {len(opdays)} | distribucion motor: "
          f"{opdays.structure.value_counts().to_dict()}")
    print(f"señales: {len(sig)} ({len(sig)/8:.1f}/año) | por estructura: {sig.structure.value_counts().to_dict()}")
    ok=sig[sig.exit_B!="nopath"]
    for pol,pnl,dd in [("A hold",ok.pnl_hold,ok.dte if "dte" in ok else None),("B 50%",ok.pnl_B,ok.days_B)]:
        yr=pnl.groupby(ok.date.dt.year).sum()
        print(f"  {pol:8} win {(pnl>0).mean()*100:5.1f}% avg ${pnl.mean():7.1f} total ${pnl.sum():8.0f} "
              f"p5 ${pnl.quantile(0.05):6.0f} min ${pnl.min():6.0f} peor-año ${yr.min():7.0f} ({int(yr.idxmin())})")
    yb=ok.pnl_B.groupby(ok.date.dt.year).sum().round(0)
    print(f"  por año B: {yb.to_dict()}")
    print(f"  por estructura (B): "+" | ".join(
        f"{s}: n={len(g)} win {(g.pnl_B>0).mean()*100:.0f}% avg ${g.pnl_B.mean():.0f}"
        for s,g in ok.groupby("structure")))
    print(f"  C1 B: {'PASA' if ok.pnl_B.mean()>0 and (ok.pnl_B>0).mean()>=0.90 else 'FALLA'} | "
          f"C3 B: peor ${yb.min():.0f} -> {'PASA' if yb.min()>=-700 else 'FALLA'}")
    # C2: señales vs rechazadas-por-edge (mismo motor)
    rej=day[envok&(day.structure!="no_trade")&struct_ok&(day.credit_tot>=0.30)&(day.edge_st<day.bar)]
    rej=rej.merge(sig[["date"]].assign(dummy=1),on="date",how="left")
    # pnl hold de rechazadas: aproximo con formula hold
    print(f"  C2 (hold): sel ${sig.pnl_hold.mean():.1f} vs edge-rechazadas n={len(rej)} (pnl no computado para rechazadas IC/CCS: se reporta solo n)")
    # robustez de barras
    for sh in [-0.05,0.05]:
        s2=day[envok&(st!="no_trade")&struct_ok&(day.credit_tot>=0.30)&(day.edge_st>=day.bar+sh)]
        s2=s2[(s2.p_expiration.fillna(s2.c_expiration)<=last)]
        s2=s2.merge(sig[["date","pnl_B"]],on="date",how="left")
        print(f"  barra{'+' if sh>0 else ''}{sh:.2f}: n={len(s2)} (pnl_B disponible {s2.pnl_B.notna().sum()})")
    # factores C4
    fput={y:round(float(np.interp(0.30,*tp[y])/0.30),3) for y in range(2018,2026)}
    fcall={y:round(float(np.interp(0.30,*tc[y])/0.30),3) for y in range(2018,2026)}
    print(f"  C4 factor put@0.30 por ventana: {fput}")
    print(f"  C4 factor call@0.30 por ventana: {fcall}")
    return sig

for sym,ug in [("spy",True),("qqq",False)]:
    run(sym,ug)
