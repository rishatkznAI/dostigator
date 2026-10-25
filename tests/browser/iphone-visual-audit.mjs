import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, webkit } from 'playwright'
import localConfig from '../local-browser/vite.config.mjs'

// Actual current components/CSS with isolated local Auth/repository fixtures.
// Update availability is synthetic; the separate pwa-update-audit tests real SWs.
const scratch = resolve('.cache/iphone-visual-helper')
const out = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/iphone-visual-audit')
await mkdir(scratch, { recursive: true }); await mkdir(out, { recursive: true })
let entry = await readFile('tests/local-browser/main.tsx', 'utf8')
entry = entry.replace("from './fixtures'", "from '../../tests/local-browser/fixtures'").replace("import './preview.css'", "import '../../tests/local-browser/preview.css'")
entry = `import { PwaUpdateNotice } from '../../src/components/PwaUpdateNotice'\nimport { buildInfo } from '../../src/lib/build-info'\nconst updateState={current:buildInfo,latest:{version:'0.2.1',commit:'bbbbbbb',builtAt:null},checkStatus:'available',checkedAt:new Date().toISOString(),checkError:'',available:true,applying:false,message:''}; const controller={subscribe:()=>()=>{},getSnapshot:()=>updateState,defer:()=>{},checkForUpdates:async()=>{},apply:()=>false,dispose:()=>{}};\n` + entry
entry = entry.replace('.render(<BrowserRouter>', '.render(<><PwaUpdateNotice controller={controller}/><BrowserRouter>').replace('</BrowserRouter>)', '</BrowserRouter></>)')
await writeFile(resolve(scratch, 'main.tsx'), entry)
await writeFile(resolve(scratch, 'index.html'), '<html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1.0"/><style>.preview-nav{display:none!important}</style></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>')
const server = await createServer({ ...localConfig, configFile: false, root: scratch, server: { ...localConfig.server, port: 0, strictPort: false } })
await server.listen()
const origin = 'http://127.0.0.1:' + server.httpServer.address().port
const engine = process.env.PLAYWRIGHT_ENGINE === 'webkit' ? webkit : chromium
const browser = await engine.launch({ headless: true, ...(engine === chromium && process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
const page = await context.newPage()
const result = { fixture: 'Actual current app UI/CSS with local repository/Auth and synthetic update availability', checks: [], errors: [], findings: [], geometry: [] }
page.on('pageerror', error => result.errors.push(error.message))
const geometry = () => page.evaluate(() => {
  const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } }
  const banner = document.querySelector('.app-update-notice')
  const header = document.querySelector('.workout-header')
  const buttons = [...document.querySelectorAll('.workout-header button, .workout-header a, .app-update-notice button')].map(element => {
    const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return { name: element.getAttribute('aria-label') || element.textContent, ...rect(element), centerExposed: Boolean(hit && (hit === element || element.contains(hit))) }
  })
  return { viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth, banner: rect(banner), header: header && rect(header), buttons }
})
try {
  await page.goto(origin + '/')
  await page.getByRole('heading', { name: /^Сегодня,/ }).waitFor()
  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.screenshot({ path: resolve(out, `${width}-dashboard-update.png`), fullPage: true, animations: 'disabled' })
    const measure = await geometry(); assert.equal(measure.overflow, 0); assert.ok(measure.buttons.every(button => button.height >= 44)); assert.ok(measure.banner.height <= 88, 'compact update notice must not take over the mobile viewport')
    result.geometry.push({ screen: 'dashboard', ...measure })
  }
  result.checks.push('Update controls on dashboard fit 375/390/430 without horizontal overflow and have 44px targets')
  await page.goto(origin + '/training/workout/A')
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await page.getByRole('spinbutton', { name: /подход 1, вес/ }).fill('47.5')
  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 }); await page.evaluate(() => scrollTo(0, 1100)); await page.waitForTimeout(100)
    const measure = await geometry(); result.geometry.push({ screen: 'workout-scrolled', ...measure }); assert.equal(measure.overflow, 0)
    await page.screenshot({ path: resolve(out, `${width}-workout-update-scrolled.png`), animations: 'disabled' })
    const covered = measure.buttons.filter(button => !button.centerExposed && button.y >= 0 && button.y < measure.viewport.height)
    if (covered.length) result.findings.push({ screen: 'workout-scrolled', width, coveredControls: covered.map(button => button.name), banner: measure.banner, header: measure.header })
  }
  await page.getByRole('button', { name: 'Подробнее', exact: true }).click()
  await page.getByRole('button', { name: 'Позже', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 1100)); await page.waitForTimeout(100)
  const collapsed = await geometry(); result.geometry.push({ screen: 'workout-scrolled-compact', ...collapsed })
  await page.screenshot({ path: resolve(out, '390-workout-update-compact-scrolled.png'), animations: 'disabled' })
  assert.equal(await page.getByRole('spinbutton', { name: /подход 1, вес/ }).inputValue(), '47.5')
  result.checks.push('Postponing an update preserves unrecorded workout input')
  const covered = collapsed.buttons.filter(button => !button.centerExposed && button.y >= 0 && button.y < collapsed.viewport.height)
  if (covered.length) result.findings.push({ screen: 'workout-scrolled-compact', width: 390, coveredControls: covered.map(button => button.name), banner: collapsed.banner, header: collapsed.header })
  assert.equal(result.findings.length, 0, 'update notice must not cover workout header controls')
  result.checks.push('Expanded and compact update notices leave scrolled workout controls exposed')
  assert.equal(result.errors.length, 0); result.checks.push('No unhandled JavaScript errors')
} catch (error) { result.errors.push(error.stack); process.exitCode = 1 }
finally { await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); await browser.close(); await server.close() }
