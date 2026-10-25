import { useEffect } from 'react'
import { CARDIO_CHANGED_EVENT, syncCardio } from '../lib/cardio'
import { CARDIO_PHOTO_CHANGED, readPendingPhoto, syncCardioPhotos } from '../lib/cardio-photos'

export function useCardioSync(userId?: string) {
  useEffect(() => {
    if (!userId) return
    const sync = () => { void syncCardio(userId).catch(() => undefined).then(async () => {
      if (await readPendingPhoto(userId)) await syncCardioPhotos(userId)
    }).catch(() => undefined) }
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ userId: string }>).detail.userId === userId) sync()
    }
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    window.addEventListener(CARDIO_CHANGED_EVENT, changed)
    window.addEventListener(CARDIO_PHOTO_CHANGED, changed)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener(CARDIO_CHANGED_EVENT, changed)
      window.removeEventListener(CARDIO_PHOTO_CHANGED, changed)
    }
  }, [userId])
}
