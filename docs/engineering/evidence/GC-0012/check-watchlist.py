"""Consulta sólo API Dev y guarda cotizaciones sanitizadas; no imprime credenciales."""
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

repo = Path(__file__).resolve().parents[4]
spec = importlib.util.spec_from_file_location('dev', repo / 'dev' / 'galecore_dev.py')
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)
token = dev.login(dev.load_env())
evidence = {'queriedAt': datetime.now(timezone.utc).isoformat(), 'baseUrl': dev.API_URL, 'responses': []}
for path in ['/App/Gex/Rules', '/Data/Tastytrade/MarketData/ByType?Symbol=SPY,QQQ,IWM']:
    code, data = dev.http('GET', dev.API_URL + path, headers={'Authorization': 'Bearer ' + token})
    item = {'path': path, 'status': code}
    if 'ByType' in path:
        item['response'] = data
    else:
        item['tickers'] = data.get('universe', {}).get('tickers')
    evidence['responses'].append(item)
if any(x['status'] != 200 for x in evidence['responses']):
    sys.exit('La API Dev no respondió 200; no se guarda evidencia de éxito.')
output = Path(sys.argv[1])
output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
print('Cotizaciones de API Dev guardadas, sin credenciales.')
