import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[5]
sys.stdout.reconfigure(encoding='utf-8')
out=root/'docs/engineering/evidence/WS-0036/menu'
out.mkdir(parents=True,exist_ok=True)
config=json.loads((root/'dev/.local/env.json').read_text(encoding='utf-8-sig'))
report={'origin':'http://localhost:3039','viewports':[]}
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='msedge',headless=True)
 context=browser.new_context()
 for width in [1280,760]:
  page=context.new_page()
  page.set_viewport_size({'width':width,'height':820})
  errors=[]
  page.on('pageerror',lambda error: errors.append(str(error)))
  page.goto('http://localhost:3039',timeout=180000)
  if width==1280:
   page.get_by_label('Usuario',exact=True).fill('demo')
   page.get_by_label('Password',exact=True).fill(config['demo_password'])
   with page.expect_response(lambda response:'/App/GaleCore/Auth/Login' in response.url) as login:
    page.get_by_role('button',name='Entrar',exact=True).click()
   assert login.value.status==200,f'Login HTTP {login.value.status}'
  print(f'{width}: sesión Dev',flush=True)
  nav=page.get_by_role('navigation',name='Navegación del espacio')
  nav.get_by_role('button',name='Inicio',exact=True).wait_for(timeout=90000)
  page.get_by_role('button',name='Abrir avisos',exact=True).click()
  page.get_by_role('region',name='Avisos del supervisor').wait_for()
  page.get_by_role('button',name='Cerrar avisos',exact=True).click()
  nav.get_by_role('button',name='Posiciones',exact=True).click()
  page.locator('.workspace-portfolio-summary').wait_for()
  nav.get_by_role('button',name='Estrategias',exact=True).click()
  page.get_by_role('button',name='spy_prima_varianza_30_45d',exact=True).wait_for(timeout=90000)
  print(f'{width}: lista real de estrategias',flush=True)
  page.screenshot(path=str(out/f'estrategias-{width}.png'))
  page.get_by_role('button',name='spy_prima_varianza_30_45d',exact=True).click()
  page.get_by_role('button',name='Abrir en el chat',exact=True).wait_for(timeout=90000)
  page.get_by_role('button',name='Abrir en el chat',exact=True).click()
  page.get_by_role('button',name='Ver seguimiento',exact=True).wait_for(timeout=90000)
  assert nav.get_by_role('button',name='Estrategias',exact=True).is_visible()
  assert page.locator('.workspace-navigation').count()==1
  page.get_by_role('button',name='Ver seguimiento',exact=True).click()
  page.get_by_role('heading',name='spy_prima_varianza_30_45d',exact=True).wait_for()
  if width==1280:
   with page.expect_response(lambda response:'/App/Runtime/Performance/Data' in response.url) as response:
    page.get_by_role('tab',name='Datos',exact=True).click()
   print('Datos reales HTTP',response.value.status,flush=True)
   assert response.value.status==200
   page.get_by_role('tab',name='Resumen',exact=True).click()
  page.get_by_role('button',name='Configuración',exact=True).click()
  dialog=page.get_by_role('dialog',name='Configuración',exact=True)
  dialog.wait_for()
  for name in ['General','Conexiones','Mi trading','Conocimiento','Equipo']:
   dialog.get_by_role('button',name=name,exact=True).click()
  dialog.get_by_role('button',name='General',exact=True).click()
  if width==1280: page.screenshot(path=str(out/'configuracion.png'))
  page.keyboard.press('Escape')
  assert not dialog.is_visible()
  nav.get_by_role('button',name='Mercado',exact=True).click()
  page.get_by_text('Cargando reglas de GEX…',exact=True).wait_for(state='hidden',timeout=90000)
  page.get_by_role('button',name='Abrir chat dividido',exact=True).click()
  page.locator('.workspace-terminal').wait_for()
  print(f'{width}: chat dividido abierto',flush=True)
  separator=page.get_by_role('separator',name='Ancho del chat dividido')
  separator.focus();page.keyboard.press('ArrowLeft')
  main=page.locator('.dashboard-main').bounding_box()
  term=page.locator('.workspace-terminal').bounding_box()
  assert main['x']+main['width'] <= term['x']+2,(main,term)
  assert main['width']>=260 and term['width']>=260,(main,term)
  page.screenshot(path=str(out/f'mercado-chat-{width}.png'))
  page.get_by_role('button',name='Ocultar chat dividido',exact=True).first.click()
  page.keyboard.press('Control+k')
  command=page.get_by_role('dialog')
  assert command.get_by_role('button',name='Chat',exact=True).is_visible()
  page.keyboard.press('Escape')
  overflow=page.evaluate('({width: innerWidth, body:document.body.scrollWidth, root:document.documentElement.scrollWidth})')
  report['viewports'].append({'width':width,'flow':'Inicio → Avisos → Posiciones → Estrategias → spy → Chat → seguimiento → Configuración → Mercado/chat dividido → Ctrl K','navigationCount':page.locator('.workspace-navigation').count(),'mainWidthWithChat':main['width'],'chatWidth':term['width'],'overflow':overflow,'pageErrors':errors})
  print(json.dumps(report['viewports'][-1],ensure_ascii=False),flush=True)
  page.close()
 browser.close()
(out/'recorrido.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
