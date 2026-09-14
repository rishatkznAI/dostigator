import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function journalCases(admin, asUser, ownerA, ownerB) {
  const id = randomUUID()
  const createdId = randomUUID()
  const row = { id, date: '2026-09-14', entry_type: 'idea', title: 'Journal test', content: 'A thought\nA plan' }
  const apply = async (owner, op, revision, after = row, mutationId = randomUUID()) => {
    const r = await asUser(admin, owner, 'select public.dostigator_apply_mutation($1,$2,\'journal\',$3,$4,\'Journal test\',$5,$6::jsonb,\'ui\') as result', [owner, mutationId, after.id, op, revision, JSON.stringify(after)])
    return r.rows[0].result
  }
  const undo = async (original) => (await asUser(admin, ownerA,
    'select public.dostigator_undo_mutation($1,$2,$3) as result', [ownerA, original, randomUUID()])).rows[0].result
  const created = await apply(ownerA, 'journal_create', 0, row, createdId)
  assert.equal(created.row.revision, 1)
  assert.equal((await apply(ownerA, 'journal_create', 0, row, createdId)).idempotent, true)
  assert.deepEqual((await asUser(admin, ownerB, 'select * from public.dostigator_journals where id=$1', [id])).rows, [])
  await assert.rejects(() => apply(ownerB, 'journal_edit', 1), /missing or stale/)
  await assert.rejects(() => asUser(admin, ownerA, 'update public.dostigator_journals set title=\'forged\' where id=$1', [id]), /permission denied/)
  const edited = await apply(ownerA, 'journal_edit', 1, { ...row, content: 'Revised thought' })
  await assert.rejects(() => apply(ownerA, 'journal_edit', 1), /revision conflict/)
  await assert.rejects(() => undo(createdId), /newer changes/)
  const reverted = await undo(edited.event.mutation_id)
  assert.equal(reverted.row.content, row.content)
  assert.equal(reverted.row.revision, 3)
  const removed = await apply(ownerA, 'journal_delete', 3)
  assert.equal(removed.row, null)
  const restored = await undo(removed.event.mutation_id)
  assert.equal(restored.row.revision, 5)
  assert.equal(restored.row.content, row.content)
  await assert.rejects(() => undo(removed.event.mutation_id), /already undone/)
  const disposable = await apply(ownerA, 'journal_create', 0, { ...row, id: randomUUID() })
  assert.equal((await undo(disposable.event.mutation_id)).row, null)
  await assert.rejects(() => apply(ownerA, 'journal_create', 0, { ...row, id: randomUUID(), date: '2026-02-30' }), /date|range/)
  const payload = { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [], journals: [row] }
  const importId = randomUUID()
  const imported = await asUser(admin, ownerB, 'select public.dostigator_import_backup($1,$2,$3) as result', [ownerB, importId, JSON.stringify(payload)])
  assert.equal(imported.rows[0].result.counts.journals, 1)
  const ownCopy = (await asUser(admin, ownerB, 'select * from public.dostigator_journals')).rows
  assert.equal(ownCopy.length, 1)
  assert.notEqual(ownCopy[0].id, id)
  assert.equal(ownCopy[0].content, row.content)
  const retry = await asUser(admin, ownerB, 'select public.dostigator_import_backup($1,$2,$3) as result', [ownerB, importId, JSON.stringify(payload)])
  assert.equal(retry.rows[0].result.idempotent, true)
  const invalidPayload = { ...payload, journals: [{ ...row, id: randomUUID() }, { ...row, id: randomUUID(), entry_type: 'invalid' }] }
  await assert.rejects(() => asUser(admin, ownerB, 'select public.dostigator_import_backup($1,$2,$3)', [ownerB, randomUUID(), JSON.stringify(invalidPayload)]), /invalid journal/)
  assert.equal((await asUser(admin, ownerB, 'select * from public.dostigator_journals')).rows.length, 1)
  // Isolate fixtures from the existing history pagination assertions.
  await admin.query('delete from public.dostigator_history_events where entity_type=\'journal\' and operation=\'undo\'')
  await admin.query('delete from public.dostigator_history_events where entity_type=\'journal\'')
  await admin.query('delete from public.dostigator_journals')
  console.log('Journal: CRUD, replay, stale edits, undo, RLS and atomic cross-account import passed.')
}
