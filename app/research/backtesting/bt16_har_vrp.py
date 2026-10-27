"""BT-16: denominador del VRP: RV30 trailing -> pronostico HAR-RV (Corsi log-log).
Spec pre-declarada en docs/galecore-research-backtesting.md (2026-07-14).

HAR: log(RV_fwd30) ~ log(pk_d)+log(pk_w)+log(pk_m), Parkinson OHLC, fit expansivo
desde 2001, refit anual, anti-lookahead (target completado antes del 1-ene-Y),
smearing exp(pred+s^2/2). Gate: vrp_har = atm_iv*100/har_fcst >= 1.2 (congelado).
Todo lo demas identico a BT-15. Una corrida, sin retoques."""
import pandas as pd, numpy as np
from bt15_portfolio import BASE, COLS, TGT, FRIC, spread_paths, run_portfolio

# ---------- HAR-RV walk-forward ----------
def har_forecast():
    u = pd.read_parquet(f"{BASE}/spy_options/spy_underlying_prices.parquet")[["date","open","high","low","close"]]
    u["date"]=pd.to_datetime(u["date"]); u=u.sort_values("date").reset_index(drop=True)
    u["ret"]=np.log(u.close/u.close.shift(1))
    # target: mismo objeto que rv30 (std c2c 30d habiles adelante, anualizada, %)
    u["rv_fwd30"]=u.ret.rolling(30).std().shift(-30)*np.sqrt(252)*100
    u["fwd_known"]=u.date.shift(-30)          # fecha en que el target queda observado
    # features Parkinson (varianza diaria, promediada 1/5/22d, en vol % anualizada)
    pk_var=(np.log(u.high/u.low)**2)/(4*np.log(2))
    for name,w in [("pk_d",1),("pk_w",5),("pk_m",22)]:
        u[name]=np.sqrt(252*pk_var.rolling(w).mean())*100
    u=u[u.date>=pd.Timestamp("2001-01-01")].reset_index(drop=True)
    for c in ["pk_d","pk_w","pk_m"]:
        u[c]=u[c].replace(0,np.nan).ffill()
    X_all=np.log(u[["pk_d","pk_w","pk_m"]].to_numpy())
    y_all=np.log(u["rv_fwd30"].to_numpy())
    u["har_fcst"]=np.nan
    print("HAR walk-forward (fit expansivo desde 2001, refit anual):")
    for Y in range(2018,2026):
        cut=pd.Timestamp(f"{Y}-01-01")
        fit=(u.fwd_known<cut)&np.isfinite(y_all)&np.isfinite(X_all).all(axis=1)
        A=np.column_stack([np.ones(fit.sum()),X_all[fit]])
        beta,_,_,_=np.linalg.lstsq(A,y_all[fit],rcond=None)
        resid=y_all[fit]-A@beta; s2=resid.var()
        pred_m=(u.date.dt.year==Y)&np.isfinite(X_all).all(axis=1)
        u.loc[pred_m,"har_fcst"]=np.exp(np.column_stack([np.ones(pred_m.sum()),X_all[pred_m]])@beta+s2/2)
        # R2 OOS del anio
        oos=pred_m&np.isfinite(y_all)
        if oos.sum()>30:
            p=np.log(u.loc[oos,"har_fcst"]); yy=y_all[oos]
            r2=1-((yy-p)**2).sum()/((yy-yy.mean())**2).sum()
            print(f"  {Y}: n_fit {fit.sum():5d} | betas {np.round(beta,3)} | R2-OOS(log) {r2:.3f}")
    return u[["date","har_fcst"]]

# ---------- senales (identico a bt15 salvo el gate VRP) ----------
def build_signals_har():
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
        s=df.loc[(df.absd-TGT).abs().groupby(df.date).idxmin()].copy()
        s["lmark"]=[marks.get(k,np.nan) for k in zip(s.date,s.strike-5.0)]
        s=s[s.lmark.notna()]; s["credit"]=s["mark"]-s["lmark"]
        rows.append(s[["date","expiration","strike","absd","credit","dte"]])
    pcs=pd.concat(rows,ignore_index=True); pcs=pcs[pcs.credit>0]
    pcs=pd.merge_asof(pcs.sort_values("expiration"),und.rename(columns={"date":"expiration","close":"exp_close"}),
                      on="expiration",direction="backward")
    pcs["pnl_hold"]=100*(pcs.credit-np.maximum(0,pcs.strike-pcs.exp_close)+np.maximum(0,pcs.strike-5-pcs.exp_close))-FRIC
    env=pd.read_parquet(f"{BASE}/derived/bt3_trades_{sym}.parquet")[["date","regime","vrp","atm_iv"]]
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
    har=har_forecast()
    pcs=pcs.merge(har,on="date",how="left")
    pcs["vrp_har"]=pcs.atm_iv*100/pcs.har_fcst
    common=(pcs.regime!="engine_out")&(pcs.strike<=pcs.put_wall)&(pcs.credit>=0.30)&\
           (~pcs.tail_out_sm)&(pcs.gex_b>=0)&(pcs.edge>=pcs.bar)
    pcs["sig_trail"]=common&(pcs.vrp>=1.2)
    pcs["sig_har"]=common&(pcs.vrp_har>=1.2)&pcs.har_fcst.notna()
    last=und.date.max()
    pcs=pcs[pcs.expiration<=last]
    return pcs,und

