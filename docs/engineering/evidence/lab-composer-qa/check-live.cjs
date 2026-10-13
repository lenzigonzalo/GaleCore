const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { chromium } = createRequire(path.resolve('.tmp/lab-ui-qa/package.json'))('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Users/lenzi/AppData/Local/ms-playwright/chromium-1091/chrome-win/chrome.exe'});
  try {
    const page=await browser.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://localhost:3039/',{waitUntil:'domcontentloaded'});
    await page.getByText('Entrar',{exact:true}).waitFor({timeout:30000});
    const asset=await page.request.get('http://localhost:3039/static/js/bundle.js');
    const bundle=await asset.text();
    const live={http:asset.status(),newComposer:bundle.includes('lab-jump-latest'),wideComposer:bundle.includes('max-width: 960px; width: calc(100% - 56px)'),wideMessages:bundle.includes('calc((100% - 1024px) / 2)'),compactHeader:bundle.includes('lab-mode-bar'),compactToolbar:bundle.includes('lab-composer-toolbar'),resizableSidebar:bundle.includes('lab-sidebar-resize'),resizeObserver:bundle.includes('observer.observe(element)'),errors,scope:'Login y bundle servido; no E2E autenticado.'};
    fs.writeFileSync('.tmp/lab-composer-qa/live-result.json',JSON.stringify(live,null,2));
    console.log(JSON.stringify(live));
    if(!asset.ok()||!live.newComposer||!live.wideComposer||!live.wideMessages||!live.compactHeader||!live.compactToolbar||!live.resizableSidebar||errors.length)process.exitCode=1;
    await page.goto('http://127.0.0.1:3041/',{waitUntil:'domcontentloaded'});
    await page.getByLabel('Mensaje al proyecto').waitFor();
    if(errors.length)throw new Error(errors.join('; '));
    console.log('Preview interactiva HTTP 200, Lab aislado visible.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
