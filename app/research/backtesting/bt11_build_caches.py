"""BT-11 caches: (1) pop_obs_calls_{sym} 2013-2025 (misma metodologia que puts:
DTE 30-50, bucket 0.05, itm = exp_close > strike); (2) {sym}_structinputs_daily
2018-2025: callGEX/putGEX (OI*gamma*100*spot^2*0.01, DTE<90), gex_skew, call_wall,
zscore (ret5d_log/(atm_iv/sqrt252)), trend EMA20/50 (neutral <0.2%)."""
import pandas as pd, numpy as np

BASE = "C:/Eric/App/Claude/Projects/GaleCore/research/data"

for sym in ["spy", "qqq"]:
    und = pd.read_parquet(f"{BASE}/{sym}_options/{sym}_underlying_prices.parquet")[["date","close","dividend_amount"]]
    und["date"] = pd.to_datetime(und["date"]); und = und.sort_values("date").reset_index(drop=True)

    # ---------- (1) obs de calls ----------
    obs_rows = []
    for y in range(2013, 2026):
        df = pd.read_parquet(f"{BASE}/{sym}_options/{sym}_options_{y}.parquet",
                             columns=["date","expiration","strike","type","delta"])
        df = df[df.type == "call"].copy()
        df["date"] = pd.to_datetime(df["date"]); df["expiration"] = pd.to_datetime(df["expiration"])
        df["dte"] = (df.expiration - df.date).dt.days
        df = df[(df.dte >= 30) & (df.dte <= 50) & df.delta.notna()]
        df["absd"] = df.delta.abs()
        df = df[(df.absd >= 0.02) & (df.absd <= 0.60)]
        df["bucket"] = (np.floor(df.absd / 0.05) * 0.05).round(2)
        obs_rows.append(df[["expiration","strike","bucket","absd"]])
    obs = pd.concat(obs_rows, ignore_index=True)
    obs = pd.merge_asof(obs.sort_values("expiration"),
                        und[["date","close"]].rename(columns={"date":"expiration","close":"exp_close"}),
                        on="expiration", direction="backward")
    last = und.date.max()
    obs = obs[obs.expiration <= last]
    obs["itm"] = obs.exp_close > obs.strike
    obs[["expiration","bucket","absd","itm"]].to_parquet(f"{BASE}/derived/pop_obs_calls_{sym}.parquet", index=False)
    print(f"{sym} pop_obs_calls: {len(obs)} filas, itm rate global {obs.itm.mean()*100:.1f}%")

    # ---------- (2) struct inputs diarios 2018-2025 ----------
    spot_map = und.set_index("date").close
    days = []
    for y in range(2018, 2026):
        df = pd.read_parquet(f"{BASE}/{sym}_options/{sym}_options_{y}.parquet",
                             columns=["date","expiration","strike","type","gamma","open_interest"])
        df["date"] = pd.to_datetime(df["date"]); df["expiration"] = pd.to_datetime(df["expiration"])
        df["dte"] = (df.expiration - df.date).dt.days
        df = df[(df.dte > 0) & (df.dte < 90) & df.gamma.notna() & (df.open_interest > 0)]
        df["spot"] = df.date.map(spot_map)
        df["gexval"] = df.open_interest * df.gamma * 100 * df.spot**2 * 0.01
        df["goi"] = df.gamma * df.open_interest
        calls = df[df.type == "call"]; puts = df[df.type == "put"]
        cg = calls.groupby("date").gexval.sum().rename("call_gex")
        pg = puts.groupby("date").gexval.sum().rename("put_gex")
        cw = calls.loc[calls.groupby("date").goi.idxmax(), ["date","strike"]].set_index("date").strike.rename("call_wall")
        d = pd.concat([cg, pg, cw], axis=1).reset_index()
        days.append(d)
        del df, calls, puts
    si = pd.concat(days, ignore_index=True).sort_values("date")
    si["gex_skew"] = si.call_gex / (si.call_gex + si.put_gex.abs())

    # zscore + trend desde el subyacente (historia completa para EMAs)
    u = und.copy()
    u["ret5d"] = np.log(u.close / u.close.shift(5))
    u["ema20"] = u.close.ewm(span=20, adjust=False).mean()
    u["ema50"] = u.close.ewm(span=50, adjust=False).mean()
    u["trend"] = np.where((u.ema20 - u.ema50).abs() / u.ema50 < 0.002, "neutral",
                  np.where(u.ema20 > u.ema50, "up", "down"))
    env = pd.read_parquet(f"{BASE}/derived/bt3_trades_{sym}.parquet")[["date","atm_iv"]]
    u = u.merge(env, on="date", how="left")
    u["zscore"] = u.ret5d / (u.atm_iv / np.sqrt(252))
    si = si.merge(u[["date","ret5d","zscore","trend","dividend_amount"]], on="date", how="left")
    si.to_parquet(f"{BASE}/derived/{sym}_structinputs_daily.parquet", index=False)
    sk = pd.cut(si.gex_skew, [0, 0.4, 0.6, 1.0], labels=["put_dominant","symmetric","call_dominant"])
    print(f"{sym} structinputs: {len(si)} dias | skew: {sk.value_counts().to_dict()} | "
          f"|z|<1: {(si.zscore.abs()<1).mean()*100:.0f}% | z>1.5: {(si.zscore>1.5).mean()*100:.0f}% | z<-1.5: {(si.zscore<-1.5).mean()*100:.0f}%")
