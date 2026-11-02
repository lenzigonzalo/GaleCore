"""Estudio descriptivo de precios GaleCore; no simula órdenes ni ejecuciones."""
import argparse
import json
import math
import os
import statistics
import subprocess
import sys
import tempfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

SYMBOLS = ('SPY', 'IEF', 'GLD')
HISTORY_DAYS = 400  # suficiente para 220 ruedas


def fetch(folder, cutoff):
    """Trae de GaleCore (CLI de solo lectura) velas 1d y quote de cada ETF a <folder>/<simbolo>[-quote].json."""
    start = (date.fromisoformat(cutoff) - timedelta(days=HISTORY_DAYS)).isoformat()
    base = [sys.executable, '-B', '-m', 'galecore_ai.adapters.cli', 'galecore', 'get']
    for s in SYMBOLS:
        for cap, extra, name in (('market_data.candles', ['--param', 'interval=1d', '--param', f'fromTime={start}',
                                  '--param', f'toTime={datetime.now(UTC).date().isoformat()}'], s.lower()),
                                 ('market_data.quote', [], s.lower() + '-quote')):
            out = Path(folder) / f'{name}.json'
            proc = subprocess.run(base + [cap, '--symbol', s, *extra, '--out', str(out)], capture_output=True, text=True,
                                  encoding='utf-8', errors='replace', check=False)
            if proc.returncode != 0 or not out.is_file():
                raise SystemExit(f'GaleCore {cap} {s}: {(proc.stdout or proc.stderr).strip()[:300]}')

def analyze(symbol, folder, cutoff):
    raw = json.loads((folder / f'{symbol.lower()}.json').read_text(encoding='utf-8-sig'))['data']
    by_date, invalid, duplicates, inconsistent = {}, 0, 0, []
    for r in raw:
        d = datetime.fromtimestamp(r['time']/1000, UTC).date().isoformat()
        if d > cutoff:
            continue
        vals = [r.get(k) for k in ('open','high','low','close','volume')]
        if not all(isinstance(v,(float,int)) and math.isfinite(v) for v in vals) or min(vals[:4]) <= 0 or r['volume'] <= 0:
            invalid += 1
            continue
        if not r['low'] <= min(r['open'],r['close']) <= max(r['open'],r['close']) <= r['high']:
            inconsistent.append(d)
        duplicates += d in by_date
        by_date[d] = dict(r, date=d)
    rows = [by_date[d] for d in sorted(by_date)]
    c = [r['close'] for r in rows]
    def sma(i,n): return sum(c[i-n+1:i+1])/n if i >= n-1 else None
    trend, pull, confirmed = [], [], []
    for i,r in enumerate(rows):
        t = i >= 219 and c[i] > sma(i,200) and sma(i,50) > sma(i-20,50)
        p = bool(t and sma(i,50) <= c[i] < sma(i,20))
        confirm = bool(t and c[i] > max(c[i-3:i]) and c[i] >= sma(i,50) and any(pull[max(0,i-5):i]))
        trend.append(bool(t)); pull.append(p); confirmed.append(confirm)
    events, last_i = [], -100
    for i in range(219,len(rows)-20):
        if not confirmed[i] or i-last_i < 21: continue
        last_i = i
        events.append({'date':rows[i]['date'],'reference_close':c[i],
                       'change_20_sessions_pct':100*(c[i+20]/c[i]-1),
                       'lowest_close_next20_pct':100*(min(c[i+1:i+21])/c[i]-1),
                       'highest_close_next20_pct':100*(max(c[i+1:i+21])/c[i]-1)})
    baseline = [100*(c[i+20]/c[i]-1) for i in range(219,len(rows)-20,21)]
    i=len(rows)-1; last=rows[-1]
    low5=min(c[-5:])
    q=json.loads((folder/f'{symbol.lower()}-quote.json').read_text(encoding='utf-8-sig'))['data'][0]
    spread=q['askPrice']-q['bidPrice']
    result={'symbol':symbol,'start':rows[0]['date'],'end':last['date'],'bars':len(rows),
            'invalid_bars':invalid,'duplicate_dates':duplicates,'close':last['close'],
            'ohlc_inconsistent_dates':inconsistent,
            'daily_label_utc':datetime.fromtimestamp(last['time']/1000,UTC).isoformat(),
            'volume_last':last['volume'],'volume20_mean':statistics.mean(r['volume'] for r in rows[-20:]),
            'sma20':sma(i,20),'sma50':sma(i,50),'sma50_20sessions_ago':sma(i-20,50),'sma200':sma(i,200),
            'trend':trend[-1],'pullback':pull[-1],'confirmation':confirmed[-1],
            'recent_pullback':any(pull[-5:]),'last_high':last['high'],'last_low5_close':low5,
            'confirmation_reference_max_close3':max(c[-3:]),'invalidation_reference':low5*0.995,
            'quote_bid':q['bidPrice'],'quote_ask':q['askPrice'],'spread':spread,
            'spread_pct':100*spread/((q['askPrice']+q['bidPrice'])/2),
            'quote_timestamp_available':bool(q.get('eventTime') or q.get('bidTime') or q.get('askTime')),
            'signal_dates_total':sum(confirmed),'study_n':len(events),
            'study_first':events[0]['date'] if events else None,'study_last':events[-1]['date'] if events else None,
            'forward20_mean_pct':statistics.mean(e['change_20_sessions_pct'] for e in events) if events else None,
            'forward20_median_pct':statistics.median(e['change_20_sessions_pct'] for e in events) if events else None,
            'forward20_min_pct':min((e['change_20_sessions_pct'] for e in events),default=None),
            'forward20_max_pct':max((e['change_20_sessions_pct'] for e in events),default=None),
            'worst_close20_pct':min((e['lowest_close_next20_pct'] for e in events),default=None),
            'baseline_n':len(baseline),'baseline_mean20_pct':statistics.mean(baseline),
            'state':'confirmada' if confirmed[-1] else ('candidata' if trend[-1] and (pull[-1] or any(pull[-5:])) else 'descartada'),
            'events':events}
    return result, set(by_date)

