"""3039 browser QA: synthetic auth, real read-only bridge catalogue, fixture submits."""
import base64
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    output = Path(__file__).resolve().parent.parent / 'docs/engineering/evidence/GC-0034'
    output.mkdir(parents=True, exist_ok=True)
    report = {'auth': 'synthetic QA session', 'catalogue': 'real local bridge GET',
              'submissions': 'browser fixtures only; no real CLI inference', 'checks': []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        encode = lambda x: base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
        user = {'id': 'visual-preview', 'email': 'preview@example.test', 'user_metadata': {}}
        token = encode({'alg': 'none'}) + '.' + encode({'sub': user['id'], 'exp': int(time.time())+3600}) + '.test'
        session = {'access_token': token, 'refresh_token': 'synthetic-test-only', 'token_type': 'bearer',
                   'expires_at': int(time.time())+3600, 'expires_in': 3600, 'user': user}
        page.add_init_script('localStorage.setItem("sb-ecymbgpimqbtcvqyjtaq-auth-token",'+json.dumps(json.dumps(session))+')')
        page.add_init_script("""document.addEventListener('DOMContentLoaded',()=>{const n=document.createElement('div');n.textContent='QA: AUTH SIMULADA / CATÁLOGO LOCAL REAL / ENVÍO FIXTURE';n.style.cssText='position:fixed;bottom:0;left:0;z-index:999;background:#503b12;color:white;padding:6px';document.body.appendChild(n);});""")
        page.route('http://localhost:7002/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{}'))
        posted = []
        fixture = {}
        def submit(route):
            body = route.request.post_data_json
            posted.append(body)
            fixture.update(dict(body, id='qa-fixture', title='QA', state='idle', activity='', error=None, messages=[]))
            route.fulfill(status=201, content_type='application/json', body=json.dumps(fixture))
        page.route('http://127.0.0.1:8771/chats', submit)
        page.route('http://127.0.0.1:8771/chats/qa-fixture/**', lambda r: r.fulfill(status=202, content_type='application/json', body=json.dumps(fixture)))
        page.route('http://127.0.0.1:8771/chats/qa-fixture', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(fixture)))
        page.goto('http://localhost:3039', wait_until='domcontentloaded', timeout=120000)
        monitor_configs = page.get_by_role('button', name='Configuración', exact=True)
        monitor_configs.first.wait_for(timeout=60000)
        assert monitor_configs.count() == 1 and monitor_configs.bounding_box()['x'] < 400
        assert page.get_by_role('button', name='Mi cuenta', exact=True).count() == 0
        report['checks'].append('Monitor: settings remains only in left sidebar; right account menu removed')
        page.get_by_role('button', name='Lab', exact=True).click(timeout=60000)
        picker = page.get_by_role('button', name='Proveedor y modelo:', exact=False)
        picker.wait_for()
        page.get_by_role('button', name='Personal', exact=True).click()
        composer = page.get_by_role('textbox', name='Mensaje al proyecto')
        composer.fill('Borrador de prueba')
        picker.click()
        page.get_by_role('option', name='Claude — Opus', exact=True).wait_for()
        page.wait_for_function("Array.from(document.querySelectorAll('.lab-provider-menu img')).every(x=>x.complete && x.naturalWidth>0)")
        page.screenshot(path=str(output/'selector-desktop.png'))
        page.get_by_role('option', name='Claude — Opus', exact=True).click()
        assert composer.input_value() == 'Borrador de prueba'
        picker.click()
        page.get_by_label('Esfuerzo de la conversación').select_option('high')
        page.keyboard.press('Escape')
        assert page.get_by_role('dialog', name='Elegir proveedor y modelo').count() == 0
        assert page.locator('.lab-chat-composer select').count() == 0
        configs = page.get_by_role('button', name='Configuración', exact=True)
        assert configs.count() == 1 and configs.bounding_box()['x'] < 400
        assert configs.bounding_box()['y'] + configs.bounding_box()['height'] < 1000
        assert page.get_by_role('button', name='Mi cuenta', exact=True).count() == 0
        assert page.get_by_role('button', name='Salir', exact=True).count() == 1
        box = picker.bounding_box(); header = page.locator('.lab-chat-header').bounding_box()
        assert abs(box['x']+box['width']/2-header['x']-header['width']/2)<5
        report['checks'].append('Desktop: centered selector, loaded provider logos, preserved draft, Escape, no composer selectors; single left settings/logout')
        page.screenshot(path=str(output/'chat-desktop.png'))
        page.get_by_role('button', name='Enviar mensaje').click()
        page.wait_for_timeout(700)
        assert posted == [{'project':'personal','provider':'claude','model':'opus','effort':'high'}]
        picker.click()
        assert all(page.get_by_role('option').nth(i).is_disabled() for i in range(page.get_by_role('option').count()))
        page.keyboard.press('Escape')
        report['checks'].append('Fixture submit contains Claude/Opus/high; existing conversation selection locked; no native inference')
        page.set_viewport_size({'width': 820, 'height': 900})
        picker.click()
        page.screenshot(path=str(output/'selector-narrow.png'))
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        report['checks'].append('820px: selector accessible without horizontal page overflow')
        (output/'browser.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        browser.close()
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
