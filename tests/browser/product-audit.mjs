import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'
const origin=process.env.DOSTIGATOR_TEST_ORIGIN || 'http://127.0.0.1:4210'
const output=resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT || '.cache/product-audit')
await mkdir(output,{recursive:true})
const engine=process.env.DOSTIGATOR_BROWSER==='webkit'?webkit:chromium
const browser=await engine.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})})
const result={checks:[],screens:[],pageErrors:[],consoleErrors:[],responses:[],failedRequests:[],domErrors:[],expectedCancellations:[],failures:[]}
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
const page=await context.newPage()
await page.exposeFunction('__auditDomError',entry=>result.domErrors.push(entry))
await page.addInitScript(()=>{for(const type of ['error','unhandledrejection'])window.addEventListener(type,event=>{void window.__auditDomError({type,message:event.message??String(event.reason),url:location.href}).catch(()=>{})})})
page.on('requestfailed',request=>result.failedRequests.push({url:request.url(),error:request.failure()?.errorText}))
page.on('pageerror',error=>result.pageErrors.push({message:error.message,stack:error.stack,url:page.url(),lastCheck:result.checks.at(-1)}))
page.on('console',message=>{if(message.type()==='error')result.consoleErrors.push(message.text())})
page.on('response',response=>{if(response.status()>=400)result.responses.push({status:response.status(),url:response.url()})})
page.on('dialog',dialog=>dialog.accept())
const check=(name,condition=true)=>{assert.ok(condition,name);result.checks.push(name);console.log('PASS '+name)}
const screenshot=async(name)=>{
 const viewport=page.viewportSize();const modal=await page.getByRole('dialog').count()
 for(const width of modal?[375,390,430,768,1280]:[viewport.width]){
  if(modal)await page.setViewportSize({...viewport,width})
  const file=modal?name.replace(/^\d+-/,width+'-'):name
  await page.screenshot({path:resolve(output,file+'.png'),fullPage:!modal,animations:'disabled'})
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)
  assert.equal(overflow,0,'horizontal overflow: '+file);result.screens.push(file)
 }
 if(modal)await page.setViewportSize(viewport)
}

