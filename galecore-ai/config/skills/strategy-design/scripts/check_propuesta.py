"""Chequeo de una propuesta de spreads contra GaleCore: strikes, vencimiento, crédito, riesgo y hora (WS-0073 AC-4).

Entra por stdin un JSON con las estructuras de la propuesta; trae de GaleCore la cadena (market_data.option_chains) y la
cotización de cada pata (market_data.quote, símbolo streamer). Sólo lee: no consulta otras fuentes ni toca la cuenta.
Imprime JSON; `ok` es false si algún número no coincide o una estructura no tiene cotización usable.

Entrada:
  {"underlying": "SPY", "structures": [{"id": "A", "legs": [{"expiration": "2026-11-20", "strike": 700,
   "right": "put", "side": "sell", "qty": 1}, ...], "kind": "credit"|"debit", "price": 0.95,
   "fill": "natural"|"mid", "max_risk_usd": 405}]}
Para pruebas sin red: --chain <cadena.json> --quotes <{streamer: {bidPrice, askPrice, retrieved_at}}.json> [--now ISO].
"""
import argparse
import json
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

NY = ZoneInfo('America/New_York')
PRICE_TOL = 0.005   # redondeo a centavos del medio
RISK_TOL = 1.0      # USD
CLI = [sys.executable, '-B', '-m', 'galecore_ai.adapters.cli', 'galecore', 'get']


def galecore(capability, symbol, out):
    proc = subprocess.run(CLI + [capability, '--symbol', symbol, '--out', str(out)], capture_output=True, text=True,
                          encoding='utf-8', errors='replace', check=False)
    if proc.returncode != 0 or not Path(out).is_file():
        return None
    try:
        return json.loads(proc.stdout).get('retrieved_at')
    except ValueError:
        return None


def fetch_chain(underlying, folder):
    out = Path(folder) / 'chain.json'
    if galecore('market_data.option_chains', underlying, out) is None and not out.is_file():
        raise SystemExit(f'GaleCore market_data.option_chains {underlying}: sin respuesta')
    return json.loads(out.read_text(encoding='utf-8-sig'))


def fetch_quote(streamer, folder):
    out = Path(folder) / f'{streamer}.json'
    retrieved = galecore('market_data.quote', streamer, out)
    if not out.is_file():
        return None
    rows = json.loads(out.read_text(encoding='utf-8-sig')).get('data') or []
    row = rows[0] if rows else {}
    return {'bidPrice': row.get('bidPrice'), 'askPrice': row.get('askPrice'), 'retrieved_at': retrieved}


def find_streamer(chain, leg):
    """Símbolo streamer de la pata, o un motivo si el vencimiento o el strike no existen en la cadena."""
    exp = next((e for e in chain['expirations'] if e['expirationDate'] == leg['expiration']), None)
    if exp is None:
        return None, f"vencimiento {leg['expiration']} inexistente"
    row = next((s for s in exp['strikes'] if abs(float(s['strikePrice']) - float(leg['strike'])) < 1e-9), None)
    if row is None:
        return None, f"strike {leg['strike']} inexistente en {leg['expiration']}"
    return row['callStreamerSymbol' if leg['right'] == 'call' else 'putStreamerSymbol'], None


def usable(quote):
    """Compra y venta positivas y no cruzadas; si no, el motivo."""
    if not quote or not isinstance(quote.get('bidPrice'), (int, float)) or not isinstance(quote.get('askPrice'), (int, float)):
        return 'sin cotización'
    if quote['bidPrice'] <= 0:
        return 'compra en 0'
    if quote['bidPrice'] > quote['askPrice']:
        return f"cotización cruzada (compra {quote['bidPrice']} > venta {quote['askPrice']})"
    return None


def market_open(now):
    ny = now.astimezone(NY)
    return ny.weekday() < 5 and (9, 30) <= (ny.hour, ny.minute) < (16, 0)


def row(field, declared, galecore_value, ok):
    return {'campo': field, 'declarado': declared, 'galecore': galecore_value, 'estado': 'ok' if ok else 'difiere'}


