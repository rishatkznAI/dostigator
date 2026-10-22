// Local sidecar only: these fields are never included in cloud payloads.
export type CardioDetails = { speed: string; incline: string; resistance: string }
export const emptyCardioDetails = (): CardioDetails => ({ speed: '', incline: '', resistance: '' })
const key = (userId: string, id: string) => `trainlog:cardio-details:${userId}:${id}`
export function loadCardioDetails(userId: string, id: string): CardioDetails {
  try { return { ...emptyCardioDetails(), ...JSON.parse(localStorage.getItem(key(userId, id)) ?? '{}') } } catch { return emptyCardioDetails() }
}
export function saveCardioDetails(userId: string, id: string, details: CardioDetails) {
  localStorage.setItem(key(userId, id), JSON.stringify(details))
}
