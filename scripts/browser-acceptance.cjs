// Real browser acceptance against the isolated validation project. Never prints credentials or tokens.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(__dirname, '../artifacts/browser-runtime');
const requireDashboard = createRequire(path.resolve(__dirname, '../dashboard/package.json'));
const { chromium } = requireDashboard('@playwright/test');
const AxeBuilder = requireDashboard('@axe-core/playwright').default;
const evidence = path.resolve(__dirname, '../artifacts/integration/browser');
fs.mkdirSync(evidence, {recursive:true});
const config = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'../artifacts/integration/.env.validation'),'utf8').split(/\r?\n/).filter(line=>line.includes('=')).map(line=>{const i=line.indexOf('='); return [line.slice(0,i),line.slice(i+1)];}));
const base = 'http://localhost:15173';
const results = {evaluatedAt:new Date().toISOString(),checks:[],screenshots:[]};
const report = () => fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(results,null,2));
async function main() {
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  const browser = await chromium.launch({headless:true,...(executablePath ? {executablePath}: {})});
  let context;
  try {
    context = await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',recordVideo:{dir:path.join(evidence,'video'),size:{width:1280,height:900}}});
    const page = await context.newPage();
    const runtimeErrors=[];page.on('pageerror',e=>runtimeErrors.push(e.message));
    const failedApiRequests=[];results.failedApiRequests=failedApiRequests;page.on('response',response=>{if(response.url().includes('/api/') && response.status()>=400) failedApiRequests.push({path:new URL(response.url()).pathname,status:response.status()});});
    await page.goto(`${base}/login`);
    await page.getByLabel('Username',{exact:true}).fill('demo.administrator');
    await page.getByLabel('Password',{exact:true}).fill(config.DEMO_USER_PASSWORD);
    await page.getByLabel('Password',{exact:true}).press('Enter');
    await page.waitForURL('**/overview');
    await page.getByRole('heading',{name:'Freight, in motion.'}).waitFor({timeout:15000});
    const integration=JSON.parse(fs.readFileSync(path.resolve(evidence,'../report.json'),'utf8'));
    const contractId=integration.scenarios.late.id;
    const routes=['overview','orders','allocations','plans','ai-lab','blockchain','contracts',`contracts/${contractId}`,'audit','admin','admin/resources'];
    const titles={'overview':'Freight, in motion.','orders':'Freight orders','allocations':'Set the freight in motion.','plans':'Plans that stay with you.','ai-lab':'Inside the allocation','blockchain':'Freight leaves a trace.','contracts':'Every handoff, recorded.',[`contracts/${contractId}`]:`Contract ${contractId}`,'audit':'Every action, accounted for.','admin':'People & access','admin/resources':'Keep the yard ready.'};
    for(const width of [375,768,1280]) {
      await page.setViewportSize({width,height:900});
      for(const route of routes) {
        await page.locator(`${route.startsWith('contracts/') ? 'main' : '.workspace-nav'} a[href="/${route}"]`).click();
        await page.getByRole('heading',{name:titles[route],exact:true}).waitFor({timeout:20000});
        await page.waitForFunction(()=>!document.querySelector('main .loading-state,main .loading-panel'),{},{timeout:15000}).catch(()=>{});
        // Wait on real page content, not a fixed animation sleep.
        if(route==='blockchain') await page.getByRole('heading',{name:'Inside block',exact:false}).waitFor({timeout:30000});
        if(route==='ai-lab') await page.getByRole('heading',{name:'How accurate is the model?',exact:true}).waitFor({timeout:15000});
        const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
        const shot=`${route.replaceAll('/','-')}-${width}.png`;
        await page.screenshot({path:path.join(evidence,shot),fullPage:true});results.screenshots.push(shot);
        const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
        const violations=a11y.violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}));
        results.checks.push({route,width,overflow,violations}); report();
      }
    }
    // A real local block is appended and inspected; replay uses captured headers.
    await page.goto(`${base}/blockchain`);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.getByRole('heading',{name:'Inside block',exact:false}).waitFor({timeout:30000});
    const headBefore=Number((await page.locator('.ledger-status').innerText()).match(/head #([\d,]+)/)[1].replaceAll(',',''));
    await page.getByRole('button',{name:'Add demonstration block',exact:true}).click();
    await page.waitForFunction(before=>Number(document.querySelector('.ledger-status').textContent.match(/head #([\d,]+)/)[1].replaceAll(',',''))>before,headBefore,{timeout:15000});
    await page.getByRole('button',{name:'Replay this window',exact:true}).click();
    await page.getByText(/Replay · 1 of/).waitFor();
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    await page.getByRole('button',{name:'Latest blocks',exact:true}).click();
    results.checks.push({name:'Local block creation, replay, pause and return to live',passed:true});
    // Keyboard navigation reaches the protected workspace and a primary workflow.
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByLabel('Username',{exact:true}).fill('demo.shipper');
    await page.getByLabel('Password',{exact:true}).fill(config.DEMO_USER_PASSWORD);
    await page.getByLabel('Password',{exact:true}).press('Enter'); await page.waitForURL('**/overview');
    await page.emulateMedia({reducedMotion:'reduce'});
    for (const width of [375,768,1280]) {
      await page.setViewportSize({width,height:900}); await page.goto(`${base}/contracts/${contractId}`);
      await page.getByRole('heading',{name:'Settlement breakdown',exact:true}).waitFor({timeout:15000});
      const shot=`shipper-settlement-${width}.png`; await page.screenshot({path:path.join(evidence,shot),fullPage:true}); results.screenshots.push(shot);
      const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
      results.checks.push({route:'shipper-settlement',width,overflow,violations:a11y.violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))});
    }
    await page.goto(`${base}/overview`);
    await page.getByRole('link',{name:'Freight orders',exact:true}).focus(); await page.keyboard.press('Enter'); await page.waitForURL('**/orders');
    await page.getByLabel('Cargo type',{exact:true}).fill('grain');
    await page.getByLabel(/Quantity/).fill('20');
    await page.getByLabel('Destination',{exact:true}).fill('Port-A');
    const chainRead=await fetch('http://localhost:18545',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBlockByNumber',params:['latest',false]})});
    const chainNow=Number(BigInt((await chainRead.json()).result.timestamp));
    const due=new Date(Math.max(Date.now(),chainNow*1000)+7*86400000);
    await page.getByLabel('Required by',{exact:true}).fill(new Date(due.getTime()-due.getTimezoneOffset()*60000).toISOString().slice(0,16));
    await page.getByRole('button',{name:/Queue order/}).focus(); await page.keyboard.press('Enter');
    await page.getByText(/is in the queue/).waitFor({timeout:15000});
    await page.getByRole('link',{name:'Allocations',exact:true}).focus(); await page.keyboard.press('Enter'); await page.waitForURL('**/allocations');
    await page.getByRole('button',{name:/Run allocation/}).focus(); await page.keyboard.press('Enter');
    await page.getByRole('heading',{name:'A route worth taking.'}).waitFor({timeout:70000});
    await page.getByLabel('Registered carrier',{exact:true}).selectOption({label:'demo.carrier · 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'});
    await page.getByRole('button',{name:/Accept & create contract/}).focus(); await page.keyboard.press('Enter');
    await page.waitForURL('**/contracts/*',{timeout:60000});
    results.checks.push({name:'Keyboard login → order → allocation → acceptance → contract',passed:true});
    assert.deepEqual(runtimeErrors,[],'Browser runtime errors');
    const problems=results.checks.filter(check=>check.overflow && (check.overflow.document>check.overflow.viewport+1 || check.violations.length));
    assert.deepEqual(problems,[],'Responsive/accessibility findings (see browser/report.json)');
    results.runtimeErrors=runtimeErrors;results.passed=true; report();
    results.failedApiRequests=failedApiRequests;report();
    console.log(`PASS browser acceptance: ${results.checks.length} checks, ${results.screenshots.length} screenshots`);
  } finally {await context?.close();await browser.close();}
}
main().catch(error=>{results.failure=error.message;report();console.error(error.message);process.exitCode=1;});
