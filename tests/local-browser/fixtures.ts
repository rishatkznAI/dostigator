import type { WorkoutTemplate, HistoryWorkout } from '../../src/types/training'

export const template: WorkoutTemplate = { code: 'A', title: 'Спина и грудь', sortOrder: 1, items: [{ sortOrder: 1, setCount: 3, repTarget: '8–12', exercise: { key: 'lat_pulldown', name: 'Тяга верхнего блока', muscles: ['широчайшие', 'бицепс'], steps: ['Опусти плечи, тяни рукоять к груди без рывков'], mistakes: ['Не раскачивайся'], youtube_url: null } }, { sortOrder: 2, setCount: 3, repTarget: '8–12', exercise: { key: 'chest_press', name: 'Жим в тренажёре', muscles: ['грудь', 'трицепс'], steps: ['Удерживай лопатки у спинки'], mistakes: ['Не выпрямляй локти рывком'], youtube_url: null } }] }

export const owner = 'local-training-test'
export const fixtureHistory: HistoryWorkout[] = [
  ['2026-10-12', 50, [10, 10, 10]], ['2026-10-09', 50, [9, 9, 9]],
  ['2026-10-02', 47.5, [12, 12, 12]], ['2026-09-25', 47.5, [12, 12, 12]],
  ['2026-09-18', 45, [10, 10, 10]], ['2026-09-11', 45, [9, 9, 9]],
].map(([day, weight, reps], i) => ({
  id: `fixture-${i}`, templateCode: 'A', title: template.title, startedAt: `${day}T09:00:00Z`, finishedAt: `${day}T10:00:00Z`, timerPausedDurationMs: 0, readinessMode: null,
  exercises: template.items.map((item) => ({ id: `fixture-e-${i}-${item.sortOrder}`, exerciseKey: item.exercise.key, exerciseName: item.exercise.name, target: item.repTarget, sortOrder: item.sortOrder, skipped: false, skipReason: '',
    sets: (item.sortOrder === 1 ? reps as number[] : [12, 12, 12]).map((r, index) => ({ id: `fixture-set-${i}-${item.sortOrder}-${index}`, setNumber: index + 1, weightKg: item.sortOrder === 1 ? weight as number : 40, reps: r, rir: null, done: true, isWarmup: false, completedAt: `${day}T10:00:00Z` }))
  }))
}))
