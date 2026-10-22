import { derivePlan, estimateBudget } from './model.mjs'
import { prepareLocalSessionDraft } from './local-integration.mjs'
const response = await fetch('./program.json')
if (!response.ok) throw new Error('Не удалось открыть локальный черновик')
const program = await response.json()
const state = { slot: 'A', reduced: false, setSeconds: 60, cardioMinutes: 30, equipmentOkay: false, noDiscomfort: false, optionalSelections: {} }
const panel = document.querySelector('#session-panel')
const number = (value) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)
const duration = (value) => `${number(value)} мин`
const load = (item) => !item.preliminaryLoad ? 'Не задан' : item.preliminaryLoad.unit === 'bodyweight' ? 'Собственный вес' : `${item.preliminaryLoad.range.map(number).join('–')} кг${item.preliminaryLoad.convention === 'one-dumbbell' ? ' на гантель' : ''}`
const rest = (item) => item.restSeconds ? `${[...new Set(item.restSeconds)].join('–')} сек` : 'Не задан · в оценке 90 сек'
const planOptions = () => ({ ...state, cardioMinutes: state.slot === 'C' ? state.cardioMinutes : 20 })
function render() {
 const plan = derivePlan(program, state.slot, planOptions())
 const budget = estimateBudget(program, plan, state.setSeconds)
 document.querySelectorAll('[data-day]').forEach((button) => { button.setAttribute('aria-selected', String(button.dataset.day === state.slot)); button.tabIndex = button.dataset.day === state.slot ? 0 : -1 })
 panel.setAttribute('aria-labelledby', `tab-${state.slot}`)
 const selectable = state.equipmentOkay && state.noDiscomfort
 panel.innerHTML = `<div class="session-heading"><div><p class="eyebrow">${plan.dayName}</p><h2>Тренировка ${plan.slot}</h2></div><span class="badge">${plan.mandatory ? '75 минут вместе с кардио' : 'Необязательная'}</span></div>
 ${plan.mandatory ? `<label class="mode"><input type="checkbox" id="reduced" ${state.reduced ? 'checked' : ''}><span><strong>Сокращённый объём после перерыва</strong><small>Вариант для согласования: по 2 подхода в каждом упражнении. Срок применения не задан.</small></span></label>` : `<div class="panel optional"><h3>Основной блок — кардио. Силовые — по желанию.</h3><p>Ничего не выбрано автоматически. Для икр и пресса нужен конкретный вариант упражнения.</p><label class="check"><input type="checkbox" id="equipment" ${state.equipmentOkay ? 'checked' : ''}>Есть подходящее оборудование для выбранных упражнений</label><label class="check"><input type="checkbox" id="comfort" ${state.noDiscomfort ? 'checked' : ''}>Выбранные упражнения не вызывают дискомфорта</label>${program.sessions.find(x => x.slot === 'C').optionalItems.map((item) => `<label class="variant">${item.name} · ${item.workingSets} × ${item.repRange.join('–')}<select data-optional="${item.slot}" aria-label="Добавить: ${item.name}" ${selectable ? '' : 'disabled'}><option value="">Не добавлять</option>${item.variants.map((variant) => `<option value="${variant.exerciseKey}" ${state.optionalSelections[item.slot] === variant.exerciseKey ? 'selected' : ''}>${variant.name}</option>`).join('')}</select></label>`).join('')}<small>Смит — только один доступный в текущей библиотеке вариант для икр. Если он не подходит, оставь упражнение невыбранным. Другой вариант требует отдельного согласования.</small></div>`}
 <section class="panel budget ${budget.fits === false ? 'over' : ''}" aria-label="Оценка времени"><div class="budget-head"><div><p class="eyebrow">Бюджет времени</p><strong>${duration(budget.totalMinutes)}${plan.timeLimitMinutes ? '<span> / 75</span>' : ''}</strong></div><b>${budget.reserveMinutes === null ? 'Без заданного лимита' : budget.fits ? `Запас ${duration(budget.reserveMinutes)}` : `Превышение ${duration(-budget.reserveMinutes)}`}</b></div><div class="phase-grid"><div><span>Разминка*</span><b>${duration(budget.warmupMinutes)}</b></div><div><span>Силовая с отдыхом</span><b>${duration(budget.strengthMinutes)}</b></div><div><span>Переходы*</span><b>${duration(budget.transitionMinutes)}</b></div><div><span>Кардио</span><b>${duration(budget.cardioMinutes)}</b></div></div><details><summary>Проверить допущения и запас</summary><label class="variant">Время одного рабочего подхода для оценки<select id="set-seconds" aria-label="Время одного рабочего подхода">${[45,60,75,90].map((value) => `<option value="${value}" ${state.setSeconds === value ? 'selected' : ''}>${value} сек</option>`).join('')}</select></label><p>Использована верхняя граница отдыха, только между подходами одного упражнения. Переходы между упражнениями посчитаны отдельно. Разминка обязательных дней: 5 минут общей + 4 минуты подводящих подходов с их отдыхом. Переходы: 6 минут между силовыми станциями + 2 минуты к кардио.</p><p>Это расчёт, а не гарантия. При очередях или более долгих подходах лимит может быть превышен; отдых автоматически не сокращается. Можно согласовать сокращённый объём. ${state.slot === 'C' ? 'Отдых 90 секунд в необязательных упражнениях — допущение для оценки, в запросе он не задан.' : ''}</p></details>${budget.fits === false ? '<p role="status" class="warning">С выбранными допущениями 75 минут не хватает. Предпросмотр не урезает отдых или кардио сам: проверь сокращённый объём.</p>' : '<p class="caption">* Включены разминка и переходы. Резерв не заполнен дополнительной нагрузкой.</p>'}</section>
 <div class="list-heading"><h3>Силовая часть</h3><span>${budget.workingSets} рабочих подходов</span></div>
 <div class="exercise-list">${plan.items.length ? plan.items.map((item, index) => `<article class="exercise"><span class="order">${index + 1}</span><div class="exercise-body"><h3>${item.name}</h3><div class="prescription"><strong>${item.workingSets} × ${item.repRange.join('–')}</strong><span>Отдых: ${rest(item)}</span></div><div class="load"><span>${item.preliminaryLoad ? 'Предварительный ориентир' : 'Начальный вес'}</span><strong>${load(item)}</strong></div><p class="caption">${item.preliminaryLoad ? 'Не назначен и не подтверждён. Фактический вес выбирается при выполнении.' : 'Вес не задан пользователем; не подставляется из старого справочника.'}</p></div></article>`).join('') : '<div class="empty">Силовые упражнения не добавлены. Кардио остаётся самостоятельной субботней тренировкой.</div>'}</div>
 <section class="panel cardio"><div><p class="eyebrow">${plan.slot} · ${plan.dayName}</p><h3>Кардио ${plan.cardio.durationMinutes[0] === plan.cardio.durationMinutes[1] ? duration(plan.cardio.plannedMinutesForPreview) : '30–45 мин'}</h3></div><p>${plan.mandatory ? 'Умеренная нагрузка. Привязано к этой тренировке; последняя запись другой активности или дня не меняет план.' : 'Активность и интенсивность пока не уточнены. Пропуск этого дня не создаёт долг.'}</p><label class="variant">Активность для согласования<select aria-label="Вид кардио для согласования" id="cardio-kind"><option value="">Пока не выбрана</option><option value="walk">Дорожка</option><option value="elliptical">Эллипс</option><option value="bike">Велотренажёр</option><option value="outdoor">Прогулка</option></select></label>${plan.slot === 'C' ? `<label class="variant">Продолжительность для оценки<select aria-label="Продолжительность кардио в субботу" id="cardio-minutes"><option value="30" ${state.cardioMinutes === 30 ? 'selected' : ''}>30 минут</option><option value="45" ${state.cardioMinutes === 45 ? 'selected' : ''}>45 минут</option></select></label>` : ''}<div class="fact-row"><span>План: ${duration(plan.cardio.plannedMinutesForPreview)}</span><span>Факт: нет данных</span></div></section>
 <section class="panel"><h3>Локальный снимок плана</h3><p class="caption">Версия дня, силовой план и его кардиоблок сохраняются отдельно от фактов. Снимок остаётся неактивным черновиком.</p><button type="button" id="download-draft" class="draft-download">Скачать снимок для проверки</button><p id="draft-status" class="caption" role="status"></p></section>
 <div class="history-note"><strong>Прогрессия пока без назначения нагрузки</strong><p>История не подключена. Старые записи и предварительные веса не становятся подтверждёнными результатами v2.</p></div>`
 const kind = panel.querySelector('#cardio-kind'); kind.value = state.cardioKinds?.[state.slot] ?? ''
}
document.querySelector('.day-tabs').addEventListener('click', (event) => { const button = event.target.closest('[data-day]'); if (!button) return; state.slot = button.dataset.day; render() })
document.querySelector('.day-tabs').addEventListener('keydown', (event) => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const slots = ['A','B','C']; const i = slots.indexOf(state.slot); state.slot = event.key === 'Home' ? 'A' : event.key === 'End' ? 'C' : slots[(i + (event.key === 'ArrowRight' ? 1 : 2)) % 3]; render(); document.querySelector(`#tab-${state.slot}`).focus() })
panel.addEventListener('change', (event) => {
 const el = event.target
 if (el.id === 'cardio-kind') { state.cardioKinds ??= {}; state.cardioKinds[state.slot] = el.value; return }
 const restoreDetails = el.closest('details') !== null
 if (el.id === 'reduced') state.reduced = el.checked
 if (el.id === 'equipment') state.equipmentOkay = el.checked
 if (el.id === 'comfort') state.noDiscomfort = el.checked
 if (!state.equipmentOkay || !state.noDiscomfort) state.optionalSelections = {}
 if (el.dataset.optional) state.optionalSelections[el.dataset.optional] = el.value
 if (el.id === 'set-seconds') state.setSeconds = Number(el.value)
 if (el.id === 'cardio-minutes') state.cardioMinutes = Number(el.value)
 const id = el.id; const option = el.dataset.optional
 render()
 if (restoreDetails) panel.querySelector('details').open = true
 const next = id ? panel.querySelector(`#${id}`) : option ? panel.querySelector(`[data-optional="${option}"]`) : null
 next?.focus({ preventScroll: true })
})
render()

panel.addEventListener('click', (event) => {
 if (event.target.id !== 'download-draft') return
 const status = panel.querySelector('#draft-status')
 try {
  const draft = prepareLocalSessionDraft(program, state.slot, {reduced:state.reduced, cardioMinutes:state.slot==='C'?state.cardioMinutes:20, equipmentOkay:state.equipmentOkay, noDiscomfort:state.noDiscomfort, optionalSelections:state.optionalSelections, workSetSeconds:state.setSeconds, cardioActivityForReview:state.cardioKinds?.[state.slot] || null})
  const url = URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}))
  const a=document.createElement('a');a.href=url;a.download=`${program.revisionId}-${state.slot}-draft.json`;a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
  status.textContent='Снимок подготовлен. Факты пусты; программа не активирована.'
 } catch(error) { status.textContent=error.message }
})