def scoped(a):
    """Una corrida programada (GALECORE_AI_RUN_DIR) no lee carpetas ni escribe archivos fuera de la suya: sin --input ni --output."""
    if os.environ.get('GALECORE_AI_RUN_DIR'):
        a.input = a.output = None
    return a

if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('--input',type=Path,help='carpeta con los JSON ya traídos; sin ella se traen de GaleCore'); p.add_argument('--cutoff',required=True)
    p.add_argument('--output',type=Path,help='opcional: guarda también el estudio completo (con eventos)'); a=scoped(p.parse_args())
    if a.input is None:
        a.input=Path(tempfile.mkdtemp(prefix='swing-',dir=os.environ.get('GALECORE_AI_RUN_DIR') or None))
        fetch(a.input,a.cutoff)
    results=[]; dates=[]
    for s in SYMBOLS:
        r,d=analyze(s,a.input,a.cutoff); results.append(r); dates.append(d)
    union=set.union(*dates)
    for r,d in zip(results,dates):
        r['dates_missing_vs_universe']=sorted(union-d)
        recent_start=sorted(d)[-220] if len(d)>=220 else ''
        r['recent_missing_dates']=[v for v in sorted(union-d) if v>=recent_start]
        r['technical_data_eligible']=r['bars']>=220 and r['end']==a.cutoff and not r['recent_missing_dates']
        # Fechas de cotización faltantes bloquean ejecución, no se reemplazan por hora de consulta.
        r['executable']=False
        r['initial_quantity']=None
        if r['confirmation'] and r['technical_data_eligible']:
            entry=r['close']*1.0025; stop=r['invalidation_reference']
            r['proposed_entry_limit']=entry
            r['distance_pct']=100*(entry-stop)/entry
            r['initial_quantity']=max(0,min(math.floor(9/(entry-stop+0.002*entry)),math.floor(499/(1.001*entry)))) if 0<r['distance_pct']<=5 else 0
    if a.output:
        a.output.parent.mkdir(parents=True,exist_ok=True)
        a.output.write_text(json.dumps({'cutoff':a.cutoff,'method':'descriptivo, referencia al cierre; sin operaciones ni costos','results':results},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps([{k:v for k,v in r.items() if k!='events'} for r in results],ensure_ascii=False,indent=2))
