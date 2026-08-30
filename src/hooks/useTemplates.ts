import { useCallback, useEffect, useState } from 'react'
import { loadTemplates } from '../lib/trainingRepository'
import type { WorkoutTemplate } from '../types/training'

export function useTemplates() {
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setTemplates(await loadTemplates())
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить программу')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => void refresh(), [refresh])
  return { templates, loading, error, refresh }
}
