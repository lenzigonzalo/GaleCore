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
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})
    responses = []
    page.on('response', lambda response: responses.append(response) if '/App/Runtime/Performance/' in response.url else None)
    page.goto('http://localhost:3039', timeout=120000)
    page.get_by_label('Usuario', exact=True).fill('demo')
    page.get_by_label('Password', exact=True).fill(config['demo_password'])
    with page.expect_response(lambda response: '/App/GaleCore/Auth/Login' in response.url) as login:
        page.get_by_role('button', name='Entrar', exact=True).click()
    assert login.value.status == 200
    page.get_by_role('button', name='Lab', exact=True).click(timeout=60000)
    page.locator('.lab-sidebar-footer').get_by_role('button', name='Configuración', exact=True).click()
    page.get_by_role('button', name='Seguimiento SHADOW', exact=True).click()
    strategy = page.get_by_role('button', name='spy_prima_varianza_30_45d', exact=True)
    strategy.wait_for(timeout=60000)
    close = page.get_by_role('button', name='Cerrar', exact=True)
    if close.count(): close.click()
    summary = next(response for response in responses if '/Performance/Summary' in response.url and response.status == 200)
    (evidence / 'summary-dev.json').write_text(json.dumps(summary.json(), ensure_ascii=False, indent=2), encoding='utf-8')
    page.screenshot(path=str(evidence / 'list-dev.png'), full_page=True, animations='disabled', timeout=60000)
    strategy.click()
    page.get_by_text('Ganancia total', exact=True).wait_for(timeout=60000)
    page.locator('.performance-visuals canvas').first.wait_for(timeout=30000)
    assert page.get_by_role('tab', name='Resumen').get_attribute('aria-selected') == 'true'
    assert page.get_by_role('button', name='Actualizar', exact=True).count() == 0
    assert page.get_by_text('SHADOW · simulado', exact=True).count() == 0
    panels = [response for response in responses if '/Performance/Panel' in response.url and response.status == 200 and parse_qs(urlparse(response.url).query).get('spec') == ['spy_prima_varianza_30_45d']]
    assert panels
    data = panels[-1].json()
    assert all(field in data for field in ['tradesWon', 'grossProfit', 'closedTrades'])
    (evidence / 'panel-dev.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    (evidence / 'requests.json').write_text(json.dumps([{'url': response.url, 'status': response.status} for response in responses], indent=2), encoding='utf-8')
    height = page.locator('.dashboard-main').evaluate('(el) => el.scrollHeight') + 100
    page.set_viewport_size({'width': 1920, 'height': height})
    page.locator('.dashboard-main').evaluate('(el) => el.scrollTop = 0')
    page.screenshot(path=str(evidence / 'summary-dev.png'), full_page=True, animations='disabled', timeout=60000)
    before = len([r for r in responses if '/Performance/Summary' in r.url])
    page.get_by_role('button', name='← Estrategias', exact=True).click()
    strategy.wait_for()
    page.wait_for_timeout(500)
    assert len([r for r in responses if '/Performance/Summary' in r.url]) == before
    print('Real Dev captures: list and Resumen; back preserved Summary. Closed:', data['tradesClosed'], 'open:', data['tradesOpen'], flush=True)
    browser.close()
