import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[4]
evidence = Path(__file__).resolve().parent
config = json.loads((root / 'dev/.local/env.json').read_text(encoding='utf-8-sig'))
assert config['project_ref'] == 'ecymbgpimqbtcvqyjtaq'
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})
    responses = []
    page.on('response', lambda response: responses.append(response) if '/App/Runtime/Performance/Panel' in response.url else None)
    page.goto('http://localhost:3039', timeout=120000)
    page.get_by_label('Usuario', exact=True).fill('demo')
    page.get_by_label('Password', exact=True).fill(config['demo_password'])
    with page.expect_response(lambda r: '/App/GaleCore/Auth/Login' in r.url) as login:
        page.get_by_role('button', name='Entrar', exact=True).click()
    assert login.value.status == 200
    page.get_by_role('button', name='Lab', exact=True).click(timeout=60000)
    page.locator('.lab-sidebar-footer').get_by_role('button', name='Configuración', exact=True).click()
    page.get_by_role('button', name='Seguimiento SHADOW', exact=True).click()
    page.get_by_role('button', name='iwm_prima_condor_30_45d', exact=True).click(timeout=60000)
    page.locator('.performance-panel .position-row').first.wait_for(timeout=60000)
    page.locator('.performance-panel .strike-spot').first.wait_for(timeout=30000)
    rows = page.locator('.performance-panel .position-row')
    assert rows.count() == 3
    assert rows.first.locator('.strike-leg').count() == 4
    data = next(r.json() for r in reversed(responses) if r.status == 200 and 'iwm_prima_condor_30_45d' in r.url)
    assert all(p['symbol'] == 'IWM' and len(p['legList']) == 4 for p in data['openPositions'])
    (evidence / 'shadow-dev.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    close = page.get_by_role('button', name='Cerrar', exact=True)
    if close.count(): close.click()
    height = page.locator('.dashboard-main').evaluate('(el) => el.scrollHeight') + 100
    page.set_viewport_size({'width': 1920, 'height': height})
    page.locator('.dashboard-main').evaluate('(el) => el.scrollTop = 0')
    page.screenshot(path=str(evidence / 'shadow-iwm-dev.png'), full_page=True, animations='disabled', timeout=60000)
    page.set_viewport_size({'width': 1920, 'height': 1080})
    page.get_by_role('button', name='Monitor', exact=True).click()
    page.get_by_role('heading', name='Mi portfolio', exact=True).wait_for(timeout=60000)
    page.locator('.rs-position-rows .position-row').first.wait_for(timeout=60000)
    page.locator('.rs-position-rows .strike-spot').first.wait_for(timeout=30000)
    real_count = page.locator('.rs-position-rows .position-row').count()
    height = page.locator('.dashboard-main').evaluate('(el) => el.scrollHeight') + 100
    page.set_viewport_size({'width': 1920, 'height': height})
    page.locator('.dashboard-main').evaluate('(el) => el.scrollTop = 0')
    page.screenshot(path=str(evidence / 'monitor-resumen-dev.png'), full_page=True, animations='disabled', timeout=60000)
    print('Real Dev screenshots: SHADOW IWM (3 condors), Monitor Resumen:', real_count, 'position rows.', flush=True)
    browser.close()
