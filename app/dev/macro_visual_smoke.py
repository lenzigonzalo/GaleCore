"""Recorrido visual real de Macro y marco global Dev; sin imprimir credenciales."""
import argparse
import base64
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--saved-data', action='store_true', help='QA visual con snapshot real guardado y sesión sintética aislada')
    parser.add_argument('--sidebar-only', action='store_true', help='Comprobar lateral única de Lab y navegación general')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    env = json.loads(Path('C:/Users/lenzi/OneDrive/Escritorio/GaleCore/GaleCore/dev/.local/env.json').read_text(encoding='utf-8'))
    assert env['project_ref'] == 'ecymbgpimqbtcvqyjtaq'
    output = root / 'docs/engineering/evidence/GC-0030/visual-feedback'
    if args.sidebar_only:
        output = root / 'docs/engineering/evidence/GC-0030/sidebar-unified'
    output.mkdir(parents=True, exist_ok=True)
    report = {'started_at': datetime.now(timezone.utc).isoformat(), 'checks': [], 'mode': 'saved-real-data-synthetic-session' if args.saved_data else 'real-dev-browser'}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1100})
        if args.saved_data:
            snapshot = json.loads((root / 'docs/engineering/evidence/GC-0030/snapshot-real.json').read_text(encoding='utf-8'))
            encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
            user = {'id': 'visual-preview', 'email': 'preview@example.test', 'user_metadata': {}}
            token = encode({'alg': 'none'}) + '.' + encode({'sub': user['id'], 'exp': int(time.time()) + 3600}) + '.test'
            session = {'access_token': token, 'refresh_token': 'synthetic-test-only', 'token_type': 'bearer', 'expires_at': int(time.time()) + 3600, 'expires_in': 3600, 'user': user}
            page.add_init_script('localStorage.setItem("sb-ecymbgpimqbtcvqyjtaq-auth-token", ' + json.dumps(json.dumps(session)) + ')')
            page.add_init_script("""document.addEventListener('DOMContentLoaded', () => {
                const note = document.createElement('div');
                note.textContent = 'QA VISUAL · DATOS REALES GUARDADOS · SESIÓN SIMULADA';
                note.style.cssText = 'position:fixed;bottom:0;left:0;z-index:999;background:#503b12;color:white;padding:4px 10px;font-size:12px';
                document.body.appendChild(note);
            });""")
            def recorded(route):
                url = route.request.url
                if '/App/Macro/' in url:
                    payload = snapshot
                elif '/Data/Fred/ReleaseDates' in url:
                    payload = {'retrievedAt': snapshot['generatedAt'], 'data': [{'date': e['date'], 'releaseName': e['name'], 'releaseId': e['id']} for e in snapshot['events'] if e['source'] == 'fred']}
                elif '/Data/Fed/FomcMeetings' in url:
                    payload = {'retrievedAt': snapshot['generatedAt'], 'upstreamUrl': 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', 'data': [{'end': e['date']} for e in snapshot['events'] if e['source'] == 'fed']}
                elif '/Config' in url or '/Rules' in url:
                    payload = json.loads((root / 'source/galecore-datafeed/DataFeed.Api/Files/galecore_rules_core.json').read_text(encoding='utf-8'))
                else:
                    payload = {}
                route.fulfill(status=200, content_type='application/json', body=json.dumps(payload))
            page.route('http://localhost:7002/**', recorded)
        page.goto('http://localhost:3039/?macro=panorama', wait_until='domcontentloaded')
        if not args.saved_data:
            page.locator('#username').fill('demo')
            page.locator('#password').fill(env['demo_password'])
            page.locator('button[type=submit]').click()
        try:
            page.get_by_role('button', name='Tesoro 10 años', exact=False).first.wait_for(timeout=45000)
        except Exception:
            page.screenshot(path=str(output / 'failure.png'))
            print(page.locator('body').inner_text()[:1200].encode('ascii', errors='replace').decode())
            raise
        assert page.get_by_role('button', name='Copiar enlace', exact=True).count() == 0
        assert page.get_by_text('CONTEXTO DE MERCADO', exact=True).count() == 0
        if args.sidebar_only:
            sidebar_checks(page, output, report)
            report.update({'browser': browser.version, 'finished_at': datetime.now(timezone.utc).isoformat(), 'exit_code': 0})
            (output / 'browser-run.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=True))
            browser.close()
            return
        page.screenshot(path=str(output / 'panorama.png'))
        page.get_by_role('button', name='Ocultar barra lateral').click()
        assert page.get_by_role('navigation', name='Navegación del espacio').count() == 0
        page.get_by_role('button', name='Mostrar barra lateral').click()
        page.keyboard.press('Control+k')
        page.get_by_role('dialog', name='Buscar en GaleCore').wait_for()
        assert page.get_by_role('textbox', name='Buscar símbolo o sección').evaluate('el => document.activeElement === el')
        page.screenshot(path=str(output / 'buscar.png'))
        page.keyboard.press('Escape')
        assert page.get_by_role('dialog', name='Buscar en GaleCore').count() == 0
        report['checks'].append('Barra única; Ctrl K abre búsqueda con foco; Escape cierra; sidebar se oculta y vuelve')
        page.get_by_role('button', name='Tesoro 10 años', exact=False).first.click()
        detail = page.get_by_role('dialog', name='Detalle de evidencia')
        detail.wait_for()
        assert detail.get_by_text('Último valor', exact=True).count() == 1
        assert detail.get_by_text('Observaciones', exact=True).count() == 0
        detail.get_by_text('Fuente, fechas y método', exact=True).click()
        page.screenshot(path=str(output / 'detalle.png'))
        page.keyboard.press('Escape')
        report['checks'].append('Detalle legible: indicador, nivel/cambio, gráfico y método desplegable; sin listado crudo')
        page.get_by_role('button', name='Expectativas y drivers', exact=True).click()
        page.screenshot(path=str(output / 'drivers.png'))
        page.get_by_role('button', name='Eventos', exact=True).click()
        if args.saved_data:
            page.goto('http://localhost:3039/?macro=events&snapshot=' + snapshot['id'], wait_until='domcontentloaded')
            page.get_by_text('Agenda de la consulta guardada', exact=False).wait_for()
        page.get_by_role('region', name='Calendario económico').wait_for()
        page.screenshot(path=str(output / 'eventos.png'))
        page.get_by_role('button', name='Mes siguiente').click()
        page.get_by_role('button', name='Hoy', exact=True).click()
        page.get_by_role('button', name='Abrir calendario', exact=True).click()
        page.locator('#lw-panel').get_by_role('region', name='Calendario económico').wait_for(timeout=45000)
        resize = page.get_by_role('separator', name='Ancho de calendario')
        resize.focus()
        resize.press('ArrowLeft')
        assert resize.get_attribute('aria-valuenow') == '440'
        page.screenshot(path=str(output / 'calendar-dock.png'))
        page.get_by_role('button', name='Resumen', exact=True).click()
        assert page.locator('#lw-panel').get_by_role('heading', name='Calendario', exact=True).is_visible()
        page.get_by_role('button', name='Cerrar calendario').click()
        page.get_by_role('button', name='Macro', exact=True).click()
        report['checks'].append('Calendario mensual; panel global conserva apertura al navegar, resize teclado y cierre')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.get_by_role('button', name='Ocultar barra lateral').click()
        page.get_by_role('button', name='Panorama', exact=True).click()
        page.screenshot(path=str(output / 'mobile.png'))
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        report['checks'].append('Móvil 390px sin overflow global; navegación ocultable y tabla desplazable')
        report['browser'] = browser.version
        browser.close()
    report.update({'finished_at': datetime.now(timezone.utc).isoformat(), 'exit_code': 0})
    (output / 'browser-run.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))


def sidebar_checks(page, output: Path, report: dict) -> None:
    assert page.get_by_role('navigation', name='Navegación del espacio').count() == 1
    page.screenshot(path=str(output / 'monitor.png'))
    mode = page.get_by_role('navigation', name='Espacios de GaleCore')
    mode.get_by_role('button', name='Lab', exact=True).click()
    page.get_by_role('button', name='Nuevo chat', exact=True).first.wait_for()
    assert page.get_by_role('navigation', name='Navegación del espacio').count() == 0
    assert page.locator('.lab-sidebar-brand').count() == 0
    assert page.get_by_role('button', name='Ocultar proyectos', exact=True).count() == 0
    assert page.locator('.workspace-logo').count() == 1
    composer = page.get_by_role('textbox', name='Mensaje al proyecto')
    composer.fill('Borrador visual de prueba; no enviado')
    page.screenshot(path=str(output / 'lab.png'))
    page.get_by_role('button', name='Ocultar barra lateral').click()
    assert not page.locator('#lab-project-sidebar').is_visible()
    assert composer.input_value() == 'Borrador visual de prueba; no enviado'
    page.get_by_role('button', name='Mostrar barra lateral').click()
    assert page.locator('#lab-project-sidebar').is_visible()
    assert composer.input_value() == 'Borrador visual de prueba; no enviado'
    composer.fill('')
    mode.get_by_role('button', name='Monitor', exact=True).click()
    assert page.get_by_role('navigation', name='Navegación del espacio').count() == 1
    page.get_by_role('button', name='Ocultar barra lateral').click()
    assert page.get_by_role('navigation', name='Navegación del espacio').count() == 0
    page.get_by_role('button', name='Mostrar barra lateral').click()
    page.set_viewport_size({'width': 390, 'height': 844})
    mode.get_by_role('button', name='Lab', exact=True).click()
    page.get_by_role('button', name='Ocultar barra lateral').click()
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path=str(output / 'lab-mobile.png'))
    report['checks'] = ['Una lateral por espacio y un logo global', 'Control superior oculta/restaura proyectos sin perder borrador; sin enviar mensajes', 'Formato lateral de Lab en Monitor; navegación conservada', 'Lab móvil sin overflow']


if __name__ == '__main__':
    main()
