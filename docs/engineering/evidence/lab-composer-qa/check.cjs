const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createRequire } = require('module');
const qa = createRequire(path.resolve('.tmp/lab-ui-qa/package.json'));
const { chromium } = qa('playwright');
const esbuild = qa('esbuild');
const front = path.resolve(__dirname,'../../../../source/galecore-monitor');
const frontRequire = createRequire(path.join(front, 'package.json'));
const out = path.resolve('.tmp/lab-composer-qa');
(async () => {
  await esbuild.build({ entryPoints: [path.join(__dirname,'entry.tsx')], outfile:path.join(out,'preview.js'), bundle:true,
    nodePaths:[path.join(front,'node_modules')], define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},
    plugins:[{name:'isolated-lab', setup(build) { build.onResolve({filter:/api\/lab$/},()=>({path:path.join(__dirname,'api.ts')})); }}] });
  const config = frontRequire('./tailwind.config.js');
  config.content = [path.join(front,'src/**/*.{ts,tsx}')];
  const source = fs.readFileSync(path.join(front,'src/index.css'),'utf8').replace(/@import\s+url\([^)]*\);/g,'');
  const css = await frontRequire('postcss')([frontRequire('tailwindcss')(config)]).process(source,{from:path.join(front,'src/index.css')});
  const saved = JSON.parse(fs.readFileSync('tools/terminal/.local/chats/53992633-8f70-4837-8681-bbe3b5dfebab.json','utf8'));
  const text = saved.messages.find(m=>m.text.includes('Como idea vale')).text;
  const chat = {id:'qa-chat',project:'personal',provider:'claude',title:'Respuesta guardada · QA aislada',state:'idle',activity:'',error:null,
    messages:Array.from({length:12},(_,i)=>({id:'qa-'+i,role:'assistant',text:i===11?text:'QA de scroll, sin datos financieros.\n\n'+('Texto de prueba de lectura. '.repeat(24)),at:''}))};
  const fixture = {chat,state:{projects:[{id:'personal',label:'Personal · QA aislada',type:'personal'},{id:'qa-other',label:'Otro proyecto · QA',type:'analysis'}],
    chats:[{...chat,messages:undefined}],providers:[{id:'claude',label:'Claude Code',installed:true}],chatOptions:{claude:{models:['sonnet'],efforts:['medium']}}}};
  fs.writeFileSync(path.join(out,'theme.css'),css.css+'\n'+fs.readFileSync(path.join(front,'src/pages/Lab.css'),'utf8'));
  fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\'; connect-src \'none\'; img-src \'none\'"><title>Lab · Preview aislada de la primera tajada</title><link rel="stylesheet" href="theme.css"><div id="root" style="height:100vh"></div><script>window.__LAB_FIXTURE__='+JSON.stringify(fixture).replace(/</g,'\\u003c')+';sessionStorage.setItem("galecore:lab:project","personal");sessionStorage.setItem("galecore:lab:chat","qa-chat");</script><script src="preview.js"></script></html>');
  const browser = await chromium.launch({headless:true,executablePath:'C:/Users/lenzi/AppData/Local/ms-playwright/chromium-1091/chrome-win/chrome.exe'});
  try {
    const page = await browser.newPage({viewport:{width:1600,height:1000}});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url()==='http://localhost:3039/qa-isolated' ? route.fulfill({contentType:'text/html',body:'<html lang="es"><meta charset="utf-8"><title>QA aislada del Lab</title><div id="root" style="height:100vh"></div></html>'}) : route.abort());
    await page.goto('http://localhost:3039/qa-isolated');
    await page.evaluate(f=>{window.__LAB_FIXTURE__=f;sessionStorage.setItem('galecore:lab:chat','qa-chat');},fixture);
    await page.addStyleTag({content:css.css+'\n'+fs.readFileSync(path.join(front,'src/pages/Lab.css'),'utf8')});
    await page.addScriptTag({path:path.join(out,'preview.js')});
    await page.locator('article table').waitFor({state:'attached',timeout:10000}).catch(async error=>{
      console.log(JSON.stringify({errors,articles:await page.locator('article').count(),alerts:await page.getByRole('alert').allTextContents()}));
      await page.screenshot({path:path.join(out,'failure.png')}); throw error;
    });
    const textarea=page.getByLabel('Mensaje al proyecto');
    await textarea.click();
    const focus = await textarea.evaluate(el=>({outline:getComputedStyle(el).outlineStyle,shadow:getComputedStyle(el).boxShadow,parent:getComputedStyle(el.parentElement).outlineColor,resize:getComputedStyle(el).resize,height:el.clientHeight}));
    assert.equal(focus.outline,'none'); assert.equal(focus.shadow,'none'); assert.equal(focus.parent,'rgb(182, 182, 176)'); assert.equal(focus.resize,'none'); assert.equal(focus.height,28);
    const compact = await page.locator('.lab-chat-composer').evaluate(el=>({height:el.offsetHeight,width:el.offsetWidth,font:getComputedStyle(el.querySelector('textarea')).fontSize}));
    const availableWidth=await page.locator('.lab-chat-main').evaluate(el=>el.clientWidth);
    assert.ok(compact.height<=100); assert.equal(compact.width,availableWidth-56); assert.equal(compact.font,'16px');
    const layout=await page.evaluate(()=>({
      modeBar:document.querySelector('.lab-mode-bar').getBoundingClientRect().height,
      titleBar:document.querySelector('.lab-chat-header').getBoundingClientRect().height,
      messageWidth:document.querySelector('.lab-message.assistant').getBoundingClientRect().width,
      messageFont:getComputedStyle(document.querySelector('.lab-message > div')).fontSize
    }));
    assert.ok(layout.modeBar<=52); assert.ok(layout.titleBar<=52); assert.equal(layout.messageWidth,availableWidth-56); assert.equal(layout.messageFont,'18px');
    const account=page.getByRole('button',{name:'MI CUENTA',exact:true});
    await account.focus(); await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor();
    assert.ok(await page.getByRole('menu').evaluate(el=>{const box=el.getBoundingClientRect();return box.top>=0&&box.left>=0&&box.right<=innerWidth;}));
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('menu').count(),0);
    assert.equal(await page.locator('.lab-message > div').last().evaluate(el=>getComputedStyle(el).fontSize),'18px');
    await page.screenshot({path:path.join(out,'desktop.png')});
    const resize=page.getByRole('separator',{name:'Ancho de proyectos'});
    let handle=await resize.boundingBox();
    await page.mouse.move(handle.x+handle.width/2,200); await page.mouse.down();
    await page.mouse.move(400,200,{steps:5}); await page.mouse.up();
    assert.equal(await page.locator('.lab-chat-sidebar').evaluate(el=>el.offsetWidth),400);
    assert.equal(await page.evaluate(()=>localStorage.getItem('galecore:lab:sidebar-width')),'400');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.evaluate(f=>{window.__LAB_FIXTURE__=f;},fixture);
    await page.addStyleTag({content:css.css+'\n'+fs.readFileSync(path.join(front,'src/pages/Lab.css'),'utf8')});
    await page.addScriptTag({path:path.join(out,'preview.js')});
    await page.waitForFunction(()=>document.querySelector('.lab-chat-sidebar')?.offsetWidth===400);
    await resize.focus(); await page.keyboard.press('ArrowLeft');
    assert.equal(await resize.getAttribute('aria-valuenow'),'390');
    await page.keyboard.press('Shift+ArrowRight'); assert.equal(await resize.getAttribute('aria-valuenow'),'430');
    await page.keyboard.press('Home'); assert.equal(await page.locator('.lab-chat-sidebar').evaluate(el=>el.offsetWidth),200);
    await page.keyboard.press('End'); assert.equal(await page.locator('.lab-chat-sidebar').evaluate(el=>el.offsetWidth),480);
    await page.getByRole('button',{name:'Ocultar proyectos'}).click();
    assert.equal(await page.locator('.lab-chat-sidebar').evaluate(el=>el.offsetWidth),64);
    await page.getByRole('button',{name:'Mostrar proyectos'}).click();
    assert.equal(await page.locator('.lab-chat-sidebar').evaluate(el=>el.offsetWidth),480);
    await resize.dblclick(); assert.equal(await resize.getAttribute('aria-valuenow'),'310');
    await resize.evaluate(el=>el.addEventListener('pointerdown',e=>window.__QA_POINTER_ID__=e.pointerId,{once:true}));
    handle=await resize.boundingBox();
    await page.mouse.move(handle.x+handle.width/2,200); await page.mouse.down();
    await page.mouse.move(350,200,{steps:3});
    await resize.evaluate(el=>el.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:window.__QA_POINTER_ID__})));
    await page.mouse.move(450,200); await page.mouse.up();
    assert.equal(await resize.getAttribute('aria-valuenow'),'350');
    await resize.dblclick();
    const settings=page.getByLabel('Modelo y esfuerzo',{exact:true});
    await settings.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.lab-chat-composer').evaluate(el=>el.offsetHeight),compact.height);
    await page.getByLabel('Modelo de la conversación').waitFor();
    assert.ok(await page.locator('.lab-settings-panel').evaluate(el=>el.getBoundingClientRect().top>=0));
    await page.screenshot({path:path.join(out,'settings.png')});
    await settings.focus(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.lab-chat-settings').getAttribute('open'),null);
    await textarea.fill(Array.from({length:15},(_,i)=>'Línea de dictado revisable '+i).join('\n'));
    assert.ok(await textarea.evaluate(el=>el.clientHeight<=168 && el.scrollHeight>el.clientHeight));
    await textarea.fill('Borrador personal');
    await page.getByRole('button',{name:'Otro proyecto · QA',exact:true}).click();
    await textarea.fill('Borrador del otro proyecto');
    await page.getByRole('button',{name:'Personal · QA aislada',exact:true}).click();
    assert.equal(await textarea.inputValue(),''); // borrador nuevo separado del chat existente
    await page.getByRole('button',{name:'Respuesta guardada · QA aislada',exact:true}).click();
    assert.equal(await textarea.inputValue(),'Borrador personal');
    await page.locator('article table').waitFor({state:'attached'});
    await page.locator('.lab-messages').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
    await page.getByRole('button',{name:'Ir al último mensaje'}).waitFor();
    await page.evaluate(()=>window.__LAB_FIXTURE__.chat.messages.push({id:'qa-new',role:'assistant',text:'Nueva actualización de QA.',at:''}));
    await page.getByText('Nueva actualización de QA.',{exact:true}).waitFor();
    assert.equal(await page.locator('.lab-messages').evaluate(el=>el.scrollTop),0);
    await page.getByRole('button',{name:'Ir al último mensaje'}).click();
    assert.ok(await page.locator('.lab-messages').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<2));
    await textarea.fill(''); await textarea.focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY');
    await page.keyboard.press('Shift+Tab'); assert.equal(await textarea.evaluate(el=>el===document.activeElement),true);
    await page.getByRole('button',{name:'Crear proyecto'}).click();
    const name=page.getByPlaceholder('Estrategia SPY'); await name.click();
    const inputFocus=await name.evaluate(el=>({outline:getComputedStyle(el).outlineColor,shadow:getComputedStyle(el).boxShadow}));
    assert.equal(inputFocus.outline,'rgb(182, 182, 176)'); assert.equal(inputFocus.shadow,'none');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SELECT');
    await page.screenshot({path:path.join(out,'fields.png')});
    await page.keyboard.press('Escape');
    await textarea.fill('Un borrador que se adapta al espacio disponible sin recortar líneas mientras cambiamos el ancho de la ventana y abrimos o cerramos los proyectos.');
    const wideHeight = await textarea.evaluate(el=>el.clientHeight);
    for (const width of [900,390]) {
      await page.setViewportSize({width,height:844});
      await page.waitForFunction(()=>{const el=document.querySelector('textarea');return el.clientHeight>=Math.min(el.scrollHeight,168)-2;});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await account.click();
      assert.ok(await page.getByRole('menu').evaluate(el=>{const box=el.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;}));
      await page.keyboard.press('Escape');
      const closedHeight=await page.locator('.lab-chat-composer').evaluate(el=>el.offsetHeight);
      await settings.click();
      assert.equal(await page.locator('.lab-chat-composer').evaluate(el=>el.offsetHeight),closedHeight);
      assert.ok(await page.locator('.lab-settings-panel').evaluate(el=>{const box=el.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.top>=0;}));
      await settings.focus(); await page.keyboard.press('Escape');
      await page.screenshot({path:path.join(out,'width-'+width+'.png')});
      await page.getByRole('button',{name:'Ocultar proyectos'}).click();
      await page.waitForFunction(()=>{const el=document.querySelector('textarea');return el.clientHeight>=Math.min(el.scrollHeight,168)-2;});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(out,'collapsed-'+width+'.png')});
      await page.getByRole('button',{name:'Mostrar proyectos'}).click();
    }
    assert.ok(await textarea.evaluate(el=>el.clientHeight)>wideHeight);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({focus,compact,layout,inputFocus,errors,checks:'barras <=52px, mensajes y caja al ancho disponible, tipografía conservada, sidebar arrastre/teclado/persistencia/límites/colapsado, settings, autofit, borradores, scroll, 900/390px',scope:'Lab y WorkspaceHeader reales, API sustituida y red bloqueada; no E2E autenticado.'},null,2));
    console.log('PASS: caja compacta, misma letra, sidebar ajustable/persistido, autofit, foco, borradores, scroll, teclado, responsive. Sin escrituras/inferencias.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