let apiOffline=false
const mode=async(value)=>{await fetch((process.env.DOSTIGATOR_API_ORIGIN||origin)+'/__test/mode?value='+value);apiOffline=value==='offline'}
const settle=async()=>{await page.locator('h1').first().waitFor();await page.locator('.loading-screen').waitFor({state:'hidden'});if(!apiOffline)await page.waitForLoadState('networkidle')}
const visit=async(url)=>{if(page.url()!=='about:blank')await settle();await page.goto(url);await settle()}
const reload=async()=>{await settle();await page.reload();await settle()}
const login=async()=>{await visit(origin+'/__test/login');await page.waitForURL('**/training');await page.getByRole('heading',{name:/Привет/}).waitFor()}
const start=async(code)=>{await visit(origin+'/training/workout/'+code);if(code==='C')for(const input of await page.locator('.preparation-step input[type=checkbox]').all())await input.check();await page.getByRole('button',{name:code==='C'?'Начать выбранные упражнения':'Начать тренировку',exact:true}).click();await page.locator('.active-set').waitFor()}
async function recordAll() {
 for(let guard=0;guard<40;guard++){
  const record=page.getByRole('button',{name:/^Записать подход /})
  if(!await record.count())break
  const active=page.locator('.active-set');const weight=active.getByRole('spinbutton',{name:/вес кг/});if(await weight.isVisible())await weight.fill('10')
  const reps=active.getByRole('spinbutton',{name:/повторы|секунды/});await reps.fill('10')
  await record.waitFor({state:'visible'});await record.click();await page.waitForTimeout(750)
 }
}
try {
 await login();check('real application loads with isolated test identity')
 await start('A');check('A starts without readiness or RIR')
 await screenshot('390-active-A')
 const help=page.getByRole('button',{name:'Как делать',exact:true});await help.click()
 check('technique dialog opens and background is inert',await page.locator('#root').evaluate(e=>e.inert))
 await screenshot('390-technique');await page.keyboard.press('Escape');check('technique closes and focus returns',await help.evaluate(e=>e===document.activeElement))
 await page.getByRole('button',{name:/^Упражнение 1 из/}).click();await screenshot('390-exercise-list');await page.getByRole('dialog').getByRole('button',{name:/2\./}).click()
 check('exercise list opens the chosen exercise',(await page.locator('.exercise-card h2').innerText()).length>0)
 await page.getByRole('button',{name:/^Упражнение 2 из/}).click();await page.getByRole('dialog').getByRole('button',{name:/1\./}).click()
 await page.getByRole('spinbutton',{name:/подход 1, вес/}).fill('42.5');await page.getByRole('spinbutton',{name:/подход 1, повторы/}).fill('11')
 await reload();check('unrecorded weight/reps survive reload',(await page.getByRole('spinbutton',{name:/подход 1, вес/}).inputValue())==='42.5')
 await page.getByRole('button',{name:'Пропустить этот подход',exact:true}).click();await page.getByRole('button',{name:/Подход 1 · пропущен/}).click();await page.getByRole('button',{name:'Вернуть подход',exact:true}).click();check('skip and restore never create a fake completion')
 await page.getByRole('spinbutton',{name:/подход 1, вес/}).fill('40');await page.getByRole('button',{name:/^Записать подход 1/}).click();await page.waitForTimeout(750)
 await page.getByRole('button',{name:/^Начать отдых/}).click();await screenshot('390-rest');await page.getByRole('button',{name:'Пропустить отдых',exact:true}).click();check('manual rest starts and ends')
 await page.getByRole('button',{name:/Подход 1 · записан/}).click();await page.getByRole('spinbutton',{name:/подход 1, повторы/}).fill('9');await page.getByRole('button',{name:/^Сохранить исправление/}).click();check('recorded fact can be corrected during workout')
 await page.getByText('Автоотдых и самочувствие',{exact:true}).click();await page.getByRole('checkbox',{name:'Автоматически запускать отдых после подхода'}).check()
 await page.getByRole('spinbutton',{name:/подход 2, вес/}).fill('10');await page.getByRole('spinbutton',{name:/подход 2, повторы/}).fill('10')
 await page.getByRole('button',{name:/^Записать подход 2/}).click();await page.locator('.rest-timer').waitFor();await page.clock.install();await page.clock.fastForward(125000)
 await page.getByText('Отдых закончен',{exact:true}).waitFor();check('automatic rest expires');await page.getByRole('button',{name:'Пропустить отдых'}).click();await page.clock.resume()
 await page.getByRole('checkbox',{name:'Автоматически запускать отдых после подхода'}).uncheck()
 await recordAll();check('all 15 A work sets completed through UI',(await page.locator('.workout-progress-panel strong').innerText()).startsWith('15 / 15'))
 await screenshot('390-strength-complete')
 await page.getByRole('link',{name:'Перейти к кардио',exact:true}).click();await page.getByRole('button',{name:'Уже сделал · записать время'}).click()
 await page.getByRole('spinbutton',{name:'Фактическое время, мин',exact:true}).fill('20');await page.getByRole('spinbutton',{name:'Фактическое время, секунды',exact:true}).fill('17')
 await page.getByRole('button',{name:'Сохранить кардио',exact:true}).click();await page.getByRole('heading',{name:'Кардио сохранено',exact:true}).waitFor();await screenshot('390-cardio-saved')
 check('linked cardio saved with exact 20:17')
 await page.getByRole('link',{name:'Вернуться к силовой и завершить'}).click();await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click();await screenshot('390-finish-A')
 await page.getByRole('button',{name:'Сохранить тренировку',exact:true}).click();await page.waitForURL('**/training/history?finished=*');await page.getByText('Синхронизировано с сервером',{exact:true}).first().waitFor();check('A completion reaches synced history with result')
 await reload();await page.getByRole('button',{name:/Исправить .*подход 1/}).first().waitFor();await screenshot('390-history-before-correction')
 const edit=page.getByRole('button',{name:/Исправить .*подход 1/}).first();await edit.click();await page.getByRole('spinbutton',{name:'Исправленный вес, кг'}).fill('45')
 await screenshot('390-history-correction');await page.getByRole('button',{name:'Закрыть',exact:true}).last().click();await edit.click()
 check('history correction input survives closing dialog',(await page.getByRole('spinbutton',{name:'Исправленный вес, кг'}).inputValue())==='45')
 await page.getByRole('button',{name:'Сохранить исправление',exact:true}).click();await page.getByText('Подход исправлен. Итог и статистика пересчитаны.',{exact:true}).waitFor();check('completed workout correction saved without duplicate session')
 await reload();await screenshot('390-history-after-correction');check('corrected history survives reload',(await page.locator('.history-detail').innerText()).includes('45 кг'))
 await start('B');await recordAll();check('all 15 B work sets completed through UI',(await page.locator('.workout-progress-panel strong').innerText()).startsWith('15 / 15'))
 await page.getByRole('button',{name:'Завершить',exact:true}).click();await page.getByRole('button',{name:'Сохранить тренировку',exact:true}).click();await page.waitForURL('**/training/history?finished=*');check('B finishes without mandatory cardio or RIR')
 await start('C');await recordAll();await page.getByRole('button',{name:'Завершить',exact:true}).click();await page.getByRole('button',{name:'Сохранить тренировку',exact:true}).click();await page.waitForURL('**/training/history?finished=*');check('C selected optional exercise completes without changing program')
 await start('A');await page.getByRole('spinbutton',{name:/подход 1, вес/}).fill('35');await page.getByRole('button',{name:/^Записать подход 1/}).click();await page.waitForTimeout(900)
 await mode('offline');await reload();await page.getByRole('spinbutton',{name:/подход 2, вес/}).waitFor();check('active workout resumes while API returns 503')
 await page.getByRole('spinbutton',{name:/подход 2, вес/}).fill('37.5');await page.getByRole('button',{name:/^Записать подход 2/}).click();await page.waitForTimeout(750);await screenshot('390-api-offline')
 await mode('online');await page.getByRole('button',{name:'Повторить синхронизацию',exact:true}).click();await page.getByText('Сохранено в облаке',{exact:true}).waitFor();check('reconnect retries saved sets')
 await page.getByRole('button',{name:'Отменить тренировку',exact:true}).click();await screenshot('390-cancel');await page.getByRole('dialog').getByRole('button',{name:'Отменить тренировку',exact:true}).click();await page.waitForURL('**/training');check('cancel removes only unfinished session and preserves finished history')
 await visit(origin+'/training/workout/C');await page.getByRole('link',{name:'Перейти к кардио · 30–45 минут'}).click();check('C cardio-only route shows optional day plan',(await page.locator('body').innerText()).includes('30'))
 const routes=['/','/training','/training/workout/A','/training/workout/B','/training/workout/C','/training/history','/training/progress','/training/body','/training/cardio','/training/spa','/progress','/review','/journal','/history','/settings','/nutrition','/onboarding']
 for(const width of [375,390,430,768,1280]){
  await page.setViewportSize({width,height:844})
  for(const route of routes){await visit(origin+route);await page.locator('h1').first().waitFor();await page.locator('.loading-screen').waitFor({state:'hidden'});await page.waitForLoadState('networkidle');const name=(route==='/'?'home':route.slice(1).replaceAll('/','-'));await screenshot(`${width}-${name}`)}
  check(`${width}px: all ${routes.length} routes render without horizontal overflow`)
 }
 const unexpected=result.pageErrors.filter(error=>{const cancelled=engine===webkit && error.message.includes('access control checks') && result.failedRequests.some(request=>request.error==='cancelled' && error.stack.includes(request.url));if(cancelled)result.expectedCancellations.push(error);return !cancelled})
 check('no unhandled JavaScript errors',unexpected.length===0&&result.domErrors.length===0)
} catch(error) {result.failures.push({message:error.message,stack:error.stack});await screenshot('failure').catch(()=>{});process.exitCode=1}
finally {await mode('online');await writeFile(resolve(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks.length,screens:result.screens.length,pageErrors:result.pageErrors,failures:result.failures},null,2));await browser.close()}
