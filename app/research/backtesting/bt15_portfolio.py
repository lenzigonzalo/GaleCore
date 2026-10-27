"""BT-15: cartera secuencial SPY-only de la config de referencia (H3+B).
Spec pre-declarada en docs/galecore-research-backtesting.md (2026-07-14).

V1 = max 1 posicion. V2 = max 2 posiciones con vencimientos distintos.
Senales identicas a bt10_mgmtB.py (delta 0.30, trailing anti-lookahead, tail_score,
GEX>=0, VRP>=1.2, muro, credito>=0.30, barras 1.05/1.10/1.20). Gestion B (cierre 50%).
Friccion $6.30. Base $10k, 1 contrato. Cash ocioso a T-bill 3m real (reportado aparte).
Una corrida, sin retoques."""
import pandas as pd, numpy as np

BASE = "C:/Users/lenzi/OneDrive/Escritorio/GaleCore/GaleCore/research/data"
COLS = ["date","expiration","strike","type","mark","delta"]
TGT = 0.30
FRIC = 6.30
NL0 = 10000.0
COLLATERAL = 500.0

# ---------- senales (identico a bt10_mgmtB, SPY con GEX) ----------
def build_signals():
    sym = "spy"
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
    pcs["pnl_hold"]=100*(pcs.credit-np.maximum(0,pcs.strike-pcs.exp_close)+np.maximum(0,pcs.strike-5-pcs.exp_close))-FRIC
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
    gexd=pd.read_parquet(f"{BASE}/derived/spy_gex_daily.parquet")[["date","gex_b"]]
    pcs=pcs.merge(gexd,on="date",how="left")
    gate=(pcs.regime!="engine_out")&(pcs.vrp>=1.2)&(pcs.strike<=pcs.put_wall)&(pcs.credit>=0.30)&(~pcs.tail_out_sm)&(pcs.gex_b>=0)
    sig=pcs[gate&(pcs.edge>=pcs.bar)].copy()
    last=und.date.max()
    sig=sig[sig.expiration<=last]
    return sig.sort_values("date").reset_index(drop=True), und

# ---------- series diarias de valor del spread por senal ----------
def spread_paths(sig):
    need_exp=set(sig.expiration)
    strikes=set(sig.strike)|set(sig.strike-5.0)
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
            lo=ch.loc[(key.expiration,key.strike-5.0)].set_index("date").mark
        except KeyError:
            continue
        paths[(key.expiration,key.strike)]=(sh-lo).dropna().sort_index()
    return paths

