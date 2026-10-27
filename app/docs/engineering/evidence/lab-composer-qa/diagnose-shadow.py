import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def probe(endpoint):
    start = time.monotonic()
    request = urllib.request.Request(
        'http://127.0.0.1:7001' + endpoint,
        headers={'X-API-KEY': os.environ['GALECORE_API_KEY']},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            value = json.load(response)
            summary = {'status': response.status, 'items': len(value) if isinstance(value, list) else None}
    except Exception as error:
        summary = {'error_type': type(error).__name__, 'status': getattr(error, 'code', None)}
    return {'endpoint': endpoint, 'seconds': round(time.monotonic() - start, 2), **summary}


with ThreadPoolExecutor(max_workers=2) as pool:
    result = list(pool.map(probe, ['/App/Runtime/Status', '/App/Runtime/Metrics']))
Path('.tmp/lab-composer-qa/shadow-api-diagnostic.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
