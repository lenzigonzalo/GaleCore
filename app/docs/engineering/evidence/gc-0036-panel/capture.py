import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[4]
args=argparse.ArgumentParser()
args.add_argument('--credentials',type=Path,default=root/'dev/.local/env.json')
args.add_argument('--username',default='demo')
options=args.parse_args()
config=json.loads(options.credentials.read_text(encoding='utf-8-sig'))
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 page=browser.new_page(viewport={'width':1440,'height':1000})
 page.goto('http://localhost:3039',timeout=180000)
 page.get_by_label('Usuario',exact=True).fill(options.username)
 page.get_by_label('Password',exact=True).fill(config['demo_password'])
 with page.expect_response(lambda response: '/App/GaleCore/Auth/Login' in response.url) as login:
  page.get_by_role('button',name='Entrar',exact=True).click()
 if login.value.status != 200:
  print('Login Dev HTTP',login.value.status)
  browser.close()
  raise SystemExit(1)
 print('Logged in submitted',flush=True)
 page.get_by_role('button',name='Lab',exact=True).click(timeout=60000)
 print('Lab opened',flush=True)
 page.locator('.lab-sidebar-footer').get_by_role('button',name='Configuraci\u00f3n',exact=True).click()
 responses=[]
 def record(response):
  if '/App/Runtime/Performance/Panel' in response.url:
   responses.append(response)
   print('Performance HTTP',response.status,flush=True)
 page.on('response',record)
 page.get_by_role('button',name='Seguimiento SHADOW',exact=True).click()
 print('Shadow opened',flush=True)
 page.get_by_label('Estrategia',exact=True).select_option('spy_prima_varianza_30_45d',timeout=60000)
 print('Strategy selected',flush=True)
 try:
  page.get_by_text('SHADOW \u00b7 simulado',exact=True).wait_for(timeout=60000)
 except Exception:
  print('Panel state:',page.locator('.performance-panel').inner_text() if page.locator('.performance-panel').count() else page.locator('main').inner_text()[:600],flush=True)
  print('Panel responses:',[(r.status,r.url) for r in responses],flush=True)
  page.screenshot(path=str(root/'dev/.local/panel-diagnostic.png'))
  raise
 if page.get_by_role('button',name='Cerrar',exact=True).count(): page.get_by_role('button',name='Cerrar',exact=True).click()
 print('Panel data visible',flush=True)
 page.screenshot(path=str(root/'docs/engineering/evidence/gc-0036-panel/panel-dev.png'),animations='disabled',timeout=60000)
 print('Main capture saved',flush=True)
 for title,name in [('Resultado','resultado'),('Calidad','calidad'),('Riesgo','riesgo'),('D\u00f3nde gana y d\u00f3nde pierde','regimen'),('Hip\u00f3tesis','hipotesis'),('Ejecuci\u00f3n','ejecucion')]:
  page.get_by_role('heading',name=title,exact=True).evaluate('(el) => el.scrollIntoView()')
  page.screenshot(path=str(root/f'docs/engineering/evidence/gc-0036-panel/panel-dev-{name}.png'))
 print('Panel visible:',page.get_by_role('heading',name='spy_prima_varianza_30_45d',exact=True).count())
 for response in responses:
  if response.status == 200 and response.json().get('spec') == 'spy_prima_varianza_30_45d':
   (root/'docs/engineering/evidence/gc-0036-panel/panel-dev.json').write_text(json.dumps(response.json(),ensure_ascii=False,indent=2),encoding='utf-8')
   print('Panel Dev HTTP',response.status)
   (root/'docs/engineering/evidence/gc-0036-panel/panel-ui-request.json').write_text(json.dumps({'url':response.url,'status':response.status},indent=2),encoding='utf-8')
 print('Capture saved')
 browser.close()
