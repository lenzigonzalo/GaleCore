import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[4]
evidence = Path(__file__).resolve().parent
config = json.loads((root / 'dev/.local/env.json').read_text(encoding='utf-8-sig'))
assert config['project_ref'] == 'ecymbgpimqbtcvqyjtaq'
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width': 1536, 'height': 1000})
    responses = []
    page.on('response', lambda response: responses.append(response) if '/App/Runtime/Performance/Panel' in response.url else None)
    page.goto('http://localhost:3039', timeout=120000)
    page.get_by_label('Usuario', exact=True).fill('demo')
    page.get_by_label('Password', exact=True).fill(config['demo_password'])
    with page.expect_response(lambda response: '/App/GaleCore/Auth/Login' in response.url) as login:
        page.get_by_role('button', name='Entrar', exact=True).click()
    assert login.value.status == 200
    page.get_by_role('button', name='Lab', exact=True).click(timeout=60000)
    page.locator('.lab-sidebar-footer').get_by_role('button', name='Configuración', exact=True).click()
    page.get_by_role('button', name='Seguimiento SHADOW', exact=True).click()
    page.get_by_role('button', name='spy_prima_varianza_30_45d', exact=True).click(timeout=60000)
    page.get_by_role('heading', name='Qué falta', exact=True).wait_for(timeout=60000)
    assert page.locator('.performance-key-numbers .performance-stat').count() == 5
    assert page.get_by_role('button', name='← Estrategias', exact=True).count() == 1
    assert not page.locator('.shadow-runtime').evaluate('(el) => el.open')
    for response in reversed(responses):
        if response.status == 200 and parse_qs(urlparse(response.url).query).get('spec') == ['spy_prima_varianza_30_45d']:
            data = response.json()
            assert all(field in data for field in ['daily', 'openPositions', 'closedTrades'])
            assert isinstance(data['openPositions'][0]['legs'], str)
            (evidence / 'panel-dev.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
            (evidence / 'request.json').write_text(json.dumps({'url': response.url, 'status': response.status}, indent=2), encoding='utf-8')
            print('Panel Dev HTTP', response.status, 'daily', len(data['daily']), 'open', len(data['openPositions']), 'closed', len(data['closedTrades']), flush=True)
            break
    else:
        raise RuntimeError('No matching panel response')
    close = page.get_by_role('button', name='Cerrar', exact=True)
    if close.count():
        close.click()
    height = page.locator('.dashboard-main').evaluate('(el) => el.scrollHeight') + 100
    page.set_viewport_size({'width': 1536, 'height': height})
    page.locator('.dashboard-main').evaluate('(el) => el.scrollTop = 0')
    page.screenshot(path=str(evidence / 'strategy-dev.png'), full_page=True, animations='disabled', timeout=60000)
    print('One strategy capture saved:', height, 'px height', flush=True)
    browser.close()
