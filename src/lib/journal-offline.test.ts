import { afterEach, expect, it, vi } from 'vitest'
import type { MutationDescriptor } from '../types'

const owner = '10000000-0000-4000-8000-000000000001'
vi.mock('./supabase', () => ({ supabase: {
  auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: '10000000-0000-4000-8000-000000000001' } } }, error: null })) },
} }))
import { persistOrQueue, readQueue } from './offline'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

it('durably queues journal creation, editing and deletion while offline', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const id = crypto.randomUUID()
  const mutationId = crypto.randomUUID()
  const time = new Date().toISOString()
  const row = { id, date: '2026-09-14', entry_type: 'idea', title: 'A thought', content: 'Remember this',
    created_at: time, updated_at: time, revision: 1, last_mutation_id: mutationId }
  const create: MutationDescriptor = { mutationId, entityType: 'journal', entityId: id,
    operation: 'journal_create', label: 'Journal created', baseRevision: 0, before: null }
  expect((await persistOrQueue(owner, 'dostigator_journals', row, create)).status).toBe('pending')
  const editId = crypto.randomUUID()
  const edited = { ...row, content: 'A clearer thought', revision: 2, last_mutation_id: editId }
  await persistOrQueue(owner, 'dostigator_journals', edited, { ...create, mutationId: editId,
    operation: 'journal_edit', label: 'Journal edited', baseRevision: 1, before: row })
  await persistOrQueue(owner, 'dostigator_journals', edited, { ...create, mutationId: crypto.randomUUID(),
    operation: 'journal_delete', label: 'Journal deleted', baseRevision: 2, before: edited })
  const queue = readQueue(owner)
  expect(queue.map((item) => item.mutation?.operation)).toEqual(['journal_create', 'journal_edit', 'journal_delete'])
  expect(queue[1].payload?.content).toBe('A clearer thought')
  expect(readQueue('20000000-0000-4000-8000-000000000002')).toEqual([])
})
