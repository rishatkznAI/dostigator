import { useEffect } from 'react'
import { CARDIO_CHANGED_EVENT, syncCardio } from '../lib/cardio'

export function useCardioSync(userId?: string) {
  useEffect(() => {
    if (!userId) return
    const sync = () => { void syncCardio(userId).catch(() => undefined) }
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ userId: string }>).detail.userId === userId) sync()
    }
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    window.addEventListener(CARDIO_CHANGED_EVENT, changed)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener(CARDIO_CHANGED_EVENT, changed)
    }
  }, [userId])
}
