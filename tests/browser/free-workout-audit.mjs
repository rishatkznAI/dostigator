import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium,webkit} from 'playwright'
const origin=process.env.DOSTIGATOR_TEST_ORIGIN ?? 'http://127.0.0.1:4192'
const out=resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/free-workout-audit');await mkdir(out,{recursive:true})
const result={checks:[],errors:[],failures:[],physicalPhone:false}
const program=JSON.parse(await readFile('src/lib/program-v21.json','utf8')),known=program[0].items[0].exercise.name
for(const [engineName,engine] of Object.entries({chromium,webkit})){
 const b=await engine.launch({headless:true,...(engineName==='chromium'&&process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})})
 const p=await b.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true})
 p.on('pageerror',e=>result.errors.push({engineName,message:e.message}))
 const check=name=>{result.checks.push({engine:engineName,name});console.log('PASS '+engineName+' '+name)}
 try{
  await p.goto(origin+'/training/exercises');await p.locator('.library-results article').first().waitFor()
  await p.addStyleTag({content:'.preview-nav{display:none!important}'})
  for(const width of [320,375,393,430,443,768,1280]){
   await p.setViewportSize({width,height:852})
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0)
   assert.ok(await p.locator('.library-results button,.library-selection button,.library-create summary').evaluateAll(rows=>rows.every(e=>e.getBoundingClientRect().height>=44)))
   await p.screenshot({path:resolve(out,`${engineName}-${width}-catalog.png`),fullPage:true,animations:'disabled'})
  }check('catalog fits seven widths with 44px controls')
  await p.setViewportSize({width:393,height:852})
  await p.getByRole('textbox',{name:'Поиск упражнений'}).fill(known)
  await p.getByRole('button',{name:`Выбрать упражнение · ${known}`,exact:true}).click()
  await p.getByRole('textbox',{name:'Поиск упражнений'}).fill('')
  await p.getByText('Добавить своё упражнение',{exact:true}).click()
  await p.getByRole('textbox',{name:'Название упражнения',exact:true}).fill('Мой жим вне программы')
  await p.getByRole('textbox',{name:'Мышцы · необязательно',exact:true}).fill('Плечи')
  await p.getByRole('textbox',{name:'Подсказка по технике · необязательно',exact:true}).fill('Моя заметка')
  await p.getByRole('button',{name:'Сохранить и выбрать',exact:true}).click()
  await p.getByRole('textbox',{name:'Название тренировки',exact:true}).fill('Вне расписания')
  for(const input of await p.locator('.library-item-fields input[type=number]').all())await input.fill('1')
  await p.reload();await p.getByRole('textbox',{name:'Название тренировки',exact:true}).waitFor()
  assert.equal(await p.getByRole('textbox',{name:'Название тренировки',exact:true}).inputValue(),'Вне расписания')
  assert.equal(await p.locator('.library-selected-item').count(),2)
  check('personal exercise and composed training survive reload')
  await p.screenshot({path:resolve(out,`${engineName}-composed.png`),fullPage:true,animations:'disabled'})
  await p.getByRole('button',{name:'Начать свободную тренировку',exact:true}).click()
  await p.waitForURL('**/training/workout/free');await p.locator('.active-set').waitFor()
  const draft=await p.evaluate(()=>JSON.parse(localStorage.getItem('trainlog:active:local-training-test')))
  assert.equal(draft.templateCode,'free');assert.equal(draft.title,'Вне расписания');assert.equal(draft.exercises.length,2)
  await p.getByRole('spinbutton',{name:/вес кг/}).fill('42.5');await p.getByRole('spinbutton',{name:/повторы/}).fill('9')
  await p.getByRole('button',{name:/^Записать подход 1/}).click();await p.waitForTimeout(750)
  await p.reload();await p.locator('.active-set').waitFor()
  const restored=await p.evaluate(()=>JSON.parse(localStorage.getItem('trainlog:active:local-training-test')))
  assert.equal(restored.id,draft.id);assert.equal(restored.exercises[0].sets[0].weightKg,42.5);assert.equal(restored.exercises[0].sets[0].done,true)
  check('free workout records real sets and restores the same active session')
  await p.getByRole('spinbutton',{name:/вес кг/}).fill('12.5');await p.getByRole('spinbutton',{name:/повторы/}).fill('10')
  await p.getByRole('button',{name:/^Записать подход 1/}).click();await p.waitForTimeout(750)
  await p.getByRole('button',{name:'Завершить',exact:true}).click()
  await p.getByRole('button',{name:'Сохранить тренировку',exact:true}).click()
  await p.waitForURL('**/training/history?finished=*')
  await p.getByText('Вне расписания',{exact:true}).first().waitFor()
  await p.screenshot({path:resolve(out,`${engineName}-history.png`),fullPage:true,animations:'disabled'})
  const queue=await p.evaluate(()=>JSON.parse(localStorage.getItem('trainlog:queue:local-training-test')??'[]'))
  const completed=queue.find(row=>row.id===draft.id);assert.ok(completed?.finishedAt);assert.ok(completed.exercises[1].exercise.custom)
  check('completion keeps a custom snapshot in offline history and sync queue')
  await p.goto(origin+'/training');await p.locator('.week-ring').waitFor()
  assert.equal(await p.locator('.week-ring').getAttribute('aria-valuenow'),'0')
  await p.getByRole('link',{name:'Начать тренировку A',exact:true}).click()
  await p.getByRole('button',{name:'Начать тренировку',exact:true}).click();await p.locator('.active-set').waitFor()
  const a=await p.evaluate(()=>JSON.parse(localStorage.getItem('trainlog:active:local-training-test')))
  await p.goto(origin+'/training/exercises');await p.getByRole('textbox',{name:'Поиск упражнений'}).fill('Мой жим вне программы')
  await p.getByRole('button',{name:'Выбрать упражнение · Мой жим вне программы',exact:true}).click()
  await p.getByRole('button',{name:'Добавить в текущую тренировку',exact:true}).click();await p.waitForURL('**/training/workout/A')
  const added=await p.evaluate(()=>JSON.parse(localStorage.getItem('trainlog:active:local-training-test')))
  assert.equal(added.id,a.id);assert.deepEqual(added.exercises.slice(0,a.exercises.length),a.exercises);assert.equal(added.exercises.length,a.exercises.length+1)
  check('free session gives no A/B credit and catalog append preserves the active A graph')
 }catch(e){result.failures.push({engine:engineName,message:e.message,stack:e.stack});await p.screenshot({path:resolve(out,`${engineName}-failure.png`),fullPage:true}).catch(()=>{})}
 finally{await b.close()}
}
await writeFile(resolve(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.failures.length||result.errors.length)process.exitCode=1
