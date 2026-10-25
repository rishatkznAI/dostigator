import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {webkit} from 'playwright'
const out=resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT || '.cache/iphone-conflict-audit')
await mkdir(out,{recursive:true})
const templates=JSON.parse(await readFile('src/lib/program-v21.json','utf8'))
const owner='local-training-test',stamp='2026-10-25T08:00:00.000Z'
const make=(code)=>{const t=templates.find(t=>t.code===code),id=crypto.randomUUID();return {schemaVersion:3,programRevision:'V2.1',id,userId:owner,templateCode:code,title:'Тренировка '+code+' · V2.1',startedAt:stamp,finishedAt:null,timerPausedAt:null,timerPausedDurationMs:0,readiness:null,activeRest:null,deletedSetIds:[],updatedAt:stamp,syncState:'pending',exercises:t.items.map(item=>({id:crypto.randomUUID(),exercise:item.exercise,target:item.repTarget,sortOrder:item.sortOrder,skipped:false,skipReason:'',sets:[{id:crypto.randomUUID(),setNumber:1,weightKg:20,reps:10,rir:null,done:true,isWarmup:false,completedAt:stamp}]}))}}
const browser=await webkit.launch({headless:true}), results={browser:'WebKit',checks:[],errors:[],failures:[],screenshots:[]}
try {
 for(const scenario of ['finished','unknown','other']){
 const draft=make('A'),other=scenario==='other'?make('B'):draft
 const conflict={id:other.id,local:other,remote:scenario==='unknown'?null:{session:{id:other.id,revision:2,updated_at:stamp,finished_at:stamp,title:other.title},exercises:other.exercises.map(e=>({id:e.id,exercise_name:e.exercise.name})),sets:other.exercises.map(e=>({session_exercise_id:e.id,weight_kg:22.5,reps:12,rir:null,done:true,is_warmup:false}))}}
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2})
 const page=await context.newPage();page.on('pageerror',e=>results.errors.push(e.message))
 await page.addInitScript(({owner,draft,conflict})=>{localStorage.setItem('trainlog:active:'+owner,JSON.stringify(draft));localStorage.setItem('trainlog:workout-conflicts:'+owner,JSON.stringify([conflict]));localStorage.setItem('local-test:online','false')},{owner,draft,conflict})
 await page.goto('http://127.0.0.1:4192/training/workout/A');await page.getByText(scenario==='other'?'Другие конфликты синхронизации: 1':'Тренировка не синхронизирована',{exact:true}).waitFor()
 if(scenario!=='other'){await page.locator('.workout-conflict-details > summary').click();await page.locator('.workout-conflict-backup').waitFor()}
 for(const width of [320,375,390,430,443])for(const scale of [1,2]){
  await page.setViewportSize({width,height:844});await page.evaluate(()=>{for(const e of document.querySelectorAll('[data-audit-font]')){e.style.fontSize=e.dataset.auditFont;e.style.lineHeight=e.dataset.auditLine;delete e.dataset.auditFont;delete e.dataset.auditLine}})
  if(scale===2)await page.evaluate(()=>{const elements=[...document.querySelectorAll('.training-module *')];const values=elements.map(e=>({e,font:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight}));for(const {e,font,line} of values){e.dataset.auditFont=e.style.fontSize;e.dataset.auditLine=e.style.lineHeight;e.style.fontSize=parseFloat(font)*2+'px';if(line!=='normal')e.style.lineHeight=parseFloat(line)*2+'px'}})
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(60)
  const metrics=await page.evaluate(()=>{
   const root=document.querySelector('.workout-conflict,.workout-conflict-notice'),r=root.getBoundingClientRect(),round=n=>Math.round(n*100)/100
   const bounds=e=>{const b=e.getBoundingClientRect();return {x:round(b.x),y:round(b.y),width:round(b.width),height:round(b.height),right:round(b.right),bottom:round(b.bottom)}}
   const controls=[...root.querySelectorAll('button,summary,a')].filter(e=>e.checkVisibility())
   const targets=controls.map(e=>({text:e.textContent.trim(),...bounds(e)}))
   const nodes=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
   while(walker.nextNode()){const t=walker.currentNode;if(!t.textContent.trim()||!t.parentElement.checkVisibility())continue;const range=document.createRange();range.selectNodeContents(t);for(const b of range.getClientRects()){if(b.width&&b.height)nodes.push({text:t.textContent.trim(),x:b.x,y:b.y,right:b.right,bottom:b.bottom})}}
   const outside=nodes.filter(b=>b.x<r.x-1||b.right>r.right+1).map(b=>({text:b.text,x:round(b.x),right:round(b.right)}))
   const overlaps=[]
   for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],w=Math.min(a.right,b.right)-Math.max(a.x,b.x),h=Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y);if(w>1&&h>1)overlaps.push({a:a.text,b:b.text,width:round(w),height:round(h)})}
   const wrapperOverflows=[...root.querySelectorAll('*')].filter(e=>{const b=e.getBoundingClientRect();return e.checkVisibility()&&b.width&&b.height&&(b.x<r.x-1||b.right>r.right+1)}).map(e=>({tag:e.tagName,cls:e.className,...bounds(e)}))
   const globalOutside=[...document.querySelectorAll('.training-module *')].filter(e=>{const b=e.getBoundingClientRect();return e.checkVisibility()&&b.width&&b.height&&(b.x<-.5||b.right>innerWidth+.5)}).slice(0,15).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.trim().slice(0,80),...bounds(e)}));const globalTextOutside=[],gw=document.createTreeWalker(document.querySelector('.training-module'),NodeFilter.SHOW_TEXT);while(gw.nextNode()){const t=gw.currentNode;if(!t.textContent.trim()||!t.parentElement.checkVisibility())continue;const range=document.createRange();range.selectNodeContents(t);for(const b of range.getClientRects())if(b.x<-.5||b.right>innerWidth+.5)globalTextOutside.push({text:t.textContent.trim(),parentClass:t.parentElement.className,x:round(b.x),right:round(b.right),width:round(b.width)})};return {region:bounds(root),globalOutside,globalTextOutside,pageOverflow:document.documentElement.scrollWidth-innerWidth,targets,outsideText:outside,textOverlaps:overlaps,wrapperOverflows}
  })
  const hitTests=[];for(const target of await page.locator('.workout-conflict button,.workout-conflict summary,.workout-conflict-notice a').all()){await target.scrollIntoViewIfNeeded();hitTests.push(await target.evaluate(e=>{const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);return {text:e.textContent.trim(),clickable:hit===e||e.contains(hit)}}))}
  const record={scenario,width,textScale:scale,...metrics,hitTests};results.checks.push(record)
  try {
    assert.equal(metrics.pageOverflow,0,'page has horizontal overflow')
    assert.deepEqual(metrics.globalTextOutside,[],'text extends beyond the viewport')
    assert.deepEqual(metrics.outsideText,[],'conflict text extends beyond its region')
    assert.deepEqual(metrics.textOverlaps,[],'conflict text overlaps')
    assert.deepEqual(metrics.wrapperOverflows,[],'conflict child extends beyond its region')
    assert.ok(metrics.targets.every(t=>t.width>=44 && t.height>=44),'conflict target below44px')
    assert.ok(hitTests.every(t=>t.clickable),'conflict target obscured')
  } catch(error) {results.failures.push({scenario,width,textScale:scale,message:error.message,...metrics,hitTests})}
  await page.evaluate(()=>window.scrollTo(0,0));const file=`${scenario}-${width}-text${scale*100}.png`;await page.screenshot({path:resolve(out,file),fullPage:true});results.screenshots.push(file)
 }
 // Ensure download keeps both conflict and active draft data intact.
 if(scenario!=='other'){
  const before=await page.evaluate(owner=>({active:localStorage.getItem('trainlog:active:'+owner),conflict:localStorage.getItem('trainlog:workout-conflicts:'+owner)}),owner)
  const download=page.waitForEvent('download');await page.locator('.workout-conflict-backup').click();await download
  const after=await page.evaluate(owner=>({active:localStorage.getItem('trainlog:active:'+owner),conflict:localStorage.getItem('trainlog:workout-conflicts:'+owner)}),owner);assert.deepEqual(after,before)
 }
 await context.close()
 }
 assert.deepEqual(results.errors,[],'uncaught JavaScript errors')
}catch(error){results.failures.push({message:error.message});}finally{await browser.close();if(results.failures.length)process.exitCode=1;await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({matrix:results.checks.length,failures:results.failures.map(r=>({scenario:r.scenario,width:r.width,textScale:r.textScale,outsideText:r.outsideText,globalTextOutside:r.globalTextOutside,textOverlaps:r.textOverlaps,wrapperOverflows:r.wrapperOverflows,smallTargets:r.targets?.filter(t=>t.width<44||t.height<44),missedHit:r.hitTests?.filter(t=>!t.clickable),pageOverflow:r.pageOverflow})),errors:results.errors,output:out},null,2))}