# ---------- gestion B a nivel senal ----------
def signal_B(sig,paths):
    out=[]
    for r in sig.itertuples():
        key=(r.expiration,r.strike)
        if key not in paths: out.append((np.nan,"nopath")); continue
        val=paths[key]
        val=val[(val.index>r.date)&(val.index<=r.expiration)]
        hit=val[val<=0.5*r.credit]
        if len(hit): out.append((100*(r.credit-hit.iloc[0])-FRIC,"tp50"))
        else: out.append((r.pnl_hold,"hold"))
    return pd.DataFrame(out,columns=["pnl_B","exit_B"],index=sig.index)

if __name__=="__main__":
    pcs,und=build_signals_har()
    st=pcs[pcs.sig_trail]; sh=pcs[pcs.sig_har]
    both=pcs[pcs.sig_trail&pcs.sig_har]
    new=pcs[pcs.sig_har&~pcs.sig_trail]      # abre HAR, cerraba trailing
    lost=pcs[pcs.sig_trail&~pcs.sig_har]     # cerro HAR, abria trailing
    print("\n"+"="*78)
    print(f"senales/anio: trailing {len(st)/8:.1f} | HAR {len(sh)/8:.1f} | comunes {len(both)} | nuevas {len(new)} | perdidas {len(lost)}")
    print(f"vrp trailing mediana {pcs.vrp.median():.2f} | vrp_har mediana {pcs.vrp_har.median():.2f} (dist. desplazada -> se reporta, no se retunea)")
    allsig=pcs[pcs.sig_trail|pcs.sig_har]
    paths=spread_paths(allsig)
    B=signal_B(allsig,paths); allsig=allsig.join(B); allsig=allsig[allsig.exit_B!="nopath"]
    def stats(m,label):
        g=allsig.loc[m.index.intersection(allsig.index)]
        g=g[g.exit_B!="nopath"]
        if len(g)==0: print(f"{label:32}: 0 senales"); return None
        ya=g.groupby(g.date.dt.year).pnl_B.sum()
        print(f"{label:32}: n {len(g):3} | win {(g.pnl_B>0).mean()*100:5.1f}% | avg ${g.pnl_B.mean():6.1f} | total ${g.pnl_B.sum():7.0f} | peor anio ${ya.min():.0f} ({int(ya.idxmin())})")
        return g
    print("\n--- nivel senal-dia, gestion B ---")
    g_tr=stats(st,"trailing (baseline)")
    g_ha=stats(sh,"HAR (candidata)")
    g_new=stats(new,"NUEVAS (abre HAR)")
    g_lost=stats(lost,"PERDIDAS (cierra HAR) [contraf.]")
    # criterios C1/C2/C4 a nivel senal
    ya_h=g_ha.groupby(g_ha.date.dt.year).pnl_B.sum()
    c1=(g_ha.pnl_B>0).mean()>=0.90 and ya_h.min()>=-700
    c2=len(sh)/8>14.4
    c4=(g_new is not None) and len(g_new)>0 and (g_new.pnl_B>0).mean()>=0.90 and g_new.pnl_B.mean()>0
    # cartera V2 con senales HAR
    sig_port=pcs[pcs.sig_har].copy()
    v2h=run_portfolio(sig_port,und,paths,2,"V2-HAR")
    c3=v2h["total"]>=1535 and v2h["worst_year"]>=-593-450 and v2h["maxdd"]>=-827-450
    print("\n"+"="*78)
    print("### CRITERIOS PRE-DECLARADOS BT-16")
    print(f"C1 (senal-dia B: win>=90% y ningun anio<-700): {'PASA' if c1 else 'FALLA'}")
    print(f"C2 (ocurrencia sube: >14,4 senales/anio):      {'PASA' if c2 else 'FALLA'} ({len(sh)/8:.1f})")
    print(f"C3 (cartera V2: total>=1535, cola<=+450):      {'PASA' if c3 else 'FALLA'} (total ${v2h['total']:.0f}, peor anio ${v2h['worst_year']:.0f}, maxDD ${v2h['maxdd']:.0f})")
    print(f"C4 (nuevas: win>=90% y avg>0):                 {'PASA' if c4 else 'FALLA'}")