# ---------- simulador secuencial ----------
def run_portfolio(sig, und, paths, max_pos, name):
    days=und[(und.date>=pd.Timestamp("2018-01-01"))].date.sort_values().tolist()
    sig_by_day={d:g for d,g in sig.groupby("date")}
    tb=pd.read_csv(f"{BASE}/tbill_3m_monthly.csv",parse_dates=["date"]).set_index("date")["tbill_3m"]

    open_pos=[]   # dicts: entry,exp,strike,credit,path,last_val
    trades=[]     # realized
    entries=[]    # entry dates
    realized=0.0
    cash_int=0.0
    eq_curve=[]   # (date, equity MTM estrategia)
    days_in_pos=0; days_two=0
    worst_joint_day=(0.0,None)
    prev_mtm=None

    for day in days:
        # --- exits primero ---
        still=[]
        for p in open_pos:
            path=p["path"]; closed=False
            if day in path.index and day>p["entry"]:
                v=path.loc[day]
                p["last_val"]=v
                if v<=0.5*p["credit"]:
                    pnl=100*(p["credit"]-v)-FRIC
                    trades.append({"entry":p["entry"],"exit":day,"pnl":pnl,"days":(day-p["entry"]).days,"how":"tp50"})
                    realized+=pnl; closed=True
            if not closed and day>=p["exp"]:
                pnl=p["pnl_hold"]
                trades.append({"entry":p["entry"],"exit":day,"pnl":pnl,"days":(p["exp"]-p["entry"]).days,"how":"hold"})
                realized+=pnl; closed=True
            if not closed: still.append(p)
        open_pos=still
        # --- entries ---
        if day in sig_by_day and len(open_pos)<max_pos:
            for r in sig_by_day[day].itertuples():
                if len(open_pos)>=max_pos: break
                if any(p["exp"]==r.expiration for p in open_pos): continue  # vencimiento distinto
                key=(r.expiration,r.strike)
                if key not in paths: continue
                open_pos.append({"entry":day,"exp":r.expiration,"strike":r.strike,
                                 "credit":r.credit,"pnl_hold":r.pnl_hold,
                                 "path":paths[key],"last_val":r.credit})
                entries.append(day)
        # --- MTM + interes ---
        mtm=realized+sum(100*(p["credit"]-p["last_val"]) for p in open_pos)
        if open_pos: days_in_pos+=1
        if len(open_pos)>=2:
            days_two+=1
            if prev_mtm is not None and (mtm-prev_mtm)<worst_joint_day[0]:
                worst_joint_day=(mtm-prev_mtm,day)
        rate=tb.asof(day)
        if pd.notna(rate):
            cash_int+=(NL0+realized-COLLATERAL*len(open_pos))*(rate/100)/252
        eq_curve.append((day,mtm))
        prev_mtm=mtm

    tr=pd.DataFrame(trades)
    eq=pd.DataFrame(eq_curve,columns=["date","mtm"]).set_index("date")
    years=(days[-1]-days[0]).days/365.25
    pnl=tr.pnl
    peak=eq.mtm.cummax(); dd=(eq.mtm-peak); maxdd=dd.min()
    ent=pd.Series(entries)
    waits=ent.diff().dt.days.dropna()
    ya=tr.groupby(tr.exit.dt.year).pnl.sum().round(0)
    # peor racha de perdidas consecutivas
    streak=best=0
    for x in tr.sort_values("exit").pnl:
        streak=streak+1 if x<0 else 0
        best=max(best,streak)

    print("\n"+"="*78)
    print(f"### BT-15 {name} — max {max_pos} posicion(es), SPY-only, H3+B, 2018–2025")
    print(f"trades: {len(tr)} en {years:.1f} anos = {len(tr)/years:.1f}/ano | win {(pnl>0).mean()*100:.1f}% | avg ${pnl.mean():.1f} | total ${pnl.sum():.0f}")
    print(f"peor trade ${pnl.min():.0f} | peor racha {best} | tp50 {(tr.how=='tp50').mean()*100:.0f}%")
    print(f"por ano: {ya.to_dict()}")
    print(f"peor ano: ${ya.min():.0f} ({int(ya.idxmin())}) | maxDD equity MTM: ${maxdd:.0f} ({maxdd/NL0*100:.1f}% de $10k)")
    print(f"espera entre entradas (dias): mediana {waits.median():.0f} | p90 {waits.quantile(0.9):.0f} | max {waits.max():.0f}")
    print(f"ocupacion: en posicion {days_in_pos/len(days)*100:.0f}% de los dias | dias con 2 posiciones: {days_two}")
    if max_pos>=2 and worst_joint_day[1] is not None:
        print(f"peor dia MTM con 2 posiciones: ${worst_joint_day[0]:.0f} ({worst_joint_day[1].date()})")
    ret_strat=pnl.sum()/years/NL0*100
    ret_cash=cash_int/years/NL0*100
    print(f"retorno anual sobre $10k: estrategia {ret_strat:.2f}% | cash T-bill {ret_cash:.2f}% | TOTAL {ret_strat+ret_cash:.2f}%")
    return {"tr":tr,"ya":ya,"maxdd":maxdd,"total":pnl.sum(),"n_yr":len(tr)/years,
            "win":(pnl>0).mean(),"worst_year":ya.min(),"ret_total":ret_strat+ret_cash}

if __name__=="__main__":
    sig,und=build_signals()
    print(f"senales gated OOS SPY: {len(sig)} ({len(sig)/8:.1f}/ano a nivel senal-dia)")
    paths=spread_paths(sig)
    v1=run_portfolio(sig,und,paths,1,"V1 baseline")
    v2=run_portfolio(sig,und,paths,2,"V2 escalonada")
    print("\n"+"="*78)
    print("### CRITERIOS PRE-DECLARADOS")
    c1=v1["win"]>=0.90 and v1["worst_year"]>=-700
    c2=v2["n_yr"]>v1["n_yr"] and v2["total"]>v1["total"]
    c3=(v2["worst_year"]>=v1["worst_year"]-450) and (v2["maxdd"]>=v1["maxdd"]-450)
    print(f"C1 (V1 win>=90% y ningun ano < -$700): {'PASA' if c1 else 'FALLA'}")
    print(f"C2 (V2 sube trades/ano y total): {'PASA' if c2 else 'FALLA'}")
    print(f"C3 (V2 no empeora cola > $450): {'PASA' if c3 else 'FALLA'}")
