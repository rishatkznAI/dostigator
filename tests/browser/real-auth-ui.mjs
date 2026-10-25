import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
assert.equal(process.env.AUDIT_PROJECT_REF,'xorlzijpgklasatxzcnn','Only the isolated audit project is permitted')
assert.equal(new URL(process.env.VITE_SUPABASE_URL).hostname,'xorlzijpgklasatxzcnn.supabase.co')
const output=resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT||'.cache/real-auth-ui');await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})})
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
const page=await context.newPage();const results={checks:[],pageErrors:[],failures:[],expectedErrors:[]}
page.on('pageerror',error=>results.pageErrors.push(error.message));page.on('dialog',dialog=>dialog.accept())
const check=(name,ok=true)=>{assert.ok(ok,name);results.checks.push(name);console.log('PASS '+name)}
const origin='http://127.0.0.1:4194';const snap=async(name)=>page.screenshot({path:resolve(output,name+'.png'),fullPage:!(await page.getByRole('dialog').count())})
const signIn=async(email)=>{await page.getByRole('textbox',{name:'Email',exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(process.env.AUDIT_PASSWORD);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(url=>!url.pathname.includes('login'));await page.locator('h1').first().waitFor();if(await page.getByRole('button',{name:/Пропустить —/}).count())await page.getByRole('button',{name:/Пропустить —/}).click()}
try {
 await page.goto(origin+'/login')
 for(const width of [375,390,430,768,1280]){await page.setViewportSize({width,height:844});await snap(`${width}-login`);check(`${width}px login has no overflow`,await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth))}
 await page.setViewportSize({width:390,height:844})
 for(const [button,title] of [['Создать аккаунт','Создать аккаунт'],['Войти по ссылке','Войти по ссылке'],['Забыли пароль?','Восстановить пароль']]){await page.getByRole('button',{name:button,exact:true}).click();await page.getByRole('heading',{name:title,exact:true}).waitFor();await snap('390-auth-'+title);await page.getByRole('button',{name:'Войти с паролем',exact:true}).click();check('auth mode '+title+' opens and returns')}
 await page.getByRole('textbox',{name:'Email',exact:true}).fill('audit-a@example.invalid');await page.getByLabel('Пароль',{exact:true}).fill('intentionally-wrong-password');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('alert').waitFor();check('invalid password displays a localized error');await snap('390-auth-error')
 await signIn('audit-a@example.invalid');check('real password login enters the protected app')
 await page.goto(origin+'/settings');await page.getByRole('button',{name:'Сохранить ник',exact:true}).waitFor();await snap('390-profile-real-auth');check('profile displays authenticated account controls',await page.getByRole('button',{name:'Сохранить ник',exact:true}).count()===1)
 const previousNick=await page.getByRole('textbox',{name:'Ник',exact:true}).inputValue();await page.getByRole('textbox',{name:'Ник',exact:true}).fill('Проверка профиля');await page.getByRole('button',{name:'Сохранить ник',exact:true}).click();await page.getByText('Ник изменён',{exact:true}).waitFor();await page.getByRole('textbox',{name:'Ник',exact:true}).fill(previousNick);await page.getByRole('button',{name:'Сохранить ник',exact:true}).click();await page.getByText('Ник изменён',{exact:true}).waitFor();check('profile nickname saves through real Auth and is restored')
 await page.getByLabel('Новый пароль',{exact:true}).fill('validation-only-123');await page.getByLabel('Повторите пароль',{exact:true}).fill('validation-only-456');await page.getByRole('button',{name:'Изменить пароль',exact:true}).click();await page.getByText('Пароли не совпадают',{exact:true}).waitFor();check('password mismatch is rejected without changing the password');await page.getByLabel('Новый пароль',{exact:true}).fill('');await page.getByLabel('Повторите пароль',{exact:true}).fill('')
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать JSON',exact:true}).click();const backup=await downloaded;const backupPath=resolve('.cache/real-auth-profile-backup.json');await backup.saveAs(backupPath);await page.getByLabel('Файл резервной копии Достигатора',{exact:true}).setInputFiles(backupPath);await page.getByRole('button',{name:'Подтвердить восстановление',exact:true}).waitFor();await snap('390-backup-preview');await page.getByRole('button',{name:'Отмена',exact:true}).click();check('backup downloads and opens a restore preview without applying it')

 await page.goto(origin+'/training/workout/A');await page.getByRole('button',{name:'Начать тренировку',exact:true}).click();await page.getByRole('spinbutton',{name:/подход 1, вес/}).fill('40');await page.getByRole('button',{name:/^Записать подход 1/}).click();await page.waitForTimeout(900)
 await page.reload();await page.getByRole('button',{name:/Подход 1 · записан/}).waitFor();check('real cloud workout survives reload',await page.getByRole('button',{name:/Подход 1 · записан/}).count()===1)
 await page.getByRole('button',{name:'Завершить',exact:true}).click();await page.getByRole('button',{name:'Сохранить неполную тренировку',exact:true}).click();await page.waitForURL('**/training/history?finished=*');await page.getByText('Синхронизировано с сервером',{exact:true}).first().waitFor()
 check('partial workout completes and syncs through real Supabase')
 await page.getByRole('button',{name:/Исправить .*подход 1/}).first().click();await page.getByRole('spinbutton',{name:'Исправленный вес, кг'}).fill('47.5')
 let dropped=false
 await page.route('**/rest/v1/rpc/training_correct_set',async route=>{if(!dropped){await route.fetch();dropped=true;await route.abort('failed')}else await route.continue()})
 await page.getByRole('button',{name:'Сохранить исправление',exact:true}).click();await page.getByRole('alert').waitFor();check('lost correction response leaves a recoverable local request',dropped);await snap('390-correction-lost-response')
 await page.getByRole('button',{name:'Сохранить исправление',exact:true}).click();await page.getByText('Подход исправлен. Итог и статистика пересчитаны.',{exact:true}).waitFor();await page.reload();check('retry confirms one committed correction through real Auth/API',(await page.locator('.history-detail').innerText()).includes('47,5 кг'))
 await snap('390-real-history-corrected')
 await page.goto(origin+'/settings');await page.getByRole('button',{name:/Выйти/,exact:false}).last().click();await page.waitForURL('**/login');check('real logout returns to login')
 await signIn('audit-b@example.invalid');await page.goto(origin+'/training/history');await page.getByRole('heading',{name:'История тренировок',exact:true}).waitFor();await page.locator('.inline-loader').waitFor({state:'hidden'});check('second user cannot see first user training result',!((await page.locator('main').innerText()).includes('47,5')));await snap('390-other-account-history')
 await page.goto(origin+'/settings');await page.getByRole('button',{name:/Выйти/}).last().click();await page.waitForURL('**/login');await signIn('audit-a@example.invalid');await page.goto(origin+'/training/history');await page.locator('.history-summary').first().waitFor();await page.locator('.inline-loader').waitFor({state:'hidden'});await page.locator('.history-summary').first().click();check('re-login restores own corrected history',(await page.locator('main').innerText()).includes('47,5'))
 check('real Auth browser has no unhandled JavaScript errors',results.pageErrors.length===0)
} catch(error){results.failures.push({message:error.message,stack:error.stack});await snap('failure').catch(()=>{});process.exitCode=1}
finally {await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({checks:results.checks.length,pageErrors:results.pageErrors,failures:results.failures},null,2));await browser.close()}
