import { derivePlan, estimateBudget } from './model.mjs'

function freeze(value) {
 if (value && typeof value === 'object') {
  Object.values(value).forEach(freeze)
  Object.freeze(value)
 }
 return value
}

// Preparation boundary only. No repository, browser storage, sync queue, network,
// legacy history or activation endpoint is accepted by this module.
export function prepareLocalSessionDraft(program, slot, options = {}) {
 const supported = ['reduced','cardioMinutes','equipmentOkay','noDiscomfort','optionalSelections','workSetSeconds','cardioActivityForReview']
 if (Object.keys(options).some(key=>!supported.includes(key))) throw new Error('Неизвестный параметр локального черновика')
 const activity = options.cardioActivityForReview ?? null
 if (activity !== null && !['walk','elliptical','bike','outdoor'].includes(activity)) throw new Error('Неизвестная активность кардио')
 const plan = derivePlan(program, slot, options)
 const budget = estimateBudget(program, plan, options.workSetSeconds ?? program.policies.timerAssumptions.workSetSeconds)
 if (budget.fits === false) throw new Error('Снимок не подготовлен: превышен лимит 75 минут вместе с кардио')
 return freeze({
  schemaVersion: 1,
  kind: 'local-program-session-review',
  status: 'draft-not-started',
  scope: 'local-only',
  programId: program.programId,
  programRevisionId: program.revisionId,
  activeProgramAssignment: null,
  activation: null,
  planSnapshot: plan,
  budget,
  budgetAssumptions: { ...structuredClone(program.policies.timerAssumptions), workSetSeconds: options.workSetSeconds ?? program.policies.timerAssumptions.workSetSeconds },
  reviewSelections: { cardioActivityKind: activity },
  // Empty facts are separate; estimates and preliminary weights are never facts.
  actualStrengthSets: [],
  actualCardio: null,
  pendingSubstitutionIds: (program.pendingSubstitutions ?? []).filter(x=>x.slot===slot).map(x=>x.id),
  writes: [],
  requiresSeparateActivationAgreement: true
 })
}