def check_structure(s, chain, get_quote):
    out = {'id': s['id'], 'filas': [], 'ok': False, 'motivo': None}
    quotes, times = [], []
    for leg in s['legs']:
        streamer, why = find_streamer(chain, leg)
        label = f"{leg['side']} {leg['right']} {leg['strike']} {leg['expiration']}"
        if why:
            out['filas'].append(row(label, 'existe', why, False))
            out['motivo'] = f'sin propuesta: {why}'
            return out
        out['filas'].append(row(label, 'existe', streamer, True))
        quote = get_quote(streamer)
        bad = usable(quote)
        if bad:
            out['motivo'] = f'sin propuesta: {label}: {bad}'
            return out
        quotes.append(quote)
        times.append(quote.get('retrieved_at'))
    natural = sum((1 if l['side'] == 'sell' else -1) * (q['bidPrice'] if l['side'] == 'sell' else q['askPrice']) for l, q in zip(s['legs'], quotes))
    mid = sum((1 if l['side'] == 'sell' else -1) * (q['bidPrice'] + q['askPrice']) / 2 for l, q in zip(s['legs'], quotes))
    net = s['price'] if s['kind'] == 'credit' else -s['price']
    lo, hi = sorted((natural, mid))
    expected = natural if s.get('fill', 'natural') == 'natural' else mid
    real_kind = 'credit' if expected >= 0 else 'debit'
    kind_ok = real_kind == s['kind']
    credit_ok = kind_ok and lo - PRICE_TOL <= net <= hi + PRICE_TOL
    out['filas'].append(row(f"{s['kind']} ({s.get('fill', 'natural')})", s['price'], f'{real_kind} {abs(expected):.2f}', credit_ok))
    out['corregidos'] = {} if credit_ok else {real_kind: round(abs(expected), 2)}
    if not kind_ok:
        out['corregidos']['tipo'] = real_kind   # las patas dadas cobran o pagan al revés de lo declarado
    risk = max_risk(s, real_kind, abs(net) if credit_ok else abs(expected))   # el riesgo sigue al precio declarado si es válido
    if risk is None:
        out['filas'].append({'campo': 'riesgo máximo', 'declarado': s.get('max_risk_usd'), 'galecore': None,
                             'estado': 'no verificable (sólo verticales de dos patas con la misma cantidad)'})
        risk_ok = True
    else:
        risk_ok = abs(s['max_risk_usd'] - risk) <= RISK_TOL
        out['filas'].append(row('riesgo máximo (USD)', s['max_risk_usd'], round(risk, 2), risk_ok))
        if not risk_ok:
            out['corregidos']['riesgo'] = round(risk, 2)
    stamps = sorted(t for t in times if t)
    if len(stamps) > 1:
        out['separacion_patas_s'] = round((datetime.fromisoformat(stamps[-1]) - datetime.fromisoformat(stamps[0])).total_seconds(), 1)
    out['ok'] = credit_ok and risk_ok
    return out


def max_risk(s, kind, price):
    legs = s['legs']
    if len(legs) != 2 or legs[0]['right'] != legs[1]['right'] or legs[0]['expiration'] != legs[1]['expiration']             or {legs[0]['side'], legs[1]['side']} != {'sell', 'buy'} or legs[0].get('qty', 1) != legs[1].get('qty', 1):
        return None
    qty = legs[0].get('qty', 1)
    if kind == 'debit':
        return price * 100 * qty
    width = abs(float(legs[0]['strike']) - float(legs[1]['strike']))
    return (width - price) * 100 * qty


def run(payload, chain, get_quote, now):
    structures = [check_structure(s, chain, get_quote) for s in payload['structures']]
    return {'ok': all(s['ok'] for s in structures), 'estructuras': structures,
            'hora_consulta_ny': now.astimezone(NY).strftime('%Y-%m-%d %H:%M:%S'), 'mercado_abierto': market_open(now),
            'faltantes': [{'id': s['id'], 'motivo': s['motivo']} for s in structures if s['motivo']]}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--chain', type=Path, help='prueba sin red: cadena ya traída')
    p.add_argument('--quotes', type=Path, help='prueba sin red: {streamer: {bidPrice, askPrice, retrieved_at}}')
    p.add_argument('--now', help='prueba: hora ISO en lugar de la actual')
    a = p.parse_args()
    payload = json.loads(sys.stdin.read())
    now = datetime.fromisoformat(a.now) if a.now else datetime.now(UTC)
    with tempfile.TemporaryDirectory(prefix='check-propuesta-') as folder:
        if a.chain:
            chain = json.loads(a.chain.read_text(encoding='utf-8-sig'))
        else:
            chain = fetch_chain(payload['underlying'], folder)
        injected = json.loads(a.quotes.read_text(encoding='utf-8-sig')) if a.quotes else None
        get_quote = (lambda sym: injected.get(sym)) if injected is not None else (lambda sym: fetch_quote(sym, folder))
        print(json.dumps(run(payload, chain, get_quote, now), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
