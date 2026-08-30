export type OnboardingStatus = 'active' | 'skipped' | 'completed'

const keyFor = (ownerId: string) => `dostigator:onboarding:v1:${ownerId}`

export function readOnboardingStatus(ownerId: string): OnboardingStatus | null {
  try {
    const value = localStorage.getItem(keyFor(ownerId))
    return value === 'active' || value === 'skipped' || value === 'completed' ? value : null
  } catch {
    return null
  }
}

export function writeOnboardingStatus(ownerId: string, status: OnboardingStatus) {
  try { localStorage.setItem(keyFor(ownerId), status) } catch { /* React state remains authoritative for this session. */ }
}

export function hasExistingProductData(data: { goals: unknown[]; actions: unknown[]; habits: unknown[]; checkins: unknown[]; reviews: unknown[] }) {
  return data.goals.length > 0 || data.actions.length > 0 || data.habits.length > 0 || data.checkins.length > 0 || data.reviews.length > 0
}
