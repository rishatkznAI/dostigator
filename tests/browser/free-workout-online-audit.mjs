import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'

const origin = process.env.DOSTIGATOR_TEST_ORIGIN ?? 'http://127.0.0.1:4210'
assert.equal(new URL(origin).hostname, '127.0.0.1', 'this test must only write to the isolated loopback stand')
const out = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/free-workout-online-audit')
await mkdir(out, { recursive: true })
const known = JSON.parse(await readFile('src/lib/program-v21.json', 'utf8'))[0].items[0].exercise
const result = { checks: [], errors: [], failures: [], sessions: [], networkFailures: [], blocked: null, physicalPhone: false, api: 'Loopback PostgREST/PostgreSQL, Auth fixture; no production traffic' }
// Diagnose an expired fixture before opening forms or attempting any write.
try {
  const login = await fetch(origin + '/__test/login').then(response => response.text())
  const match = login.match(/localStorage\.setItem\([^,]+,("(?:\\.|[^"\\])*")\)/)
  assert.ok(match, 'stand login fixture is unavailable')
  const fixture = JSON.parse(JSON.parse(match[1]))
  assert.equal(fixture.user.id, '10000000-0000-4000-8000-000000000001')
  const claims = JSON.parse(Buffer.from(fixture.access_token.split('.')[1], 'base64url').toString())
  const expired = claims.exp < Math.floor(Date.now() / 1000)
  const probe = await fetch(origin + '/rest/v1/exercise_library?select=key&limit=1', { headers: { apikey: 'isolated-http-test', Authorization: 'Bearer ' + fixture.access_token } })
  if (expired || !probe.ok) result.blocked = { kind: 'isolated-stand-auth', tokenExpired: expired, postgrestStatus: probe.status, message: 'The isolated stand Auth fixture cannot access PostgREST; no application write was attempted.' }
} catch (error) { result.blocked = { kind: 'isolated-stand-preflight', message: error.message } }
if (result.blocked) {
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  process.exit(1)
}
for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch({ headless: true, ...(engineName === 'chromium' && process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true })
  let stage = 'start'
  page.on('pageerror', error => result.errors.push({ engine: engineName, stage, message: error.message }))
  page.on('requestfailed', request => {
    const path = new URL(request.url()).pathname
    if (path.includes('/auth/v1/') || path.includes('/rest/v1/')) result.networkFailures.push({ engine: engineName, stage, path, failure: request.failure()?.errorText })
  })
  const visit = async path => {
    // A full document replacement aborts old Auth reads in WebKit. Finish the
    // previous SPA transition before leaving, so transport cancellation cannot
    // be confused with an application exception. Page errors remain strict.
    if (page.url() !== 'about:blank') await page.waitForLoadState('networkidle')
    stage = path.split('?')[0]
    await page.goto(origin + path)
    await page.waitForLoadState('networkidle')
  }
  const rpcStatuses = []
  page.on('response', response => { if (response.url().includes('/rest/v1/rpc/training_save_workout')) rpcStatuses.push(response.status()) })
  const check = name => { result.checks.push({ engine: engineName, name }); console.log('PASS ' + engineName + ' ' + name) }
  const suffix = engineName + '-' + Date.now().toString(36)
  const customName = 'Мой онлайн жим ' + suffix, title = 'Онлайн свободная ' + suffix
  const hint = 'Моя техника: плавное движение', muscles = 'Плечи'
  try {
    await visit('/__test/login')
    await page.waitForURL('**/training')
    const identity = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'))
      const session = JSON.parse(localStorage.getItem(key))
      return { authKey: key, owner: session.user.id }
    })
    assert.equal(identity.owner, '10000000-0000-4000-8000-000000000001', 'only the stand test identity is allowed')
    await visit('/training/exercises')
    await page.locator('.library-results article').first().waitFor()
    await page.getByRole('textbox', { name: 'Поиск упражнений' }).fill(known.name)
    await page.getByRole('button', { name: 'Выбрать упражнение · ' + known.name, exact: true }).click()
    await page.getByRole('textbox', { name: 'Поиск упражнений' }).fill('')
    await page.getByText('Добавить своё упражнение', { exact: true }).click()
    await page.getByRole('textbox', { name: 'Название упражнения', exact: true }).fill(customName)
    await page.getByRole('textbox', { name: 'Мышцы · необязательно', exact: true }).fill(muscles)
    await page.getByRole('textbox', { name: 'Подсказка по технике · необязательно', exact: true }).fill(hint)
    await page.getByRole('button', { name: 'Сохранить и выбрать', exact: true }).click()
    await page.getByRole('textbox', { name: 'Название тренировки', exact: true }).fill(title)
    for (const input of await page.locator('.library-item-fields input[type=number]').all()) await input.fill('1')
    await page.getByRole('button', { name: 'Начать свободную тренировку', exact: true }).click()
    await page.waitForURL('**/training/workout/free'); await page.locator('.active-set').waitFor()
    const draft = await page.evaluate(owner => JSON.parse(localStorage.getItem('trainlog:active:' + owner)), identity.owner)
    assert.equal(draft.templateCode, 'free'); assert.equal(draft.exercises.length, 2)
    assert.ok(draft.exercises.every(exercise => exercise.sets.length === 1))
    const custom = draft.exercises.find(exercise => exercise.exercise.custom).exercise
    assert.equal(custom.name, customName)
    await page.getByText('Сохранено в облаке', { exact: true }).waitFor()
    check('known and personal exercise start one real online free session with one set each')
    for (const [index, weight, reps] of [[0, '42.5', '9'], [1, '12.5', '10']]) {
      await page.getByRole('heading', { name: draft.exercises[index].exercise.name, exact: true }).waitFor()
      await page.getByRole('spinbutton', { name: /вес кг/ }).fill(weight)
      await page.getByRole('spinbutton', { name: /повторы/ }).fill(reps)
      await page.getByRole('button', { name: /^Записать подход 1/ }).click()
      await page.getByText('Сохранено в облаке', { exact: true }).waitFor()
    }
    await page.getByRole('button', { name: 'Завершить', exact: true }).click()
    await page.getByRole('button', { name: 'Сохранить тренировку', exact: true }).click()
    await page.waitForURL('**/training/history?finished=*')
    const historyCard = page.locator('.history-card').filter({ hasText: title })
    await historyCard.getByText('Синхронизировано с сервером', { exact: true }).waitFor()
    const cloud = await page.evaluate(async ({ authKey, id }) => {
      const session = JSON.parse(localStorage.getItem(authKey))
      const headers = { apikey: 'isolated-http-test', Authorization: 'Bearer ' + session.access_token }
      const read = async table => { const response = await fetch('/rest/v1/' + table, { headers }); if (!response.ok) throw new Error('Isolated API read failed: ' + response.status); return response.json() }
      return {
        sessions: await read('workout_sessions?id=eq.' + id),
        exercises: await read('workout_session_exercises?session_id=eq.' + id + '&order=sort_order'),
        sets: await read('workout_sets?session_id=eq.' + id + '&order=set_number'),
      }
    }, { authKey: identity.authKey, id: draft.id })
    assert.equal(cloud.sessions.length, 1); assert.ok(cloud.sessions[0].finished_at)
    assert.equal(cloud.sessions[0].template_code, null); assert.equal(cloud.sessions[0].note, 'dostigator:free-workout:v1')
    assert.equal(cloud.exercises.length, 2); assert.equal(cloud.sets.length, 2)
    assert.ok(cloud.sets.every(set => set.done && set.rir === null))
    const customRow = cloud.exercises.find(exercise => exercise.exercise_name === customName)
    assert.equal(customRow.exercise_key, null)
    const encoded = JSON.parse(customRow.note.slice('dostigator:custom-exercise:v1:'.length))
    assert.deepEqual(encoded, { key: custom.key, name: customName, muscles: [muscles], steps: [hint] })
    assert.ok(cloud.exercises.some(exercise => exercise.exercise_key === known.key))
    const customFact = cloud.sets.find(set => set.session_exercise_id === customRow.id)
    assert.equal(customFact.weight_kg, 12.5); assert.equal(customFact.reps, 10)
    assert.ok(rpcStatuses.length >= 1 && rpcStatuses.every(status => status === 200))
    check('PostgREST confirms one finished session, two optional-RIR facts and exact custom identity metadata')
    await page.screenshot({ path: resolve(out, engineName + '-online-history.png'), fullPage: true, animations: 'disabled' })
    const deletion = await page.evaluate(({ owner, authKey, sessionId }) => {
      const authBefore = localStorage.getItem(authKey)
      const queue = JSON.parse(localStorage.getItem('trainlog:queue:' + owner) ?? '[]')
      if (queue.some(item => item.id === sessionId)) throw new Error('Completion still queued; clearing caches is not safe')
      if (localStorage.getItem('trainlog:active:' + owner)) throw new Error('An active draft remains; clearing caches is not safe')
      const keys = ['trainlog:personal-exercises:' + owner, 'trainlog:history-cache:' + owner, 'trainlog:exercise-selection:' + owner, 'trainlog:exercise-selection:' + owner + ':title']
      const removed = keys.filter(key => localStorage.getItem(key) !== null)
      for (const key of keys) localStorage.removeItem(key)
      return { removed, authPreserved: localStorage.getItem(authKey) === authBefore, personalEmpty: localStorage.getItem(keys[0]) === null, historyEmpty: localStorage.getItem(keys[1]) === null }
    }, { ...identity, sessionId: draft.id })
    assert.ok(deletion.authPreserved && deletion.personalEmpty && deletion.historyEmpty)
    check('only four owner-scoped training cache/definition keys are cleared after cloud acknowledgement; auth and queues remain intact')
    await visit('/training/exercises')
    await page.getByText(/Свои упражнения из сохранённой истории добавлены в каталог/).waitFor()
    await page.getByRole('textbox', { name: 'Поиск упражнений' }).fill(customName)
    await page.getByRole('button', { name: 'Выбрать упражнение · ' + customName, exact: true }).waitFor()
    assert.equal(await page.evaluate(owner => localStorage.getItem('trainlog:personal-exercises:' + owner), identity.owner), null)
    await page.getByRole('button', { name: 'Выбрать упражнение · ' + customName, exact: true }).click()
    const recovered = await page.evaluate(owner => JSON.parse(localStorage.getItem('trainlog:exercise-selection:' + owner)), identity.owner)
    assert.equal(recovered.length, 1); assert.deepEqual(recovered[0].exercise, custom)
    check('a full new document restores a selectable personal exercise from cloud history with the same UUID, name, muscles and technique')
    await page.screenshot({ path: resolve(out, engineName + '-cloud-catalog-restored.png'), fullPage: true, animations: 'disabled' })
    await visit('/training/history?finished=' + draft.id)
    const restoredCard = page.locator('.history-card').filter({ hasText: title })
    await restoredCard.getByText('Синхронизировано с сервером', { exact: true }).waitFor()
    await restoredCard.getByText(customName, { exact: true }).waitFor()
    const restored = await page.evaluate(({ owner, id }) => JSON.parse(localStorage.getItem('trainlog:history-cache:' + owner)).find(item => item.id === id), { owner: identity.owner, id: draft.id })
    assert.equal(restored.templateCode, 'free')
    const restoredCustom = restored.exercises.find(item => item.exerciseKey === custom.key)
    assert.deepEqual(restoredCustom.customExercise, custom)
    assert.equal(restoredCustom.sets.filter(set => set.done).length, 1)
    assert.equal(restoredCustom.sets[0].weightKg, 12.5); assert.equal(restoredCustom.sets[0].reps, 10)
    check('cloud-reloaded history retains the free-session marker and exact custom set fact')
    await page.screenshot({ path: resolve(out, engineName + '-cloud-history-restored.png'), fullPage: true, animations: 'disabled' })
    result.sessions.push({ engine: engineName, id: draft.id, customKey: custom.key, recordedSets: 2, rpcStatuses, clearedKeys: deletion.removed })
  } catch (error) {
    result.failures.push({ engine: engineName, message: error.message, stack: error.stack })
    await page.screenshot({ path: resolve(out, engineName + '-failure.png'), fullPage: true }).catch(() => {})
  } finally { await page.waitForLoadState('networkidle').catch(() => {}); stage = 'context-close'; await browser.close() }
}
await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2))
if (result.errors.length || result.failures.length) process.exitCode = 1
