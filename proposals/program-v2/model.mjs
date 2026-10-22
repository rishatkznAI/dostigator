// This review contract permits only the current proposal contents. New exercises
// require a reviewed revision; arbitrary imported JSON cannot expand the plan.
const permitted = Object.freeze({
 A: ['leg_press','chest_press','lat_pulldown','leg_curl','lateral_raise','knee_raise'],
 B: ['incline_db_press','seated_row','leg_press','leg_curl','lateral_raise','triceps_pushdown'],
 C: []
})
const optionalPermitted = Object.freeze({biceps:['biceps_curl'],calves:['calf_raise'],abs:['knee_raise','cable_crunch']})
export function validateDraftProgram(program) {
 if (program.status !== 'proposal' || program.active !== false || program.activation !== null) throw new Error('Допускается только неактивированный черновик')
 if (program.policies.automaticHeavyAxialExerciseAdditions !== false || program.policies.activationRequiresSeparateAgreement !== true) throw new Error('Нарушены ограничения согласования')
 if (!program.excludedExerciseKeys.includes('rdl')) throw new Error('Румынская тяга должна оставаться исключённой')
 if (program.sessions.length !== 3 || new Set(program.sessions.map(x=>x.slot)).size !== 3) throw new Error('Неверный набор дней')
 for (const session of program.sessions) {
  if (!permitted[session.slot] || JSON.stringify(session.items.map(x=>x.exerciseKey)) !== JSON.stringify(permitted[session.slot])) throw new Error('Новые упражнения требуют отдельного согласования')
  if (session.slot !== 'C' && (session.timeLimitMinutes !== 75 || !session.mandatory || JSON.stringify(session.cardio.durationMinutes) !== '[20,20]')) throw new Error('Сохрани лимит 75 минут и 20 минут кардио')
  if (session.slot === 'C' && session.mandatory !== false) throw new Error('Суббота остаётся необязательной')
  if (session.cardio.parentSlot !== session.slot || session.cardio.blockId !== session.id + ':cardio' || session.cardio.actual !== null) throw new Error('Нарушено разделение плана и факта кардио')
  for (const group of session.optionalItems ?? []) {
   if (!optionalPermitted[group.slot] || group.variants.some(v=>!optionalPermitted[group.slot].includes(v.exerciseKey))) throw new Error('Новый вариант требует отдельного согласования')
  }
 }
 if (!Array.isArray(program.pendingSubstitutions) || program.pendingSubstitutions.length !== 0) throw new Error('Замены сняты с согласования; новые варианты требуют отдельного решения')
 return true
}

export function derivePlan(program, slot, options = {}) {
  validateDraftProgram(program)
  if (options.substitutionId != null || options.activate === true) throw new Error('Замена и активация требуют отдельного согласования')
  const source = program.sessions.find((session) => session.slot === slot)
  if (!source) throw new Error('Неизвестный день')
  const plan = structuredClone(source)
  delete plan.optionalItems
  plan.programRevisionId = program.revisionId
  plan.volumeMode = options.reduced && source.mandatory ? 'reduced-preview' : 'standard'
  if (plan.volumeMode === 'reduced-preview') plan.items = plan.items.map((item) => ({ ...item, workingSets: Math.min(2, item.workingSets) }))
  if (!source.mandatory && options.equipmentOkay === true && options.noDiscomfort === true) {
    const selections = options.optionalSelections ?? {}
    plan.items = (source.optionalItems ?? []).flatMap((item) => {
      const variant = item.variants.find((candidate) => candidate.exerciseKey === selections[item.slot])
      return variant ? [{ ...structuredClone(item), exerciseKey: variant.exerciseKey, name: variant.name, restSeconds: null, prescribedWeightKg: null, preliminaryLoad: null }] : []
    })
  }
  const requested = options.cardioMinutes ?? source.cardio.durationMinutes[0]
  if (!Number.isFinite(requested) || requested < source.cardio.durationMinutes[0] || requested > source.cardio.durationMinutes[1]) throw new Error('Продолжительность вне согласуемого диапазона')
  plan.cardio = { ...plan.cardio, plannedMinutesForPreview: requested, actual: null }
  return plan
}

export function estimateBudget(program, plan, workSetSeconds = 60) {
  if (!Number.isFinite(workSetSeconds) || workSetSeconds <= 0) throw new Error('Укажи время подхода')
  const assumptions = program.policies.timerAssumptions
  const sets = plan.items.reduce((sum, item) => sum + item.workingSets, 0)
  const restSeconds = plan.items.reduce((sum, item) => sum + Math.max(0, item.workingSets - 1) * (item.restSeconds?.[1] ?? assumptions.optionalExerciseRestSeconds), 0)
  const warmupMinutes = plan.mandatory || plan.items.length ? assumptions.warmupMinutes : 5
  const transitionMinutes = plan.mandatory ? assumptions.transitionMinutes : 2 + plan.items.length * 2
  const strengthMinutes = (sets * workSetSeconds + restSeconds) / 60
  const totalMinutes = warmupMinutes + strengthMinutes + transitionMinutes + plan.cardio.plannedMinutesForPreview
  return { workingSets: sets, warmupMinutes, transitionMinutes, strengthMinutes, restMinutes: restSeconds / 60, cardioMinutes: plan.cardio.plannedMinutesForPreview, totalMinutes, reserveMinutes: plan.timeLimitMinutes === null ? null : plan.timeLimitMinutes - totalMinutes, fits: plan.timeLimitMinutes === null ? null : totalMinutes <= plan.timeLimitMinutes }
}

// Missing identity/confirmation metadata is a rejection, never an assumption.
export function comparableResult(result, context) {
  const identity = ['programRevisionId', 'slot', 'exerciseKey', 'equipmentId', 'weightConvention', 'volumeMode']
  if (identity.some((key) => !context[key] || result[key] !== context[key])) return false
  if (['unknown', 'unspecified', 'legacy'].includes(context.equipmentId) || ['unknown', 'unspecified'].includes(context.weightConvention)) return false
  if (!Array.isArray(context.repRange) || JSON.stringify(result.repRange) !== JSON.stringify(context.repRange)) return false
  if (result.sessionStatus !== 'completed' || result.confirmed !== true || result.discomfort !== false || result.exerciseSkipped !== false) return false
  if (!Number.isFinite(Date.parse(result.finishedAt)) || !Number.isFinite(Date.parse(context.before)) || Date.parse(result.finishedAt) >= Date.parse(context.before)) return false
  if (!Array.isArray(result.sets)) return false
  const work = result.sets.filter((set) => !set.isWarmup)
  return work.length === context.workingSets && work.length > 0 && work.every((set) => set.done === true && set.skipped !== true && Number.isFinite(set.weightKg) && set.weightKg >= 0 && Number.isInteger(set.reps) && set.reps > 0)
}

export function selectComparableResults(history, context) {
  const unique = new Map()
  for (const result of history) if (result.id && comparableResult(result, context)) unique.set(result.id, result)
  return [...unique.values()].sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
}

export function proposeProgression(history, context, weightStep) {
  const [last, earlier] = selectComparableResults(history, context)
  if (!last) return { mode: 'baseline', targets: [], reason: 'Нет сопоставимых подтверждённых результатов v2. Предварительный вес не назначен.' }
  const sets = last.sets.filter((set) => !set.isWarmup)
  const repeat = (reason) => ({ mode: 'repeat', targets: sets.map(({ weightKg, reps }) => ({ weightKg, reps, optional: false })), reason })
  const [min, max] = context.repRange
  if (context.volumeMode !== 'standard' || (Date.parse(context.before) - Date.parse(last.finishedAt)) / 86400000 >= 14) return repeat('Сокращённый объём или давний результат: без прибавки.')
  if (sets.some((set) => set.reps < min || (set.rir != null && set.rir < 2))) return repeat('Не все подходы выполнены в диапазоне либо отмечен малый запас: без прибавки.')
  const older = earlier?.sets.filter((set) => !set.isWarmup)
  if (older && sets.some((set, index) => set.weightKg < older[index].weightKg || (set.weightKg === older[index].weightKg && set.reps < older[index].reps))) return repeat('Вес или повторы ниже предыдущего сопоставимого результата: без прибавки.')
  if (sets.every((set) => set.reps >= max)) {
    const weight = sets[0].weightKg
    const stable = older && sets.every((set, index) => set.weightKg === weight && older[index].weightKg === weight && older[index].reps >= max && (older[index].rir == null || older[index].rir >= 2))
    if (!stable || !Number.isFinite(weightStep) || weightStep <= 0 || !weight || weightStep > weight * 0.1 || weight + weightStep > 1000) return repeat('Для следующего веса нужны два полных выполнения верхней границы и подтверждённый небольшой шаг оборудования.')
    return { mode: 'weight', targets: sets.map(() => ({ weightKg: weight + weightStep, reps: min, optional: true })), reason: 'Верх диапазона подтверждён дважды; следующий вес предлагается добровольно.' }
  }
  const index = sets.findIndex((set) => set.reps < max)
  return { mode: 'reps', targets: sets.map((set, i) => ({ weightKg: set.weightKg, reps: set.reps + (index === i ? 1 : 0), optional: index === i })), reason: 'Все рабочие подходы в диапазоне; можно попробовать один дополнительный повтор.' }
}
