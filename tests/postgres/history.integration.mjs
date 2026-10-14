import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import { journalCases } from './journal.cases.mjs'
import { cardioCases } from './cardio.cases.mjs'

const ownerA = '10000000-0000-4000-8000-000000000001'
const ownerB = '20000000-0000-4000-8000-000000000002'
const goalId = '30000000-0000-4000-8000-000000000003'
const mutation = (suffix) => `40000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`
const root = await mkdtemp(join(tmpdir(), 'dostigator-postgres-'))
const port = 56000 + (process.pid % 4000)
const postgres = new EmbeddedPostgres({
  databaseDir: join(root, 'db'),
  user: 'postgres',
  password: 'dostigator-test',
  port,
  persistent: false,
  onLog: () => undefined,
  onError: () => undefined,
})

let admin
const clients = []

async function asUser(client, ownerId, sql, params = []) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ownerId])
    const result = await client.query(sql, params)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function expectRejected(action, pattern) {
  let caught
  try { await action() } catch (error) { caught = error }
  assert.ok(caught, 'expected PostgreSQL to reject the operation')
  assert.match(String(caught.message), pattern)
}

function goalPayload(title, status = 'active') {
  return {
    id: goalId,
    area_id: null,
    title,
    description: 'Описание',
    why: 'Причина',
    kind: 'goal',
    status,
    progress: status === 'completed' ? 100 : 0,
    target_date: null,
    completed_at: status === 'completed' ? '2026-08-28T08:00:00.000Z' : null,
    created_at: '2026-08-28T08:00:00.000Z',
    updated_at: '2026-08-28T08:00:00.000Z',
  }
}

async function apply(client, ownerId, {
  mutationId,
  entityType,
  entityId,
  operation,
  label,
  expectedRevision,
  after,
  source = 'ui',
}, expectedOwnerId = ownerId) {
  return asUser(client, ownerId, `
    select public.dostigator_apply_mutation($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) as result
  `, [expectedOwnerId, mutationId, entityType, entityId, operation, label, expectedRevision, JSON.stringify(after), source])
}

async function undo(client, ownerId, originalMutationId, undoMutationId, expectedOwnerId = ownerId) {
  return asUser(client, ownerId, `
    select public.dostigator_undo_mutation($1, $2, $3, 'undo') as result
  `, [expectedOwnerId, originalMutationId, undoMutationId])
}

async function importBackup(client, ownerId, importId, payload, expectedOwnerId = ownerId) {
  return asUser(client, ownerId, `
    select public.dostigator_import_backup($1, $2, $3::jsonb) as result
  `, [expectedOwnerId, importId, JSON.stringify(payload)])
}

try {
  await postgres.initialise()
  await postgres.start()
  admin = postgres.getPgClient()
  clients.push(admin)
  await admin.connect()

  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create schema storage;
    create table auth.users (id uuid primary key);
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id) on delete cascade,
      name text not null
    );
    create or replace function storage.foldername(name text) returns text[]
      language sql immutable
      as $$ select string_to_array(name, '/') $$;
    alter table storage.objects enable row level security;
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users (id) values ('${ownerA}'), ('${ownerB}');
  `)
  const migrationDir = join(process.cwd(), 'supabase', 'migrations')
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) await admin.query(await readFile(join(migrationDir, file), 'utf8'))
  await journalCases(admin, asUser, ownerA, ownerB)
  await cardioCases(admin, asUser, ownerA, ownerB)
  // The retroactive base migration must also be safe on an already-evolved database.
  await admin.query(await readFile(join(migrationDir, '20260825051101_create_trainlog_core_schema.sql'), 'utf8'))
  const trainlogTables = [
    'exercise_library', 'workout_templates', 'workout_template_items', 'workout_sessions',
    'workout_session_exercises', 'workout_sets', 'body_measurements', 'nutrition_entries', 'daily_activity', 'cardio_sessions',
  ]
  assert.deepEqual((await admin.query(`
    select relname from pg_class
    where relnamespace = 'public'::regnamespace
      and relname = any($1::text[])
      and relrowsecurity = false
  `, [trainlogTables])).rows, [], 'every TrainLog table must have RLS enabled')
  assert.deepEqual((await admin.query(`
    select
      has_table_privilege('anon', 'public.exercise_library', 'select') as anon_library,
      has_table_privilege('anon', 'public.workout_templates', 'select') as anon_templates,
      has_table_privilege('anon', 'public.workout_template_items', 'select') as anon_template_items,
      has_table_privilege('authenticated', 'public.exercise_library', 'select') as auth_library,
      has_table_privilege('authenticated', 'public.workout_templates', 'select') as auth_templates,
      has_table_privilege('authenticated', 'public.workout_template_items', 'select') as auth_template_items
  `)).rows[0], {
    anon_library: true, anon_templates: true, anon_template_items: true,
    auth_library: true, auth_templates: true, auth_template_items: true,
  })
  await admin.query('begin')
  await admin.query('set local role anon')
  assert.equal(Number((await admin.query('select count(*) from public.exercise_library')).rows[0].count), 20)
  assert.equal(Number((await admin.query('select count(*) from public.workout_templates')).rows[0].count), 3)
  assert.equal(Number((await admin.query('select count(*) from public.workout_template_items')).rows[0].count), 22)
  await admin.query('commit')
  assert.deepEqual((await admin.query(`
    select
      to_regprocedure('public.dostigator_apply_mutation(uuid,text,uuid,text,text,bigint,jsonb,text)') is null as old_apply_absent,
      to_regprocedure('public.dostigator_undo_mutation(uuid,uuid,text)') is null as old_undo_absent,
      to_regprocedure('public.dostigator_apply_mutation(uuid,uuid,text,uuid,text,text,bigint,jsonb,text)') is not null as new_apply_present,
      to_regprocedure('public.dostigator_undo_mutation(uuid,uuid,uuid,text)') is not null as new_undo_present,
      has_function_privilege(
        'authenticated', 'public.dostigator_apply_mutation(uuid,uuid,text,uuid,text,text,bigint,jsonb,text)', 'execute'
      ) as authenticated_apply,
      not has_function_privilege(
        'anon', 'public.dostigator_apply_mutation(uuid,uuid,text,uuid,text,text,bigint,jsonb,text)', 'execute'
      ) as anon_apply_blocked,
      has_function_privilege(
        'authenticated', 'public.dostigator_undo_mutation(uuid,uuid,uuid,text)', 'execute'
      ) as authenticated_undo,
      not has_function_privilege(
        'anon', 'public.dostigator_undo_mutation(uuid,uuid,uuid,text)', 'execute'
      ) as anon_undo_blocked,
      has_function_privilege(
        'authenticated', 'public.dostigator_import_backup(uuid,uuid,jsonb)', 'execute'
      ) as authenticated_import,
      not has_function_privilege(
        'anon', 'public.dostigator_import_backup(uuid,uuid,jsonb)', 'execute'
      ) as anon_import_blocked
  `)).rows[0], {
    old_apply_absent: true, old_undo_absent: true, new_apply_present: true, new_undo_present: true,
    authenticated_apply: true, anon_apply_blocked: true, authenticated_undo: true, anon_undo_blocked: true,
    authenticated_import: true, anon_import_blocked: true,
  })

  const createMutation = mutation(1)
  await apply(admin, ownerA, {
    mutationId: createMutation, entityType: 'goal', entityId: goalId, operation: 'goal_create',
    label: 'Создана цель', expectedRevision: 0, after: goalPayload('Первая версия'),
  })
  await apply(admin, ownerA, {
    mutationId: createMutation, entityType: 'goal', entityId: goalId, operation: 'goal_create',
    label: 'Создана цель', expectedRevision: 0, after: goalPayload('Первая версия'),
  })
  assert.deepEqual((await admin.query(`
    select
      (select count(*)::int from public.dostigator_goals where id = $1) as rows,
      (select count(*)::int from public.dostigator_history_events where mutation_id = $2) as events,
      (select revision::int from public.dostigator_goals where id = $1) as revision,
      (select request_envelope->>'expected_owner' from public.dostigator_mutation_requests
        where user_id = $3 and mutation_id = $2) as expected_owner
  `, [goalId, createMutation, ownerA])).rows[0], {
    rows: 1, events: 1, revision: 1, expected_owner: ownerA,
  })
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: createMutation, entityType: 'goal', entityId: goalId, operation: 'goal_create',
    label: 'Создана цель', expectedRevision: 0, after: goalPayload('Другой запрос с тем же ID'),
  }), /different request envelope/)
  assert.deepEqual((await admin.query(`
    select title, revision::int,
      (select count(*)::int from public.dostigator_history_events where mutation_id = $2) as events
    from public.dostigator_goals where id = $1
  `, [goalId, createMutation])).rows[0], { title: 'Первая версия', revision: 1, events: 1 })

  const editMutation = mutation(2)
  await apply(admin, ownerA, {
    mutationId: editMutation, entityType: 'goal', entityId: goalId, operation: 'goal_edit',
    label: 'Изменена цель', expectedRevision: 1, after: goalPayload('Вторая версия'),
  })
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(3), entityType: 'goal', entityId: goalId, operation: 'goal_edit',
    label: 'Устаревшее изменение', expectedRevision: 1, after: goalPayload('Нельзя сохранить'),
  }), /revision conflict/)
  assert.deepEqual((await admin.query('select title, revision::int from public.dostigator_goals where id = $1', [goalId])).rows[0], {
    title: 'Вторая версия', revision: 2,
  })

  const ownerBRows = await asUser(admin, ownerB, `
    select
      (select count(*)::int from public.dostigator_goals) as goals,
      (select count(*)::int from public.dostigator_history_events) as history
  `)
  assert.deepEqual(ownerBRows.rows[0], { goals: 0, history: 0 })
  await expectRejected(() => apply(admin, ownerB, {
    mutationId: mutation(4), entityType: 'goal', entityId: goalId, operation: 'goal_edit',
    label: 'Чужое изменение', expectedRevision: 2, after: goalPayload('Чужое'),
  }), /missing or stale/)
  await expectRejected(() => asUser(admin, ownerA, `update public.dostigator_goals set title = 'forged' where id = $1`, [goalId]), /permission denied/)
  await expectRejected(() => asUser(admin, ownerA, `
    insert into public.dostigator_history_events (
      user_id, mutation_id, entity_type, entity_id, operation, label,
      base_revision, result_revision
    ) values ($1, $2, 'goal', $3, 'goal_edit', 'Подделка', 2, 3)
  `, [ownerA, mutation(5), goalId]), /permission denied/)
  await expectRejected(() => asUser(admin, ownerA, `delete from public.dostigator_history_events`), /permission denied/)
  await expectRejected(() => asUser(admin, ownerA, `select * from public.dostigator_mutation_requests`), /permission denied/)
  await expectRejected(() => asUser(admin, ownerA, `insert into public.dostigator_mutation_requests (
    user_id, mutation_id, request_envelope
  ) values ($1, $2, '{}'::jsonb)`, [ownerA, mutation(5)]), /permission denied/)
  await expectRejected(() => asUser(admin, ownerA, `
    select public.dostigator_valid_activity_periods('[{"started_on":"2026-08-25","ended_on":null}]'::jsonb, true)
  `), /permission denied/)
  await expectRejected(() => asUser(admin, ownerA, `
    select public.dostigator_valid_iso_monday('2026-08-24')
  `), /permission denied/)
  await expectRejected(() => asUser(admin, ownerA, `
    select public.dostigator_valid_weekly_metrics('null'::jsonb, '2026-08-24')
  `), /permission denied/)

  const undoEdit = mutation(6)
  await undo(admin, ownerA, editMutation, undoEdit)
  assert.deepEqual((await admin.query('select title, revision::int from public.dostigator_goals where id = $1', [goalId])).rows[0], {
    title: 'Первая версия', revision: 3,
  })
  const undoRetry = await undo(admin, ownerA, editMutation, undoEdit)
  assert.equal(undoRetry.rows[0].result.idempotent, true)
  assert.equal((await admin.query(`
    select request_envelope->>'expected_owner' as expected_owner
    from public.dostigator_mutation_requests where user_id = $1 and mutation_id = $2
  `, [ownerA, undoEdit])).rows[0].expected_owner, ownerA)
  await expectRejected(() => undo(admin, ownerA, createMutation, undoEdit), /different request envelope/)
  await expectRejected(() => undo(admin, ownerA, editMutation, mutation(7)), /already undone/)

  await apply(admin, ownerA, {
    mutationId: mutation(8), entityType: 'goal', entityId: goalId, operation: 'goal_edit',
    label: 'Новое изменение', expectedRevision: 3, after: goalPayload('Третья версия'),
  })
  await expectRejected(() => undo(admin, ownerA, createMutation, mutation(9)), /newer changes block undo/)

  const actionId = '50000000-0000-4000-8000-000000000010'
  const actionPayload = {
    id: actionId, goal_id: goalId, title: 'Точный шаг', status: 'todo', due_date: '2026-09-01',
    focus_date: null, focus_position: null, result_note: 'исходно', completed_at: null,
    created_at: '2026-08-28T08:00:00.000Z', updated_at: '2026-08-28T08:00:00.000Z',
  }
  await apply(admin, ownerA, {
    mutationId: mutation(10), entityType: 'action', entityId: actionId, operation: 'action_create',
    label: 'Создано действие', expectedRevision: 0, after: actionPayload,
  })
  const actionDelete = mutation(11)
  await apply(admin, ownerA, {
    mutationId: actionDelete, entityType: 'action', entityId: actionId, operation: 'action_delete',
    label: 'Удалено действие', expectedRevision: 1, after: { ...actionPayload, status: 'cancelled' },
  })
  await undo(admin, ownerA, actionDelete, mutation(12))
  assert.deepEqual((await admin.query(`
    select id::text, title, status, due_date::text, result_note, revision::int
    from public.dostigator_actions where id = $1
  `, [actionId])).rows[0], {
    id: actionId, title: 'Точный шаг', status: 'todo', due_date: '2026-09-01', result_note: 'исходно', revision: 3,
  })

  const dependentGoalId = '30000000-0000-4000-8000-000000000013'
  const dependentGoalCreate = mutation(13)
  await apply(admin, ownerA, {
    mutationId: dependentGoalCreate, entityType: 'goal', entityId: dependentGoalId, operation: 'goal_create',
    label: 'Создана зависимая цель', expectedRevision: 0, after: { ...goalPayload('Цель с шагом'), id: dependentGoalId },
  })
  const dependentActionId = '50000000-0000-4000-8000-000000000014'
  await apply(admin, ownerA, {
    mutationId: mutation(14), entityType: 'action', entityId: dependentActionId, operation: 'action_create',
    label: 'Создан зависимый шаг', expectedRevision: 0,
    after: { ...actionPayload, id: dependentActionId, goal_id: dependentGoalId },
  })
  await expectRejected(() => undo(admin, ownerA, dependentGoalCreate, mutation(15)), /dependent actions/)

  const habitId = '60000000-0000-4000-8000-000000000016'
  const activityPeriods = [{ started_on: '2026-08-25', ended_on: null }]
  await apply(admin, ownerA, {
    mutationId: mutation(16), entityType: 'habit', entityId: habitId, operation: 'habit_create',
    label: 'Создана привычка', expectedRevision: 0,
    after: {
      id: habitId, area_id: null, title: 'Читать', target_per_week: 5, active: true,
      activity_periods: activityPeriods, created_at: '2026-08-28T08:00:00.000Z',
      updated_at: '2026-08-28T08:00:00.000Z',
    },
  })
  const pauseMutation = mutation(17)
  await apply(admin, ownerA, {
    mutationId: pauseMutation, entityType: 'habit', entityId: habitId, operation: 'habit_pause',
    label: 'Приостановлена привычка', expectedRevision: 1,
    after: {
      id: habitId, area_id: null, title: 'Читать', target_per_week: 5, active: false,
      activity_periods: [{ started_on: '2026-08-25', ended_on: '2026-08-28' }],
      updated_at: '2026-08-28T09:00:00.000Z',
    },
  })
  await undo(admin, ownerA, pauseMutation, mutation(18))
  const restoredHabit = (await admin.query('select active, activity_periods, revision::int from public.dostigator_habits where id = $1', [habitId])).rows[0]
  assert.equal(restoredHabit.active, true)
  assert.deepEqual(restoredHabit.activity_periods, activityPeriods)
  assert.equal(restoredHabit.revision, 3)

  const checkinId = '70000000-0000-4000-8000-000000000019'
  const checkinPayload = {
    id: checkinId, habit_id: habitId, checked_on: '2026-08-28', note: 'точно',
    created_at: '2026-08-28T09:00:00.000Z',
  }
  await apply(admin, ownerA, {
    mutationId: mutation(19), entityType: 'habit_checkin', entityId: checkinId, operation: 'habit_check',
    label: 'Отмечена привычка', expectedRevision: 0, after: checkinPayload,
  })
  const uncheckMutation = mutation(20)
  await apply(admin, ownerA, {
    mutationId: uncheckMutation, entityType: 'habit_checkin', entityId: checkinId, operation: 'habit_uncheck',
    label: 'Снята отметка', expectedRevision: 1, after: checkinPayload,
  })
  assert.equal((await admin.query('select count(*)::int as count from public.dostigator_habit_checkins where id = $1', [checkinId])).rows[0].count, 0)
  await undo(admin, ownerA, uncheckMutation, mutation(21))
  assert.deepEqual((await admin.query(`
    select id::text, habit_id::text, checked_on::text, note, revision::int
    from public.dostigator_habit_checkins where id = $1
  `, [checkinId])).rows[0], {
    id: checkinId, habit_id: habitId, checked_on: '2026-08-28', note: 'точно', revision: 3,
  })

  const reviewId = '80000000-0000-4000-8000-000000000022'
  const snapshot = {
    score: 72, focus: { done: 2, committed: 3, rate: 2 / 3 }, habits: null, actions: null,
    period: { weekStart: '2026-08-24', asOf: '2026-08-28' },
  }
  await apply(admin, ownerA, {
    mutationId: mutation(22), entityType: 'review', entityId: reviewId, operation: 'review_create',
    label: 'Создан обзор', expectedRevision: 0,
    after: {
      id: reviewId, week_start: '2026-08-24', wins: 'До', blockers: '', next_focus: '',
      self_score: 7, metrics_snapshot: snapshot, created_at: '2026-08-28T09:00:00.000Z',
      updated_at: '2026-08-28T09:00:00.000Z',
    },
  })
  const reviewEdit = mutation(23)
  await apply(admin, ownerA, {
    mutationId: reviewEdit, entityType: 'review', entityId: reviewId, operation: 'review_edit',
    label: 'Изменён обзор', expectedRevision: 1,
    after: {
      id: reviewId, week_start: '2026-08-24', wins: 'После', blockers: 'Наблюдение',
      next_focus: 'Фокус', self_score: 8, metrics_snapshot: { ...snapshot, score: 1 },
      updated_at: '2026-08-28T10:00:00.000Z',
    },
  })
  assert.deepEqual((await admin.query('select metrics_snapshot from public.dostigator_weekly_reviews where id = $1', [reviewId])).rows[0].metrics_snapshot, snapshot)
  await undo(admin, ownerA, reviewEdit, mutation(24))
  const restoredReview = (await admin.query('select wins, metrics_snapshot from public.dostigator_weekly_reviews where id = $1', [reviewId])).rows[0]
  assert.equal(restoredReview.wins, 'До')
  assert.deepEqual(restoredReview.metrics_snapshot, snapshot)

  const forgedImportMutation = mutation(200)
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: forgedImportMutation, entityType: 'review', entityId: reviewId, operation: 'review_edit',
    label: 'Поддельный trusted import', expectedRevision: 3, source: 'import',
    after: {
      id: reviewId, week_start: '2026-08-24', wins: 'Не должно сохраниться', blockers: '', next_focus: '',
      self_score: 1, metrics_snapshot: { ...snapshot, score: 1 },
      updated_at: '2026-08-28T11:00:00.000Z',
    },
  }), /untrusted import source/)
  assert.deepEqual((await admin.query(`
    select wins, metrics_snapshot, revision::int,
      (select count(*)::int from public.dostigator_history_events where mutation_id = $2) as events,
      (select count(*)::int from public.dostigator_mutation_requests where mutation_id = $2) as requests
    from public.dostigator_weekly_reviews where id = $1
  `, [reviewId, forgedImportMutation])).rows[0], {
    wins: 'До', metrics_snapshot: snapshot, revision: 3, events: 0, requests: 0,
  })

  const atomicEventCount = Number((await admin.query('select count(*) from public.dostigator_history_events')).rows[0].count)
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(25), entityType: 'action',
    entityId: '50000000-0000-4000-8000-000000000025', operation: 'action_create',
    label: 'Некорректный шаг', expectedRevision: 0,
    after: {
      ...actionPayload, id: '50000000-0000-4000-8000-000000000025',
      goal_id: '99999999-9999-4999-8999-999999999999',
    },
  }), /foreign key constraint/)
  assert.equal(Number((await admin.query('select count(*) from public.dostigator_history_events')).rows[0].count), atomicEventCount)

  const concurrentA = postgres.getPgClient()
  const concurrentB = postgres.getPgClient()
  clients.push(concurrentA, concurrentB)
  await Promise.all([concurrentA.connect(), concurrentB.connect()])
  const currentGoal = (await admin.query('select revision::int, title from public.dostigator_goals where id = $1', [goalId])).rows[0]
  const concurrentResults = await Promise.allSettled([
    apply(concurrentA, ownerA, {
      mutationId: mutation(26), entityType: 'goal', entityId: goalId, operation: 'goal_edit',
      label: 'Параллельное A', expectedRevision: currentGoal.revision, after: goalPayload('Параллельное A'),
    }),
    apply(concurrentB, ownerA, {
      mutationId: mutation(27), entityType: 'goal', entityId: goalId, operation: 'goal_edit',
      label: 'Параллельное B', expectedRevision: currentGoal.revision, after: goalPayload('Параллельное B'),
    }),
  ])
  assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(concurrentResults.filter((result) => result.status === 'rejected').length, 1)

  const sameMutationRevision = (await admin.query(
    'select revision::int from public.dostigator_goals where id = $1', [goalId],
  )).rows[0].revision
  const sameMutationId = mutation(29)
  const sameMutationRequest = {
    mutationId: sameMutationId, entityType: 'goal', entityId: goalId, operation: 'goal_edit',
    label: 'Один параллельный запрос', expectedRevision: sameMutationRevision,
    after: goalPayload('Один параллельный результат'),
  }
  const sameMutationResults = await Promise.all([
    apply(concurrentA, ownerA, sameMutationRequest),
    apply(concurrentB, ownerA, sameMutationRequest),
  ])
  assert.deepEqual(
    sameMutationResults.map((result) => result.rows[0].result.idempotent).sort(),
    [false, true],
  )
  assert.deepEqual((await admin.query(`
    select title, revision::int,
      (select count(*)::int from public.dostigator_history_events where mutation_id = $2) as events
    from public.dostigator_goals where id = $1
  `, [goalId, sameMutationId])).rows[0], {
    title: 'Один параллельный результат', revision: sameMutationRevision + 1, events: 1,
  })

  const concurrentCreateGoalId = '30000000-0000-4000-8000-000000000030'
  const concurrentCreateMutation = mutation(30)
  const concurrentCreateRequest = {
    mutationId: concurrentCreateMutation,
    entityType: 'goal',
    entityId: concurrentCreateGoalId,
    operation: 'goal_create',
    label: 'Параллельно создана цель',
    expectedRevision: 0,
    after: { ...goalPayload('Параллельно созданная цель'), id: concurrentCreateGoalId },
  }
  const concurrentCreateResults = await Promise.all([
    apply(concurrentA, ownerA, concurrentCreateRequest),
    apply(concurrentB, ownerA, concurrentCreateRequest),
  ])
  assert.deepEqual(
    concurrentCreateResults.map((result) => result.rows[0].result.idempotent).sort(),
    [false, true],
  )
  assert.deepEqual((await admin.query(`
    select title, revision::int,
      (select count(*)::int from public.dostigator_history_events where mutation_id = $2) as events
    from public.dostigator_goals where id = $1
  `, [concurrentCreateGoalId, concurrentCreateMutation])).rows[0], {
    title: 'Параллельно созданная цель', revision: 1, events: 1,
  })

  const conflictingEnvelopeRevision = (await admin.query(
    'select revision::int from public.dostigator_goals where id = $1', [goalId],
  )).rows[0].revision
  const conflictingEnvelopeMutation = mutation(31)
  const conflictingEnvelopeResults = await Promise.allSettled([
    apply(concurrentA, ownerA, {
      mutationId: conflictingEnvelopeMutation, entityType: 'goal', entityId: goalId,
      operation: 'goal_edit', label: 'Конфликт envelope', expectedRevision: conflictingEnvelopeRevision,
      after: goalPayload('Envelope A'),
    }),
    apply(concurrentB, ownerA, {
      mutationId: conflictingEnvelopeMutation, entityType: 'goal', entityId: goalId,
      operation: 'goal_edit', label: 'Конфликт envelope', expectedRevision: conflictingEnvelopeRevision,
      after: goalPayload('Envelope B'),
    }),
  ])
  assert.equal(conflictingEnvelopeResults.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(conflictingEnvelopeResults.filter((result) => result.status === 'rejected').length, 1)
  assert.match(
    String(conflictingEnvelopeResults.find((result) => result.status === 'rejected').reason.message),
    /different request envelope/,
  )
  assert.equal((await admin.query(`
    select count(*)::int as events from public.dostigator_history_events where mutation_id = $1
  `, [conflictingEnvelopeMutation])).rows[0].events, 1)

  const focusDate = '2026-08-28'
  const focusIds = [
    '50000000-0000-4000-8000-000000000032',
    '50000000-0000-4000-8000-000000000033',
    '50000000-0000-4000-8000-000000000034',
    '50000000-0000-4000-8000-000000000035',
  ]
  const focusPayload = (id, title, position) => ({
    ...actionPayload, id, title, focus_date: position === null ? null : focusDate, focus_position: position,
  })
  await apply(admin, ownerA, {
    mutationId: mutation(32), entityType: 'action', entityId: focusIds[0], operation: 'action_create',
    label: 'Фокус A', expectedRevision: 0, after: focusPayload(focusIds[0], 'A', 1),
  })
  await apply(admin, ownerA, {
    mutationId: mutation(33), entityType: 'action', entityId: focusIds[1], operation: 'action_create',
    label: 'Фокус B', expectedRevision: 0, after: focusPayload(focusIds[1], 'B', 2),
  })
  await apply(admin, ownerA, {
    mutationId: mutation(34), entityType: 'action', entityId: focusIds[2], operation: 'action_create',
    label: 'Фокус C', expectedRevision: 0, after: focusPayload(focusIds[2], 'C', 3),
  })
  await apply(admin, ownerA, {
    mutationId: mutation(35), entityType: 'action', entityId: focusIds[3], operation: 'action_create',
    label: 'Действие D', expectedRevision: 0, after: focusPayload(focusIds[3], 'D', null),
  })
  const focusRemoveMutation = mutation(36)
  await apply(admin, ownerA, {
    mutationId: focusRemoveMutation, entityType: 'action', entityId: focusIds[0], operation: 'focus_remove',
    label: 'Убрано A', expectedRevision: 1, after: focusPayload(focusIds[0], 'A', null),
  })
  await apply(admin, ownerA, {
    mutationId: mutation(37), entityType: 'action', entityId: focusIds[3], operation: 'focus_add',
    label: 'Добавлено D', expectedRevision: 1, after: focusPayload(focusIds[3], 'D', 1),
  })
  await expectRejected(() => undo(admin, ownerA, focusRemoveMutation, mutation(38)), /focus (limit|position) blocks undo/)
  assert.equal(Number((await admin.query(`
    select count(*) from public.dostigator_actions
    where user_id = $1 and focus_date = $2 and status <> 'cancelled'
  `, [ownerA, focusDate])).rows[0].count), 3)

  const repeatedFocusActionId = '50000000-0000-4000-8000-000000000101'
  await apply(admin, ownerA, {
    mutationId: mutation(101), entityType: 'action', entityId: repeatedFocusActionId, operation: 'action_create',
    label: 'Повторяемый фокус', expectedRevision: 0,
    after: { ...actionPayload, id: repeatedFocusActionId, title: 'Повторяемый фокус' },
  })
  await apply(admin, ownerA, {
    mutationId: mutation(102), entityType: 'action', entityId: repeatedFocusActionId, operation: 'focus_add',
    label: 'Фокус в понедельник', expectedRevision: 1,
    after: { ...actionPayload, id: repeatedFocusActionId, title: 'Повторяемый фокус', focus_date: '2026-11-02', focus_position: 1 },
  })
  const tuesdayFocusMutation = mutation(103)
  await apply(admin, ownerA, {
    mutationId: tuesdayFocusMutation, entityType: 'action', entityId: repeatedFocusActionId, operation: 'focus_add',
    label: 'Фокус во вторник', expectedRevision: 2,
    after: { ...actionPayload, id: repeatedFocusActionId, title: 'Повторяемый фокус', focus_date: '2026-11-03', focus_position: 1 },
  })
  assert.deepEqual((await admin.query(`
    select committed_on::text, position::int from public.dostigator_focus_commitments
    where user_id = $1 and action_id = $2 order by committed_on
  `, [ownerA, repeatedFocusActionId])).rows, [
    { committed_on: '2026-11-02', position: 1 },
    { committed_on: '2026-11-03', position: 1 },
  ])
  assert.equal((await asUser(admin, ownerB, `
    select count(*)::int as count from public.dostigator_focus_commitments where action_id = $1
  `, [repeatedFocusActionId])).rows[0].count, 0)
  await expectRejected(() => asUser(admin, ownerA, `
    delete from public.dostigator_focus_commitments where action_id = $1
  `, [repeatedFocusActionId]), /permission denied/)

  await undo(admin, ownerA, tuesdayFocusMutation, mutation(104))
  assert.deepEqual((await admin.query(`
    select
      (select focus_date::text from public.dostigator_actions where id = $1) as current_date,
      (select count(*)::int from public.dostigator_focus_commitments where action_id = $1) as commitments,
      (select min(committed_on)::text from public.dostigator_focus_commitments where action_id = $1) as only_date
  `, [repeatedFocusActionId])).rows[0], {
    current_date: '2026-11-02', commitments: 1, only_date: '2026-11-02',
  })

  const removeFocusActionId = '50000000-0000-4000-8000-000000000105'
  await apply(admin, ownerA, {
    mutationId: mutation(105), entityType: 'action', entityId: removeFocusActionId, operation: 'action_create',
    label: 'Фокус для снятия', expectedRevision: 0,
    after: { ...actionPayload, id: removeFocusActionId, title: 'Фокус для снятия' },
  })
  await apply(admin, ownerA, {
    mutationId: mutation(106), entityType: 'action', entityId: removeFocusActionId, operation: 'focus_add',
    label: 'Фокус на сегодня', expectedRevision: 1,
    after: { ...actionPayload, id: removeFocusActionId, title: 'Фокус для снятия', focus_date: '2026-11-04', focus_position: 1 },
  })
  await apply(admin, ownerA, {
    mutationId: mutation(107), entityType: 'action', entityId: removeFocusActionId, operation: 'focus_remove',
    label: 'Снять сегодняшний фокус', expectedRevision: 2,
    after: { ...actionPayload, id: removeFocusActionId, title: 'Фокус для снятия' },
  })
  assert.deepEqual((await admin.query(`
    select
      (select focus_date is null from public.dostigator_actions where id = $1) as pointer_cleared,
      (select count(*)::int from public.dostigator_focus_commitments where action_id = $1) as commitments
  `, [removeFocusActionId])).rows[0], { pointer_cleared: true, commitments: 0 })

  const collisionDate = '2026-11-05'
  const blockerFocusActionId = '50000000-0000-4000-8000-000000000108'
  const rejectedFocusActionId = '50000000-0000-4000-8000-000000000109'
  for (const [id, suffix, title] of [
    [blockerFocusActionId, 108, 'Занявший слот'],
    [rejectedFocusActionId, 109, 'Отклонённый слот'],
  ]) await apply(admin, ownerA, {
    mutationId: mutation(suffix), entityType: 'action', entityId: id, operation: 'action_create',
    label: title, expectedRevision: 0, after: { ...actionPayload, id, title },
  })
  await apply(admin, ownerA, {
    mutationId: mutation(110), entityType: 'action', entityId: blockerFocusActionId, operation: 'focus_add',
    label: 'Занять слот', expectedRevision: 1,
    after: { ...actionPayload, id: blockerFocusActionId, title: 'Занявший слот', focus_date: collisionDate, focus_position: 1 },
  })
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(111), entityType: 'action', entityId: rejectedFocusActionId, operation: 'focus_add',
    label: 'Конфликтующий слот', expectedRevision: 1,
    after: { ...actionPayload, id: rejectedFocusActionId, title: 'Отклонённый слот', focus_date: collisionDate, focus_position: 1 },
  }), /unique|duplicate/)
  assert.deepEqual((await admin.query(`
    select
      (select focus_date is null from public.dostigator_actions where id = $1) as action_rolled_back,
      (select count(*)::int from public.dostigator_focus_commitments where action_id = $1) as commitments,
      (select count(*)::int from public.dostigator_history_events where mutation_id = $2) as events,
      (select count(*)::int from public.dostigator_mutation_requests where mutation_id = $2) as requests
  `, [rejectedFocusActionId, mutation(111)])).rows[0], {
    action_rolled_back: true, commitments: 0, events: 0, requests: 0,
  })

  const longLabelActionId = '50000000-0000-4000-8000-000000000039'
  const longLabelMutation = mutation(39)
  await apply(admin, ownerA, {
    mutationId: longLabelMutation, entityType: 'action', entityId: longLabelActionId, operation: 'action_create',
    label: 'Я'.repeat(180), expectedRevision: 0,
    after: { ...actionPayload, id: longLabelActionId, title: 'Действие с длинной записью истории' },
  })
  await undo(admin, ownerA, longLabelMutation, mutation(40))
  const longUndoLabel = (await admin.query(
    'select label from public.dostigator_history_events where mutation_id = $1', [mutation(40)],
  )).rows[0].label
  assert.equal([...longUndoLabel].length, 180)
  assert.match(longUndoLabel, /^Отмена: /)

  const semanticActionId = '50000000-0000-4000-8000-000000000041'
  await apply(admin, ownerA, {
    mutationId: mutation(41), entityType: 'action', entityId: semanticActionId, operation: 'action_create',
    label: 'Семантический шаг', expectedRevision: 0,
    after: { ...actionPayload, id: semanticActionId, title: 'Семантический шаг' },
  })
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(42), entityType: 'action', entityId: semanticActionId, operation: 'action_delete',
    label: 'Ложное удаление', expectedRevision: 1,
    after: { ...actionPayload, id: semanticActionId, title: 'Семантический шаг', status: 'todo' },
  }), /action payload does not match operation/)
  assert.deepEqual((await admin.query(
    'select status, revision::int from public.dostigator_actions where id = $1', [semanticActionId],
  )).rows[0], { status: 'todo', revision: 1 })
  assert.equal(Number((await admin.query(
    'select count(*) from public.dostigator_history_events where mutation_id = $1', [mutation(42)],
  )).rows[0].count), 0)

  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(43), entityType: 'action', entityId: semanticActionId, operation: 'action_complete',
    label: 'Ложное завершение', expectedRevision: 1,
    after: {
      ...actionPayload, id: semanticActionId, goal_id: concurrentCreateGoalId, title: 'Скрытая подмена',
      status: 'done', focus_date: '2026-09-02', focus_position: 1,
      completed_at: '2026-09-02T10:00:00.000Z',
    },
  }), /action payload does not match operation/)
  assert.deepEqual((await admin.query(
    'select goal_id::text, title, status, focus_date, revision::int from public.dostigator_actions where id = $1',
    [semanticActionId],
  )).rows[0], { goal_id: goalId, title: 'Семантический шаг', status: 'todo', focus_date: null, revision: 1 })

  const currentGoalForSemanticCheck = (await admin.query(
    'select revision::int, title from public.dostigator_goals where id = $1', [goalId],
  )).rows[0]
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(44), entityType: 'goal', entityId: goalId, operation: 'goal_pause',
    label: 'Ложная пауза', expectedRevision: currentGoalForSemanticCheck.revision,
    after: goalPayload('Скрытая подмена цели', 'paused'),
  }), /goal payload does not match operation/)
  assert.deepEqual((await admin.query(
    'select title, status, revision::int from public.dostigator_goals where id = $1', [goalId],
  )).rows[0], { title: currentGoalForSemanticCheck.title, status: 'active', revision: currentGoalForSemanticCheck.revision })

  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(45), entityType: 'habit', entityId: habitId, operation: 'habit_pause',
    label: 'Ложная пауза привычки', expectedRevision: 3,
    after: {
      id: habitId, area_id: null, title: 'Скрытая подмена привычки', target_per_week: 5, active: false,
      activity_periods: [{ started_on: '2026-08-25', ended_on: '2026-08-28' }],
      updated_at: '2026-08-28T11:00:00.000Z',
    },
  }), /habit payload does not match operation/)
  assert.deepEqual((await admin.query(
    'select title, active, revision::int from public.dostigator_habits where id = $1', [habitId],
  )).rows[0], { title: 'Читать', active: true, revision: 3 })

  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(46), entityType: 'habit', entityId: habitId, operation: 'habit_pause',
    label: 'Переписанная история привычки', expectedRevision: 3,
    after: {
      id: habitId, area_id: null, title: 'Читать', target_per_week: 5, active: false,
      activity_periods: [{ started_on: '2026-01-01', ended_on: '2026-08-28' }],
      updated_at: '2026-08-28T11:00:00.000Z',
    },
  }), /habit payload does not match operation/)

  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(47), entityType: 'goal', entityId: goalId, operation: 'goal_complete',
    label: 'Ложное завершение цели', expectedRevision: currentGoalForSemanticCheck.revision,
    after: { ...goalPayload(currentGoalForSemanticCheck.title, 'completed'), progress: 0 },
  }), /goal payload does not match operation/)

  await apply(admin, ownerA, {
    mutationId: mutation(48), entityType: 'action', entityId: semanticActionId, operation: 'action_complete',
    label: 'Корректное завершение', expectedRevision: 1,
    after: {
      ...actionPayload, id: semanticActionId, title: 'Семантический шаг', status: 'done',
      result_note: 'готово', completed_at: '2026-09-02T10:00:00.000Z',
    },
  })
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(49), entityType: 'action', entityId: semanticActionId, operation: 'action_reopen',
    label: 'Ложное возвращение', expectedRevision: 2,
    after: {
      ...actionPayload, id: semanticActionId, title: 'Семантический шаг', status: 'todo',
      result_note: 'скрытая заметка', completed_at: null,
    },
  }), /action payload does not match operation/)

  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(50), entityType: 'action', entityId: semanticActionId, operation: 'focus_add',
    label: 'Ложное возвращение через фокус', expectedRevision: 2,
    after: {
      ...actionPayload, id: semanticActionId, title: 'Семантический шаг', status: 'todo',
      result_note: 'готово', focus_date: '2026-10-01', focus_position: 1,
      completed_at: '2026-09-02T10:00:00.000Z',
    },
  }), /action payload does not match operation/)
  assert.deepEqual((await admin.query(
    'select status, focus_date, revision::int from public.dostigator_actions where id = $1', [semanticActionId],
  )).rows[0], { status: 'done', focus_date: null, revision: 2 })

  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(51), entityType: 'habit', entityId: habitId, operation: 'habit_resume',
    label: 'Повторное возобновление', expectedRevision: 3,
    after: {
      id: habitId, area_id: null, title: 'Читать', target_per_week: 5, active: true,
      activity_periods: [...activityPeriods, { started_on: '2026-10-01', ended_on: null }],
      updated_at: '2026-10-01T09:00:00.000Z',
    },
  }), /habit payload does not match operation/)
  assert.deepEqual((await admin.query(
    `select active, revision::int,
      (select count(*)::int from jsonb_array_elements(activity_periods) period where period->'ended_on' = 'null'::jsonb) as open_periods
     from public.dostigator_habits where id = $1`, [habitId],
  )).rows[0], { active: true, revision: 3, open_periods: 1 })

  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(56), entityType: 'habit', entityId: habitId, operation: 'habit_pause',
    label: 'Закрытие раньше старта', expectedRevision: 3,
    after: {
      id: habitId, area_id: null, title: 'Читать', target_per_week: 5, active: false,
      activity_periods: [{ started_on: '2026-08-25', ended_on: '2026-08-24' }],
      updated_at: '2026-08-28T11:00:00.000Z',
    },
  }), /habit payload does not match operation/)
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(57), entityType: 'habit', entityId: habitId, operation: 'habit_pause',
    label: 'Некорректная календарная дата', expectedRevision: 3,
    after: {
      id: habitId, area_id: null, title: 'Читать', target_per_week: 5, active: false,
      activity_periods: [{ started_on: '2026-08-25', ended_on: '2026-08-99' }],
      updated_at: '2026-08-28T11:00:00.000Z',
    },
  }), /habit payload does not match operation/)

  const invalidChronologyHabitId = '60000000-0000-4000-8000-000000000058'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(58), entityType: 'habit', entityId: invalidChronologyHabitId, operation: 'habit_create',
    label: 'Пересекающиеся периоды', expectedRevision: 0,
    after: {
      id: invalidChronologyHabitId, area_id: null, title: 'Пересечение', target_per_week: 3, active: true,
      activity_periods: [
        { started_on: '2026-08-20', ended_on: '2026-08-30' },
        { started_on: '2026-08-29', ended_on: null },
      ],
      created_at: '2026-08-20T08:00:00.000Z', updated_at: '2026-08-29T08:00:00.000Z',
    },
  }), /habit payload does not match operation/)

  const misplacedOpenHabitId = '60000000-0000-4000-8000-000000000059'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(59), entityType: 'habit', entityId: misplacedOpenHabitId, operation: 'habit_create',
    label: 'Открытый период не последний', expectedRevision: 0,
    after: {
      id: misplacedOpenHabitId, area_id: null, title: 'Открытый не последний', target_per_week: 3, active: true,
      activity_periods: [
        { started_on: '2026-08-20', ended_on: null },
        { started_on: '2026-08-21', ended_on: '2026-08-22' },
      ],
      created_at: '2026-08-20T08:00:00.000Z', updated_at: '2026-08-22T08:00:00.000Z',
    },
  }), /habit payload does not match operation/)

  await apply(admin, ownerA, {
    mutationId: mutation(60), entityType: 'habit', entityId: habitId, operation: 'habit_pause',
    label: 'Корректное закрытие периода', expectedRevision: 3,
    after: {
      id: habitId, area_id: null, title: 'Читать', target_per_week: 5, active: false,
      activity_periods: [{ started_on: '2026-08-25', ended_on: '2026-08-28' }],
      updated_at: '2026-08-28T11:00:00.000Z',
    },
  })
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(61), entityType: 'habit', entityId: habitId, operation: 'habit_resume',
    label: 'Возобновление до закрытия', expectedRevision: 4,
    after: {
      id: habitId, area_id: null, title: 'Читать', target_per_week: 5, active: true,
      activity_periods: [
        { started_on: '2026-08-25', ended_on: '2026-08-28' },
        { started_on: '2026-08-27', ended_on: null },
      ],
      updated_at: '2026-08-28T12:00:00.000Z',
    },
  }), /habit payload does not match operation/)
  const resumedPeriods = [
    { started_on: '2026-08-25', ended_on: '2026-08-28' },
    { started_on: '2026-08-28', ended_on: null },
  ]
  await apply(admin, ownerA, {
    mutationId: mutation(62), entityType: 'habit', entityId: habitId, operation: 'habit_resume',
    label: 'Корректное возобновление', expectedRevision: 4,
    after: {
      id: habitId, area_id: null, title: 'Читать', target_per_week: 5, active: true,
      activity_periods: resumedPeriods, updated_at: '2026-08-28T12:00:00.000Z',
    },
  })
  assert.deepEqual((await admin.query(
    'select active, activity_periods, revision::int from public.dostigator_habits where id = $1', [habitId],
  )).rows[0], { active: true, activity_periods: resumedPeriods, revision: 5 })

  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(52), entityType: 'review', entityId: reviewId, operation: 'review_edit',
    label: 'Перенос обзора', expectedRevision: 3,
    after: {
      id: reviewId, week_start: '2026-09-07', wins: 'Чужая неделя', blockers: '', next_focus: '',
      self_score: 7, metrics_snapshot: snapshot, updated_at: '2026-09-07T10:00:00.000Z',
    },
  }), /review payload does not match operation/)
  assert.deepEqual((await admin.query(
    `select week_start::text, metrics_snapshot->'period'->>'weekStart' as snapshot_week, revision::int
     from public.dostigator_weekly_reviews where id = $1`, [reviewId],
  )).rows[0], { week_start: '2026-08-24', snapshot_week: '2026-08-24', revision: 3 })

  const currentGoalBeforeStateChecks = (await admin.query(
    'select revision::int, title from public.dostigator_goals where id = $1', [goalId],
  )).rows[0]
  await apply(admin, ownerA, {
    mutationId: mutation(53), entityType: 'goal', entityId: goalId, operation: 'goal_pause',
    label: 'Корректная пауза', expectedRevision: currentGoalBeforeStateChecks.revision,
    after: goalPayload(currentGoalBeforeStateChecks.title, 'paused'),
  })
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(54), entityType: 'goal', entityId: goalId, operation: 'goal_complete',
    label: 'Завершение из паузы', expectedRevision: currentGoalBeforeStateChecks.revision + 1,
    after: goalPayload(currentGoalBeforeStateChecks.title, 'completed'),
  }), /goal payload does not match operation/)

  const mismatchedReviewId = '80000000-0000-4000-8000-000000000055'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(55), entityType: 'review', entityId: mismatchedReviewId, operation: 'review_create',
    label: 'Обзор с чужим снимком', expectedRevision: 0,
    after: {
      id: mismatchedReviewId, week_start: '2026-09-07', wins: '', blockers: '', next_focus: '',
      self_score: 7, metrics_snapshot: snapshot, created_at: '2026-09-07T10:00:00.000Z',
      updated_at: '2026-09-07T10:00:00.000Z',
    },
  }), /review snapshot does not match week/)
  assert.equal((await admin.query(
    'select count(*)::int as count from public.dostigator_weekly_reviews where id = $1', [mismatchedReviewId],
  )).rows[0].count, 0)

  const canonicalSnapshot = {
    score: 84.5,
    focus: { done: 2, committed: 3, rate: 2 / 3 },
    habits: { done: 4, expected: 5, rate: 0.8 },
    actions: { done: 6, target: 8, rate: 0.75 },
    period: { weekStart: '2026-09-07', asOf: '2026-09-13' },
  }
  const legacyReviewId = '80000000-0000-4000-8000-000000000063'
  await apply(admin, ownerA, {
    mutationId: mutation(63), entityType: 'review', entityId: legacyReviewId, operation: 'legacy_upsert',
    label: 'Канонический legacy-обзор', expectedRevision: 0,
    after: {
      id: legacyReviewId, week_start: '2026-09-07', wins: '', blockers: '', next_focus: '',
      self_score: null, metrics_snapshot: canonicalSnapshot,
      created_at: '2026-09-13T10:00:00.000Z', updated_at: '2026-09-13T10:00:00.000Z',
    },
  })
  assert.deepEqual((await admin.query(
    'select metrics_snapshot from public.dostigator_weekly_reviews where id = $1', [legacyReviewId],
  )).rows[0].metrics_snapshot, canonicalSnapshot)
  await apply(admin, ownerA, {
    mutationId: mutation(120), entityType: 'review', entityId: legacyReviewId, operation: 'legacy_upsert',
    label: 'Offline legacy не меняет снимок', expectedRevision: 1, source: 'offline',
    after: {
      id: legacyReviewId, week_start: '2026-09-07', wins: 'Offline текст', blockers: '', next_focus: '',
      self_score: null, metrics_snapshot: { ...canonicalSnapshot, score: 1 },
      created_at: '2026-09-13T10:00:00.000Z', updated_at: '2026-09-13T11:00:00.000Z',
    },
  })
  assert.deepEqual((await admin.query(
    'select wins, metrics_snapshot, revision::int from public.dostigator_weekly_reviews where id = $1', [legacyReviewId],
  )).rows[0], { wins: 'Offline текст', metrics_snapshot: canonicalSnapshot, revision: 2 })

  const nullSnapshotReviewId = '80000000-0000-4000-8000-000000000064'
  await apply(admin, ownerA, {
    mutationId: mutation(64), entityType: 'review', entityId: nullSnapshotReviewId, operation: 'legacy_upsert',
    label: 'Legacy-обзор без снимка', expectedRevision: 0,
    after: {
      id: nullSnapshotReviewId, week_start: '2026-09-14', wins: '', blockers: '', next_focus: '',
      self_score: null, metrics_snapshot: null,
      created_at: '2026-09-14T10:00:00.000Z', updated_at: '2026-09-14T10:00:00.000Z',
    },
  })
  assert.equal((await admin.query(
    'select metrics_snapshot from public.dostigator_weekly_reviews where id = $1', [nullSnapshotReviewId],
  )).rows[0].metrics_snapshot, null)

  const invalidMetricsReviewId = '80000000-0000-4000-8000-000000000065'
  const invalidMetricsBase = {
    id: invalidMetricsReviewId, week_start: '2026-09-21', wins: '', blockers: '', next_focus: '', self_score: 7,
    created_at: '2026-09-21T10:00:00.000Z', updated_at: '2026-09-21T10:00:00.000Z',
  }
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(65), entityType: 'review', entityId: invalidMetricsReviewId, operation: 'legacy_upsert',
    label: 'Оценка вне диапазона', expectedRevision: 0,
    after: {
      ...invalidMetricsBase,
      metrics_snapshot: { ...canonicalSnapshot, score: 999, period: { weekStart: '2026-09-21', asOf: '2026-09-21' } },
    },
  }), /review snapshot does not match week/)
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(66), entityType: 'review', entityId: invalidMetricsReviewId, operation: 'review_create',
    label: 'Дата снимка вне недели', expectedRevision: 0,
    after: {
      ...invalidMetricsBase,
      metrics_snapshot: { ...canonicalSnapshot, period: { weekStart: '2026-09-21', asOf: '1900-01-01' } },
    },
  }), /review snapshot does not match week/)
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(67), entityType: 'review', entityId: invalidMetricsReviewId, operation: 'review_create',
    label: 'Некорректные показатели', expectedRevision: 0,
    after: {
      ...invalidMetricsBase,
      metrics_snapshot: {
        ...canonicalSnapshot, actions: { done: 1.5, target: 1, rate: 2 },
        period: { weekStart: '2026-09-21', asOf: '2026-09-27' },
      },
    },
  }), /review snapshot does not match week/)
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(68), entityType: 'review', entityId: invalidMetricsReviewId, operation: 'review_create',
    label: 'Отсутствующий снимок', expectedRevision: 0, after: invalidMetricsBase,
  }), /review snapshot does not match week/)
  assert.equal((await admin.query(
    'select count(*)::int as count from public.dostigator_weekly_reviews where id = $1', [invalidMetricsReviewId],
  )).rows[0].count, 0)

  const nonMondayReviewId = '80000000-0000-4000-8000-000000000069'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(69), entityType: 'review', entityId: nonMondayReviewId, operation: 'review_create',
    label: 'Обзор не с понедельника', expectedRevision: 0,
    after: {
      id: nonMondayReviewId, week_start: '2026-09-22', wins: '', blockers: '', next_focus: '', self_score: null,
      metrics_snapshot: {
        ...canonicalSnapshot, period: { weekStart: '2026-09-22', asOf: '2026-09-22' },
      },
      created_at: '2026-09-22T10:00:00.000Z', updated_at: '2026-09-22T10:00:00.000Z',
    },
  }), /review snapshot does not match week/)
  const nullCreateReviewId = '80000000-0000-4000-8000-000000000070'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(70), entityType: 'review', entityId: nullCreateReviewId, operation: 'review_create',
    label: 'Новый обзор без снимка', expectedRevision: 0,
    after: {
      id: nullCreateReviewId, week_start: '2026-09-28', wins: '', blockers: '', next_focus: '', self_score: null,
      metrics_snapshot: null, created_at: '2026-09-28T10:00:00.000Z', updated_at: '2026-09-28T10:00:00.000Z',
    },
  }), /review snapshot does not match week/)
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(71), entityType: 'review', entityId: nullSnapshotReviewId, operation: 'legacy_upsert',
    label: 'Перенос legacy-обзора', expectedRevision: 1,
    after: {
      id: nullSnapshotReviewId, week_start: '2026-09-21', wins: 'Подмена недели', blockers: '',
      next_focus: '', self_score: null, metrics_snapshot: null, updated_at: '2026-09-21T10:00:00.000Z',
    },
  }), /review payload does not match operation/)
  assert.deepEqual((await admin.query(
    `select week_start::text, metrics_snapshot, revision::int
     from public.dostigator_weekly_reviews where id = $1`, [nullSnapshotReviewId],
  )).rows[0], { week_start: '2026-09-14', metrics_snapshot: null, revision: 1 })
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(89), entityType: 'review', entityId: reviewId, operation: 'review_edit',
    label: 'Неканоническая дата недели', expectedRevision: 3,
    after: {
      id: reviewId, week_start: '2026-8-24', wins: 'Подмена формата', blockers: '', next_focus: '',
      self_score: 7, metrics_snapshot: snapshot, updated_at: '2026-08-28T10:00:00.000Z',
    },
  }), /review payload does not match operation/)

  const legacyGoalAfter = (id, status, progress, completedAt) => ({
    ...goalPayload(`Legacy ${status}`), id, status, progress, completed_at: completedAt,
  })
  const invalidCompletedGoalId = '31000000-0000-4000-8000-000000000072'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(72), entityType: 'goal', entityId: invalidCompletedGoalId, operation: 'legacy_upsert',
    label: 'Завершённая цель без полного прогресса', expectedRevision: 0,
    after: legacyGoalAfter(invalidCompletedGoalId, 'completed', 80, '2026-09-28T10:00:00.000Z'),
  }), /goal payload does not match operation/)
  const invalidCompletedTimeGoalId = '31000000-0000-4000-8000-000000000073'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(73), entityType: 'goal', entityId: invalidCompletedTimeGoalId, operation: 'legacy_upsert',
    label: 'Завершённая цель без даты', expectedRevision: 0,
    after: legacyGoalAfter(invalidCompletedTimeGoalId, 'completed', 100, null),
  }), /goal payload does not match operation/)
  const invalidActiveGoalId = '31000000-0000-4000-8000-000000000074'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(74), entityType: 'goal', entityId: invalidActiveGoalId, operation: 'legacy_upsert',
    label: 'Активная цель с датой завершения', expectedRevision: 0,
    after: legacyGoalAfter(invalidActiveGoalId, 'active', 40, '2026-09-28T10:00:00.000Z'),
  }), /goal payload does not match operation/)
  const nullStatusGoalId = '31000000-0000-4000-8000-000000000090'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(90), entityType: 'goal', entityId: nullStatusGoalId, operation: 'legacy_upsert',
    label: 'Цель без состояния', expectedRevision: 0,
    after: legacyGoalAfter(nullStatusGoalId, null, 0, null),
  }), /goal payload does not match operation/)
  const completedLegacyGoalId = '31000000-0000-4000-8000-000000000075'
  await apply(admin, ownerA, {
    mutationId: mutation(75), entityType: 'goal', entityId: completedLegacyGoalId, operation: 'legacy_upsert',
    label: 'Каноническая завершённая цель', expectedRevision: 0,
    after: legacyGoalAfter(completedLegacyGoalId, 'completed', 100, '2026-09-28T10:00:00.000Z'),
  })
  const archivedLegacyGoalId = '31000000-0000-4000-8000-000000000076'
  await apply(admin, ownerA, {
    mutationId: mutation(76), entityType: 'goal', entityId: archivedLegacyGoalId, operation: 'legacy_upsert',
    label: 'Каноническая архивная цель', expectedRevision: 0,
    after: legacyGoalAfter(archivedLegacyGoalId, 'archived', 65, null),
  })
  assert.deepEqual((await admin.query(`
    select id::text, status, progress::int, completed_at is not null as has_completed_at
    from public.dostigator_goals where id in ($1, $2) order by id
  `, [completedLegacyGoalId, archivedLegacyGoalId])).rows, [
    { id: completedLegacyGoalId, status: 'completed', progress: 100, has_completed_at: true },
    { id: archivedLegacyGoalId, status: 'archived', progress: 65, has_completed_at: false },
  ])

  const legacyActionAfter = (id, status, completedAt, focusDate = null, focusPosition = null) => ({
    ...actionPayload, id, title: `Legacy ${status}`, status, completed_at: completedAt,
    focus_date: focusDate, focus_position: focusPosition,
  })
  const invalidDoneActionId = '51000000-0000-4000-8000-000000000077'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(77), entityType: 'action', entityId: invalidDoneActionId, operation: 'legacy_upsert',
    label: 'Выполненное действие без даты', expectedRevision: 0,
    after: legacyActionAfter(invalidDoneActionId, 'done', null),
  }), /action payload does not match operation/)
  const invalidTodoActionId = '51000000-0000-4000-8000-000000000078'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(78), entityType: 'action', entityId: invalidTodoActionId, operation: 'legacy_upsert',
    label: 'Невыполненное действие с датой', expectedRevision: 0,
    after: legacyActionAfter(invalidTodoActionId, 'todo', '2026-09-28T10:00:00.000Z'),
  }), /action payload does not match operation/)
  const invalidCancelledActionId = '51000000-0000-4000-8000-000000000079'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(79), entityType: 'action', entityId: invalidCancelledActionId, operation: 'legacy_upsert',
    label: 'Отменённое действие в фокусе', expectedRevision: 0,
    after: legacyActionAfter(invalidCancelledActionId, 'cancelled', null, '2026-09-28', 1),
  }), /action payload does not match operation/)
  const invalidFocusPairActionId = '51000000-0000-4000-8000-000000000080'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(80), entityType: 'action', entityId: invalidFocusPairActionId, operation: 'legacy_upsert',
    label: 'Неполная пара фокуса', expectedRevision: 0,
    after: legacyActionAfter(invalidFocusPairActionId, 'todo', null, '2026-09-28', null),
  }), /action payload does not match operation/)
  const nullStatusActionId = '51000000-0000-4000-8000-000000000091'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(91), entityType: 'action', entityId: nullStatusActionId, operation: 'legacy_upsert',
    label: 'Действие без состояния', expectedRevision: 0,
    after: legacyActionAfter(nullStatusActionId, null, null),
  }), /action payload does not match operation/)
  const doneLegacyActionId = '51000000-0000-4000-8000-000000000081'
  await apply(admin, ownerA, {
    mutationId: mutation(81), entityType: 'action', entityId: doneLegacyActionId, operation: 'legacy_upsert',
    label: 'Каноническое выполненное действие', expectedRevision: 0,
    after: legacyActionAfter(doneLegacyActionId, 'done', '2026-09-28T10:00:00.000Z'),
  })
  const cancelledLegacyActionId = '51000000-0000-4000-8000-000000000082'
  await apply(admin, ownerA, {
    mutationId: mutation(82), entityType: 'action', entityId: cancelledLegacyActionId, operation: 'legacy_upsert',
    label: 'Каноническое отменённое действие', expectedRevision: 0,
    after: legacyActionAfter(cancelledLegacyActionId, 'cancelled', null),
  })
  assert.deepEqual((await admin.query(`
    select id::text, status, completed_at is not null as has_completed_at, focus_date
    from public.dostigator_actions where id in ($1, $2) order by id
  `, [doneLegacyActionId, cancelledLegacyActionId])).rows, [
    { id: doneLegacyActionId, status: 'done', has_completed_at: true, focus_date: null },
    { id: cancelledLegacyActionId, status: 'cancelled', has_completed_at: false, focus_date: null },
  ])

  const historicHabitId = '61000000-0000-4000-8000-000000000083'
  const historicPeriods = [
    { started_on: '2026-09-01', ended_on: '2026-09-03' },
    { started_on: '2026-09-10', ended_on: '2026-09-12' },
  ]
  await apply(admin, ownerA, {
    mutationId: mutation(83), entityType: 'habit', entityId: historicHabitId, operation: 'legacy_upsert',
    label: 'Историческая привычка', expectedRevision: 0,
    after: {
      id: historicHabitId, area_id: null, title: 'Историческая привычка', target_per_week: 3,
      active: false, activity_periods: historicPeriods,
      created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-12T10:00:00.000Z',
    },
  })
  const activePeriodCheckinId = '71000000-0000-4000-8000-000000000084'
  await apply(admin, ownerA, {
    mutationId: mutation(84), entityType: 'habit_checkin', entityId: activePeriodCheckinId,
    operation: 'habit_check', label: 'Отметка внутри активного периода', expectedRevision: 0,
    after: {
      id: activePeriodCheckinId, habit_id: habitId, checked_on: '2026-08-26', note: '',
      created_at: '2026-08-26T10:00:00.000Z',
    },
  })
  const missingHabitCheckinId = '71000000-0000-4000-8000-000000000085'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(85), entityType: 'habit_checkin', entityId: missingHabitCheckinId,
    operation: 'habit_check', label: 'Отметка чужой привычки', expectedRevision: 0,
    after: {
      id: missingHabitCheckinId, habit_id: '61999999-9999-4999-8999-999999999999',
      checked_on: '2026-09-01', note: '', created_at: '2026-09-01T10:00:00.000Z',
    },
  }), /check-in is outside habit activity periods/)
  const gapCheckinId = '71000000-0000-4000-8000-000000000086'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(86), entityType: 'habit_checkin', entityId: gapCheckinId,
    operation: 'legacy_upsert', label: 'Отметка в паузе', expectedRevision: 0,
    after: {
      id: gapCheckinId, habit_id: historicHabitId, checked_on: '2026-09-05', note: '',
      created_at: '2026-09-05T10:00:00.000Z',
    },
  }), /check-in is outside habit activity periods/)
  const historicCheckinId = '71000000-0000-4000-8000-000000000087'
  await apply(admin, ownerA, {
    mutationId: mutation(87), entityType: 'habit_checkin', entityId: historicCheckinId,
    operation: 'legacy_upsert', label: 'Историческая отметка', expectedRevision: 0,
    after: {
      id: historicCheckinId, habit_id: historicHabitId, checked_on: '2026-09-10', note: '',
      created_at: '2026-09-10T10:00:00.000Z',
    },
  })
  const beforePeriodCheckinId = '71000000-0000-4000-8000-000000000088'
  await expectRejected(() => apply(admin, ownerA, {
    mutationId: mutation(88), entityType: 'habit_checkin', entityId: beforePeriodCheckinId,
    operation: 'habit_check', label: 'Отметка до начала привычки', expectedRevision: 0,
    after: {
      id: beforePeriodCheckinId, habit_id: habitId, checked_on: '2026-08-24', note: '',
      created_at: '2026-08-24T10:00:00.000Z',
    },
  }), /check-in is outside habit activity periods/)
  assert.deepEqual((await admin.query(`
    select id::text, habit_id::text, checked_on::text
    from public.dostigator_habit_checkins where id in ($1, $2) order by id
  `, [activePeriodCheckinId, historicCheckinId])).rows, [
    { id: activePeriodCheckinId, habit_id: habitId, checked_on: '2026-08-26' },
    { id: historicCheckinId, habit_id: historicHabitId, checked_on: '2026-09-10' },
  ])
  assert.equal((await admin.query(`
    select count(*)::int as count from public.dostigator_history_events
    where mutation_id = any($1::uuid[])
  `, [[mutation(69), mutation(70), mutation(71), mutation(72), mutation(73), mutation(74),
    mutation(77), mutation(78), mutation(79), mutation(80), mutation(85), mutation(86), mutation(88),
    mutation(89), mutation(90), mutation(91)]])).rows[0].count, 0)

  const firstPage = await asUser(admin, ownerA, `select * from public.dostigator_history_page(null, null, 3)`)
  assert.equal(firstPage.rows.length, 3)
  const cursor = firstPage.rows.at(-1)
  const secondPage = await asUser(admin, ownerA, `select * from public.dostigator_history_page($1, $2, 3)`, [cursor.created_at, cursor.id])
  assert.equal(new Set([...firstPage.rows, ...secondPage.rows].map((event) => event.id)).size, firstPage.rows.length + secondPage.rows.length)

  const ownerBGoalId = '90000000-0000-4000-8000-000000000028'
  const ownerBMismatchMutation = mutation(92)
  await expectRejected(() => apply(admin, ownerB, {
    mutationId: ownerBMismatchMutation, entityType: 'goal', entityId: ownerBGoalId, operation: 'goal_create',
    label: 'Подмена владельца', expectedRevision: 0,
    after: { ...goalPayload('Не должна сохраниться'), id: ownerBGoalId },
  }, ownerA), /expected owner does not match authenticated user/)
  assert.deepEqual((await admin.query(`
    select
      (select count(*)::int from public.dostigator_goals where id = $1) as rows,
      (select count(*)::int from public.dostigator_history_events where mutation_id = $2) as events,
      (select count(*)::int from public.dostigator_mutation_requests where mutation_id = $2) as requests
  `, [ownerBGoalId, ownerBMismatchMutation])).rows[0], { rows: 0, events: 0, requests: 0 })

  const ownerBMutation = mutation(28)
  await apply(admin, ownerB, {
    mutationId: ownerBMutation, entityType: 'goal', entityId: ownerBGoalId, operation: 'goal_create',
    label: 'Цель владельца B', expectedRevision: 0, after: { ...goalPayload('Владелец B'), id: ownerBGoalId },
  })
  assert.deepEqual((await admin.query(`
    select goal.title, goal.revision::int,
      request.request_envelope->>'expected_owner' as expected_owner
    from public.dostigator_goals goal
    join public.dostigator_mutation_requests request
      on request.user_id = goal.user_id and request.mutation_id = $2
    where goal.id = $1
  `, [ownerBGoalId, ownerBMutation])).rows[0], {
    title: 'Владелец B', revision: 1, expected_owner: ownerB,
  })

  const defaultAreaNames = ['Личное развитие', 'Дом и ремонт', 'Автомобиль', 'Финансы', 'Семья', 'Здоровье']
  const ownerADefaultAreaIds = defaultAreaNames.map((_, index) =>
    `91000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
  const ownerBDefaultAreaIds = defaultAreaNames.map((_, index) =>
    `92000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
  for (const [index, name] of defaultAreaNames.entries()) {
    await admin.query(`
      insert into public.dostigator_areas (id, user_id, name, color, icon, position)
      values ($1, $2, $3, '#ffc857', 'sparkles', $4)
    `, [ownerADefaultAreaIds[index], ownerA, name, index])
    await admin.query(`
      insert into public.dostigator_areas (id, user_id, name, color, icon, position)
      values ($1, $2, $3, '#8bd3dd', 'sparkles', $4)
    `, [ownerBDefaultAreaIds[index], ownerB, name, index])
  }

  const crossAccountGoalId = '93000000-0000-4000-8000-000000000097'
  const crossAccountActionId = '97000000-0000-4000-8000-000000000097'
  const crossAccountHabitId = '96000000-0000-4000-8000-000000000097'
  const crossAccountCheckinId = '98000000-0000-4000-8000-000000000097'
  const crossAccountReviewId = '99000000-0000-4000-8000-000000000097'
  const crossAccountReviewSnapshot = {
    score: 88, focus: { done: 1, committed: 2, rate: 0.5 }, habits: null, actions: null,
    period: { weekStart: '2026-12-07', asOf: '2026-12-13' },
  }
  const crossGoalPayload = {
    ...goalPayload('Цель из другого аккаунта'), id: crossAccountGoalId, area_id: ownerBDefaultAreaIds[0],
  }
  const crossActionInitial = {
    ...actionPayload, id: crossAccountActionId, goal_id: crossAccountGoalId, title: 'Шаг из другого аккаунта',
    focus_date: '2026-11-30', focus_position: 1,
  }
  const crossActionCurrent = { ...crossActionInitial, focus_date: '2026-12-01', updated_at: '2026-12-01T09:00:00.000Z' }
  const crossHabitPayload = {
    id: crossAccountHabitId, area_id: ownerBDefaultAreaIds[0], title: 'Привычка из другого аккаунта',
    target_per_week: 3, active: true, activity_periods: [{ started_on: '2026-12-01', ended_on: null }],
    created_at: '2026-12-01T08:00:00.000Z', updated_at: '2026-12-01T09:00:00.000Z',
  }
  const crossCheckinPayload = {
    id: crossAccountCheckinId, habit_id: crossAccountHabitId, checked_on: '2026-12-02', note: 'Перенести',
    created_at: '2026-12-02T09:00:00.000Z',
  }
  const crossReviewPayload = {
    id: crossAccountReviewId, week_start: '2026-12-07', wins: 'Из другого аккаунта', blockers: '',
    next_focus: 'Продолжить', self_score: 8, metrics_snapshot: crossAccountReviewSnapshot,
    created_at: '2026-12-13T09:00:00.000Z', updated_at: '2026-12-13T09:00:00.000Z',
  }
  await apply(admin, ownerB, {
    mutationId: mutation(112), entityType: 'goal', entityId: crossAccountGoalId, operation: 'goal_create',
    label: 'Исходная цель для переноса', expectedRevision: 0, after: crossGoalPayload,
  })
  await apply(admin, ownerB, {
    mutationId: mutation(113), entityType: 'action', entityId: crossAccountActionId, operation: 'action_create',
    label: 'Исходный шаг для переноса', expectedRevision: 0, after: crossActionInitial,
  })
  await apply(admin, ownerB, {
    mutationId: mutation(114), entityType: 'action', entityId: crossAccountActionId, operation: 'focus_add',
    label: 'Второй день фокуса', expectedRevision: 1, after: crossActionCurrent,
  })
  await apply(admin, ownerB, {
    mutationId: mutation(115), entityType: 'habit', entityId: crossAccountHabitId, operation: 'habit_create',
    label: 'Исходная привычка для переноса', expectedRevision: 0, after: crossHabitPayload,
  })
  await apply(admin, ownerB, {
    mutationId: mutation(116), entityType: 'habit_checkin', entityId: crossAccountCheckinId, operation: 'habit_check',
    label: 'Исходная отметка для переноса', expectedRevision: 0, after: crossCheckinPayload,
  })
  await apply(admin, ownerB, {
    mutationId: mutation(117), entityType: 'review', entityId: crossAccountReviewId, operation: 'review_create',
    label: 'Исходный обзор для переноса', expectedRevision: 0, after: crossReviewPayload,
  })
  const sourceFocusCommitments = (await admin.query(`
    select id::text, user_id::text, action_id::text, committed_on::text, position::int,
      source_mutation_id::text, created_at::text
    from public.dostigator_focus_commitments
    where user_id = $1 and action_id = $2 order by committed_on
  `, [ownerB, crossAccountActionId])).rows
  assert.equal(sourceFocusCommitments.length, 2)

  const crossAccountImportId = mutation(118)
  const crossAccountPayload = {
    areas: defaultAreaNames.map((name, index) => ({
      id: ownerBDefaultAreaIds[index], user_id: ownerB, name, color: '#123456', icon: 'sparkles', position: index,
      archived_at: null, created_at: '2026-08-28T08:00:00.000Z', updated_at: '2026-08-28T09:00:00.000Z',
    })),
    goals: [{ ...crossGoalPayload, user_id: ownerB }],
    actions: [{ ...crossActionCurrent, user_id: ownerB }],
    habits: [{ ...crossHabitPayload, user_id: ownerB }],
    checkins: [{ ...crossCheckinPayload, user_id: ownerB }],
    reviews: [{ ...crossReviewPayload, user_id: ownerB }],
    focusCommitments: sourceFocusCommitments,
  }
  const crossAccountResult = await importBackup(admin, ownerA, crossAccountImportId, crossAccountPayload)
  assert.equal(crossAccountResult.rows[0].result.idempotent, false)
  assert.equal(crossAccountResult.rows[0].result.counts.focusCommitments, 2)
  assert.equal((await importBackup(admin, ownerA, crossAccountImportId, crossAccountPayload)).rows[0].result.idempotent, true)
  const firstDestinationGraph = (await admin.query(`
    select
      (select count(*)::int from public.dostigator_areas where user_id = $1) as destination_areas,
      (select count(*)::int from public.dostigator_areas where user_id = $2) as source_areas,
      (select count(*)::int from public.dostigator_areas
        where user_id = $2 and color = '#8bd3dd' and revision = 0) as unchanged_source_areas,
      (select id::text from public.dostigator_goals
        where user_id = $1 and title = 'Цель из другого аккаунта') as goal_id,
      (select area_id::text from public.dostigator_goals
        where user_id = $1 and title = 'Цель из другого аккаунта') as goal_area_id,
      (select revision::int from public.dostigator_goals
        where user_id = $1 and title = 'Цель из другого аккаунта') as goal_revision,
      (select id::text from public.dostigator_actions
        where user_id = $1 and title = 'Шаг из другого аккаунта') as action_id,
      (select goal_id::text from public.dostigator_actions
        where user_id = $1 and title = 'Шаг из другого аккаунта') as action_goal_id,
      (select id::text from public.dostigator_habits
        where user_id = $1 and title = 'Привычка из другого аккаунта') as habit_id,
      (select area_id::text from public.dostigator_habits
        where user_id = $1 and title = 'Привычка из другого аккаунта') as habit_area_id,
      (select habit_id::text from public.dostigator_habit_checkins
        where user_id = $1 and note = 'Перенести') as checkin_habit_id,
      (select id::text from public.dostigator_weekly_reviews
        where user_id = $1 and week_start = '2026-12-07') as review_id,
      (select metrics_snapshot from public.dostigator_weekly_reviews
        where user_id = $1 and week_start = '2026-12-07') as review_snapshot,
      (select count(*)::int from public.dostigator_focus_commitments commitment
        join public.dostigator_actions action on action.id = commitment.action_id
        where commitment.user_id = $1 and action.title = 'Шаг из другого аккаунта') as commitments,
      (select count(*)::int from public.dostigator_history_events
        where user_id = $1 and source = 'import' and label like '%резервной копии') as import_events,
      (select count(*)::int from public.dostigator_areas
        where user_id = $1 and color = '#123456' and revision = 1) as mapped_areas
  `, [ownerA, ownerB])).rows[0]
  assert.notEqual(firstDestinationGraph.goal_id, crossAccountGoalId)
  assert.notEqual(firstDestinationGraph.action_id, crossAccountActionId)
  assert.notEqual(firstDestinationGraph.habit_id, crossAccountHabitId)
  assert.notEqual(firstDestinationGraph.review_id, crossAccountReviewId)
  assert.deepEqual({ ...firstDestinationGraph, review_snapshot: undefined }, {
    destination_areas: 6,
    source_areas: 6,
    unchanged_source_areas: 6,
    goal_id: firstDestinationGraph.goal_id,
    goal_area_id: ownerADefaultAreaIds[0],
    goal_revision: 1,
    action_id: firstDestinationGraph.action_id,
    action_goal_id: firstDestinationGraph.goal_id,
    habit_id: firstDestinationGraph.habit_id,
    habit_area_id: ownerADefaultAreaIds[0],
    checkin_habit_id: firstDestinationGraph.habit_id,
    review_id: firstDestinationGraph.review_id,
    review_snapshot: undefined,
    commitments: 2,
    import_events: 5,
    mapped_areas: 6,
  })
  assert.deepEqual(firstDestinationGraph.review_snapshot, crossAccountReviewSnapshot)
  assert.deepEqual((await admin.query(`
    select committed_on::text, position::int
    from public.dostigator_focus_commitments
    where user_id = $1 and action_id = $2 order by committed_on
  `, [ownerA, firstDestinationGraph.action_id])).rows, [
    { committed_on: '2026-11-30', position: 1 },
    { committed_on: '2026-12-01', position: 1 },
  ])

  const secondCrossImportId = mutation(119)
  assert.equal((await importBackup(admin, ownerA, secondCrossImportId, crossAccountPayload)).rows[0].result.idempotent, false)
  assert.deepEqual((await admin.query(`
    select
      (select count(*)::int from public.dostigator_goals
        where user_id = $1 and title = 'Цель из другого аккаунта') as goals,
      (select count(*)::int from public.dostigator_actions
        where user_id = $1 and title = 'Шаг из другого аккаунта') as actions,
      (select count(*)::int from public.dostigator_habits
        where user_id = $1 and title = 'Привычка из другого аккаунта') as habits,
      (select count(*)::int from public.dostigator_habit_checkins
        where user_id = $1 and note = 'Перенести') as checkins,
      (select count(*)::int from public.dostigator_weekly_reviews
        where user_id = $1 and week_start = '2026-12-07') as reviews,
      (select count(*)::int from public.dostigator_focus_commitments commitment
        join public.dostigator_actions action on action.id = commitment.action_id
        where commitment.user_id = $1 and action.title = 'Шаг из другого аккаунта') as commitments,
      (select revision::int from public.dostigator_goals where id = $2) as goal_revision,
      (select revision::int from public.dostigator_actions
        where user_id = $1 and title = 'Шаг из другого аккаунта') as action_revision,
      (select revision::int from public.dostigator_habits
        where user_id = $1 and title = 'Привычка из другого аккаунта') as habit_revision,
      (select revision::int from public.dostigator_habit_checkins
        where user_id = $1 and note = 'Перенести') as checkin_revision,
      (select revision::int from public.dostigator_weekly_reviews
        where user_id = $1 and week_start = '2026-12-07') as review_revision,
      (select count(*)::int from public.dostigator_history_events
        where user_id = $1 and source = 'import' and label like '%резервной копии') as import_events,
      (select revision::int from public.dostigator_goals where id = $3) as source_goal_revision
  `, [ownerA, firstDestinationGraph.goal_id, crossAccountGoalId])).rows[0], {
    goals: 1, actions: 1, habits: 1, checkins: 1, reviews: 1, commitments: 2,
    goal_revision: 2, action_revision: 2, habit_revision: 2, checkin_revision: 2, review_revision: 2,
    import_events: 10, source_goal_revision: 1,
  })
  assert.deepEqual((await admin.query(`
    select
      (select count(*)::int from public.dostigator_goals where user_id = $1 and id = $2) as goals,
      (select count(*)::int from public.dostigator_actions where user_id = $1 and id = $3) as actions,
      (select count(*)::int from public.dostigator_habits where user_id = $1 and id = $4) as habits,
      (select count(*)::int from public.dostigator_habit_checkins where user_id = $1 and id = $5) as checkins,
      (select count(*)::int from public.dostigator_weekly_reviews where user_id = $1 and id = $6) as reviews,
      (select count(*)::int from public.dostigator_focus_commitments where user_id = $1 and action_id = $3) as commitments
  `, [ownerB, crossAccountGoalId, crossAccountActionId, crossAccountHabitId, crossAccountCheckinId, crossAccountReviewId])).rows[0], {
    goals: 1, actions: 1, habits: 1, checkins: 1, reviews: 1, commitments: 2,
  })

  const ownerBUndoMismatchMutation = mutation(93)
  await expectRejected(
    () => undo(admin, ownerB, ownerBMutation, ownerBUndoMismatchMutation, ownerA),
    /expected owner does not match authenticated user/,
  )
  assert.deepEqual((await admin.query(`
    select
      (select title from public.dostigator_goals where id = $1) as title,
      (select revision::int from public.dostigator_goals where id = $1) as revision,
      (select count(*)::int from public.dostigator_history_events where mutation_id = $2) as events,
      (select count(*)::int from public.dostigator_mutation_requests where mutation_id = $2) as requests,
      (select count(*)::int from public.dostigator_history_events
        where reverts_event_id = (
          select id from public.dostigator_history_events where user_id = $3 and mutation_id = $4
        )) as reverts
  `, [ownerBGoalId, ownerBUndoMismatchMutation, ownerB, ownerBMutation])).rows[0], {
    title: 'Владелец B', revision: 1, events: 0, requests: 0, reverts: 0,
  })

  const importedGoalId = '93000000-0000-4000-8000-000000000094'
  const atomicImportId = mutation(94)
  const emptyImportGroups = { areas: [], actions: [], habits: [], checkins: [], reviews: [] }
  const importResult = await importBackup(admin, ownerA, atomicImportId, {
    ...emptyImportGroups,
    goals: [{ ...goalPayload('Импортировано атомарно'), id: importedGoalId, user_id: ownerB }],
  })
  assert.equal(importResult.rows[0].result.idempotent, false)
  const importRetry = await importBackup(admin, ownerA, atomicImportId, {
    ...emptyImportGroups,
    goals: [{ ...goalPayload('Импортировано атомарно'), id: importedGoalId, user_id: ownerB }],
  })
  assert.equal(importRetry.rows[0].result.idempotent, true)
  assert.deepEqual((await admin.query(`
    select goal.user_id::text, goal.title, goal.revision::int,
      (select count(*)::int from public.dostigator_history_events
       where user_id = $2 and entity_id = $1 and source = 'import') as events
    from public.dostigator_goals goal where goal.id = $1
  `, [importedGoalId, ownerA])).rows[0], {
    user_id: ownerA, title: 'Импортировано атомарно', revision: 1, events: 1,
  })

  const reviewBeforeBackupImport = (await admin.query(`
    select wins, metrics_snapshot, revision::int
    from public.dostigator_weekly_reviews where id = $1
  `, [reviewId])).rows[0]
  const importedSnapshot = {
    ...snapshot,
    score: 91,
    focus: { done: 3, committed: 3, rate: 1 },
  }
  const reviewBackupImportId = mutation(98)
  const reviewBackupPayload = {
    ...emptyImportGroups,
    goals: [],
    reviews: [{
      id: reviewId, user_id: ownerB, week_start: '2026-08-24', wins: 'Победы из копии', blockers: 'Из копии',
      next_focus: 'Восстановленный фокус', self_score: 9, metrics_snapshot: importedSnapshot,
      created_at: '2026-08-28T09:00:00.000Z', updated_at: '2026-08-30T09:00:00.000Z',
    }],
  }
  assert.equal((await importBackup(admin, ownerA, reviewBackupImportId, reviewBackupPayload)).rows[0].result.idempotent, false)
  assert.equal((await importBackup(admin, ownerA, reviewBackupImportId, reviewBackupPayload)).rows[0].result.idempotent, true)
  const importedReviewState = (await admin.query(`
    select wins, metrics_snapshot, revision::int,
      (select count(*)::int from public.dostigator_history_events
       where user_id = $2 and entity_id = $1 and source = 'import') as import_events
    from public.dostigator_weekly_reviews where id = $1
  `, [reviewId, ownerA])).rows[0]
  assert.equal(importedReviewState.wins, 'Победы из копии')
  assert.deepEqual(importedReviewState.metrics_snapshot, importedSnapshot)
  assert.equal(importedReviewState.revision, reviewBeforeBackupImport.revision + 1)
  assert.equal(importedReviewState.import_events, 1)

  const importedReviewEvent = (await admin.query(`
    select mutation_id::text, after_data->'metrics_snapshot' as after_metrics
    from public.dostigator_history_events
    where user_id = $1 and entity_id = $2 and source = 'import'
  `, [ownerA, reviewId])).rows[0]
  assert.deepEqual(importedReviewEvent.after_metrics, importedSnapshot)
  const reviewImportUndoId = mutation(99)
  await undo(admin, ownerA, importedReviewEvent.mutation_id, reviewImportUndoId)
  await undo(admin, ownerA, importedReviewEvent.mutation_id, reviewImportUndoId)
  const reviewAfterImportUndo = (await admin.query(`
    select wins, metrics_snapshot, revision::int,
      (select count(*)::int from public.dostigator_history_events
       where user_id = $2 and mutation_id = $3) as undo_events
    from public.dostigator_weekly_reviews where id = $1
  `, [reviewId, ownerA, reviewImportUndoId])).rows[0]
  assert.equal(reviewAfterImportUndo.wins, reviewBeforeBackupImport.wins)
  assert.deepEqual(reviewAfterImportUndo.metrics_snapshot, reviewBeforeBackupImport.metrics_snapshot)
  assert.equal(reviewAfterImportUndo.revision, reviewBeforeBackupImport.revision + 2)
  assert.equal(reviewAfterImportUndo.undo_events, 1)

  const lateRollbackGoalId = '93000000-0000-4000-8000-000000000100'
  const lateRollbackReviewId = '89000000-0000-4000-8000-000000000100'
  const lateRollbackImportId = mutation(100)
  await expectRejected(() => importBackup(admin, ownerA, lateRollbackImportId, {
    ...emptyImportGroups,
    goals: [{ ...goalPayload('Не должен сохраниться'), id: lateRollbackGoalId }],
    reviews: [{
      id: lateRollbackReviewId, user_id: ownerB, week_start: '2026-10-05', wins: '', blockers: '',
      next_focus: '', self_score: 5,
      metrics_snapshot: { ...snapshot, period: { weekStart: '2026-08-24', asOf: '2026-08-28' } },
      created_at: '2026-10-05T09:00:00.000Z', updated_at: '2026-10-05T09:00:00.000Z',
    }],
  }), /review snapshot does not match week/)
  assert.deepEqual((await admin.query(`
    select
      (select count(*)::int from public.dostigator_goals where id = $1) as goals,
      (select count(*)::int from public.dostigator_weekly_reviews where id = $2) as reviews,
      (select count(*)::int from public.dostigator_history_events where entity_id in ($1, $2)) as events,
      (select count(*)::int from public.dostigator_mutation_requests where mutation_id = $3) as requests
  `, [lateRollbackGoalId, lateRollbackReviewId, lateRollbackImportId])).rows[0], {
    goals: 0, reviews: 0, events: 0, requests: 0,
  })

  const ledgerRollbackGoalId = '93000000-0000-4000-8000-000000000121'
  const ledgerRollbackActionId = '97000000-0000-4000-8000-000000000121'
  const ledgerRollbackCommitmentId = '9a000000-0000-4000-8000-000000000121'
  const ledgerRollbackImportId = mutation(121)
  await expectRejected(() => importBackup(admin, ownerA, ledgerRollbackImportId, {
    ...emptyImportGroups,
    goals: [{ ...goalPayload('Откатить из-за ledger'), id: ledgerRollbackGoalId }],
    actions: [{
      ...actionPayload, id: ledgerRollbackActionId, goal_id: ledgerRollbackGoalId,
      title: 'Откатить шаг из-за ledger',
    }],
    focusCommitments: [{
      id: ledgerRollbackCommitmentId, user_id: ownerB, action_id: ledgerRollbackActionId,
      committed_on: '2026-12-14', position: 4, source_mutation_id: null,
      created_at: '2026-12-14T09:00:00.000Z',
    }],
  }), /invalid focus commitment/)
  assert.deepEqual((await admin.query(`
    select
      (select count(*)::int from public.dostigator_goals where id = $1) as goals,
      (select count(*)::int from public.dostigator_actions where id = $2) as actions,
      (select count(*)::int from public.dostigator_focus_commitments where id = $3) as commitments,
      (select count(*)::int from public.dostigator_history_events where entity_id in ($1, $2)) as events,
      (select count(*)::int from public.dostigator_mutation_requests where mutation_id = $4) as requests
  `, [ledgerRollbackGoalId, ledgerRollbackActionId, ledgerRollbackCommitmentId, ledgerRollbackImportId])).rows[0], {
    goals: 0, actions: 0, commitments: 0, events: 0, requests: 0,
  })

  const rollbackAreaId = '94000000-0000-4000-8000-000000000095'
  const rollbackGoalId = '95000000-0000-4000-8000-000000000095'
  const rollbackImportId = mutation(95)
  await expectRejected(() => importBackup(admin, ownerA, rollbackImportId, {
    areas: [{
      id: rollbackAreaId, user_id: ownerB, name: 'Откатить', color: '#ffffff', icon: 'sparkles', position: 99,
      archived_at: null, created_at: '2026-08-28T08:00:00.000Z', updated_at: '2026-08-28T08:00:00.000Z',
    }],
    goals: [{ ...goalPayload(''), id: rollbackGoalId, area_id: rollbackAreaId }],
    actions: [], habits: [], checkins: [], reviews: [],
  }), /title|constraint/)
  assert.deepEqual((await admin.query(`
    select
      (select count(*)::int from public.dostigator_areas where id = $1) as areas,
      (select count(*)::int from public.dostigator_goals where id = $2) as goals,
      (select count(*)::int from public.dostigator_history_events where entity_id = $2) as events,
      (select count(*)::int from public.dostigator_mutation_requests where mutation_id = $3) as requests
  `, [rollbackAreaId, rollbackGoalId, rollbackImportId])).rows[0], { areas: 0, goals: 0, events: 0, requests: 0 })

  const ownerMismatchImportId = mutation(96)
  await expectRejected(() => importBackup(admin, ownerB, ownerMismatchImportId, {
    ...emptyImportGroups, goals: [],
  }, ownerA), /backup import owner mismatch/)
  assert.equal((await admin.query(`
    select count(*)::int as count from public.dostigator_mutation_requests where mutation_id = $1
  `, [ownerMismatchImportId])).rows[0].count, 0)

  const ownerBHistory = await asUser(admin, ownerB, `
    select mutation_id::text from public.dostigator_history_events order by mutation_id
  `)
  assert.deepEqual(ownerBHistory.rows.map((row) => row.mutation_id), [
    ownerBMutation, mutation(112), mutation(113), mutation(114), mutation(115), mutation(116), mutation(117),
  ].sort())
  assert.deepEqual((await asUser(admin, ownerA, `
    select
      (select count(*)::int from public.dostigator_goals where id = $1) as goals,
      (select count(*)::int from public.dostigator_history_events where mutation_id = $2) as history
  `, [ownerBGoalId, ownerBMutation])).rows[0], { goals: 0, history: 0 })

  const currentFocusDate = '2027-02-01'
  const currentFocusActionA = '5a000000-0000-4000-8000-000000000201'
  const currentFocusActionB = '5a000000-0000-4000-8000-000000000202'
  await apply(admin, ownerA, {
    mutationId: mutation(201), entityType: 'action', entityId: currentFocusActionA, operation: 'action_create',
    label: 'Сегодняшний Focus A', expectedRevision: 0,
    after: {
      ...actionPayload, id: currentFocusActionA, title: 'Сегодняшний Focus A',
      focus_date: currentFocusDate, focus_position: 1,
    },
  })
  await apply(admin, ownerA, {
    mutationId: mutation(202), entityType: 'action', entityId: currentFocusActionA, operation: 'action_delete',
    label: 'Удалён сегодняшний Focus A', expectedRevision: 1,
    after: {
      ...actionPayload, id: currentFocusActionA, title: 'Сегодняшний Focus A', status: 'cancelled',
      focus_date: null, focus_position: null, completed_at: null, focus_delete_date: currentFocusDate,
    },
  })
  await apply(admin, ownerA, {
    mutationId: mutation(203), entityType: 'action', entityId: currentFocusActionB, operation: 'action_create',
    label: 'Сегодняшний Focus B', expectedRevision: 0,
    after: { ...actionPayload, id: currentFocusActionB, title: 'Сегодняшний Focus B' },
  })
  await apply(admin, ownerA, {
    mutationId: mutation(204), entityType: 'action', entityId: currentFocusActionB, operation: 'focus_add',
    label: 'Focus B занял освобождённый слот', expectedRevision: 1,
    after: {
      ...actionPayload, id: currentFocusActionB, title: 'Сегодняшний Focus B',
      focus_date: currentFocusDate, focus_position: 1,
    },
  })
  assert.deepEqual((await admin.query(`
    select
      (select status from public.dostigator_actions where id = $1) as deleted_status,
      (select focus_date is null and focus_position is null from public.dostigator_actions where id = $1) as pointer_cleared,
      (select count(*)::int from public.dostigator_focus_commitments where action_id = $1) as deleted_commitments,
      (select count(*)::int from public.dostigator_focus_commitments
        where user_id = $3 and committed_on = $4 and position = 1 and action_id = $2) as replacement_commitments,
      (select count(*)::int from public.dostigator_history_events where mutation_id in ($5, $6)) as final_events,
      (select count(*)::int from public.dostigator_mutation_requests where mutation_id in ($5, $6)) as final_requests
  `, [currentFocusActionA, currentFocusActionB, ownerA, currentFocusDate, mutation(202), mutation(204)])).rows[0], {
    deleted_status: 'cancelled', pointer_cleared: true, deleted_commitments: 0,
    replacement_commitments: 1, final_events: 2, final_requests: 2,
  })

  const portableTombstoneActionId = '5a000000-0000-4000-8000-000000000205'
  const portableFocusDayOne = '2027-02-02'
  const portableFocusDayTwo = '2027-02-03'
  await apply(admin, ownerA, {
    mutationId: mutation(205), entityType: 'action', entityId: portableTombstoneActionId, operation: 'action_create',
    label: 'Первый день переносимого Focus', expectedRevision: 0,
    after: {
      ...actionPayload, id: portableTombstoneActionId, title: 'Переносимый удалённый Focus',
      focus_date: portableFocusDayOne, focus_position: 2,
    },
  })
  await apply(admin, ownerA, {
    mutationId: mutation(206), entityType: 'action', entityId: portableTombstoneActionId, operation: 'focus_add',
    label: 'Второй день переносимого Focus', expectedRevision: 1,
    after: {
      ...actionPayload, id: portableTombstoneActionId, title: 'Переносимый удалённый Focus',
      focus_date: portableFocusDayTwo, focus_position: 2,
    },
  })
  await apply(admin, ownerA, {
    mutationId: mutation(207), entityType: 'action', entityId: portableTombstoneActionId, operation: 'action_delete',
    label: 'Удалён прошлый переносимый Focus', expectedRevision: 2,
    after: {
      ...actionPayload, id: portableTombstoneActionId, title: 'Переносимый удалённый Focus',
      status: 'cancelled', focus_date: null, focus_position: null, completed_at: null,
      focus_delete_date: '2027-02-04',
    },
  })
  assert.deepEqual((await admin.query(`
    select committed_on::text, position::int
    from public.dostigator_focus_commitments where user_id = $1 and action_id = $2
    order by committed_on
  `, [ownerA, portableTombstoneActionId])).rows, [
    { committed_on: portableFocusDayOne, position: 2 },
    { committed_on: portableFocusDayTwo, position: 2 },
  ])

  const exportedRoundTripGoal = (await admin.query(`
    select to_jsonb(goal) - 'revision' - 'last_mutation_id' as row
    from public.dostigator_goals goal where id = $1 and user_id = $2
  `, [goalId, ownerA])).rows[0].row
  const exportedRoundTripAction = (await admin.query(`
    select to_jsonb(action) - 'revision' - 'last_mutation_id' as row
    from public.dostigator_actions action where id = $1 and user_id = $2
  `, [portableTombstoneActionId, ownerA])).rows[0].row
  const exportedRoundTripCommitments = (await admin.query(`
    select to_jsonb(commitment) as row
    from public.dostigator_focus_commitments commitment
    where user_id = $1 and action_id = $2 order by committed_on
  `, [ownerA, portableTombstoneActionId])).rows.map(({ row }) => row)
  assert.equal(exportedRoundTripAction.status, 'cancelled')
  assert.equal(exportedRoundTripCommitments.length, 2)

  const tombstoneRoundTripImportId = mutation(208)
  const tombstoneRoundTripPayload = {
    ...emptyImportGroups,
    goals: [exportedRoundTripGoal],
    actions: [exportedRoundTripAction],
    focusCommitments: exportedRoundTripCommitments,
  }
  assert.equal((await importBackup(admin, ownerB, tombstoneRoundTripImportId, tombstoneRoundTripPayload)).rows[0].result.idempotent, false)
  assert.equal((await importBackup(admin, ownerB, tombstoneRoundTripImportId, tombstoneRoundTripPayload)).rows[0].result.idempotent, true)
  const importedTombstone = (await admin.query(`
    select action.id::text, action.status, action.focus_date, action.focus_position,
      action.goal_id::text, goal.user_id::text as goal_owner,
      (select count(*)::int from public.dostigator_focus_commitments commitment
        where commitment.user_id = $1 and commitment.action_id = action.id) as commitments,
      (select request_envelope ? 'trusted_context' from public.dostigator_mutation_requests
        where user_id = $1 and mutation_id = $2) as leaked_trusted_context
    from public.dostigator_actions action
    join public.dostigator_goals goal on goal.id = action.goal_id
    where action.user_id = $1 and action.title = 'Переносимый удалённый Focus'
  `, [ownerB, tombstoneRoundTripImportId])).rows[0]
  assert.notEqual(importedTombstone.id, portableTombstoneActionId)
  assert.deepEqual({ ...importedTombstone, id: undefined, goal_id: undefined }, {
    id: undefined, status: 'cancelled', focus_date: null, focus_position: null,
    goal_id: undefined, goal_owner: ownerB, commitments: 2, leaked_trusted_context: false,
  })
  assert.deepEqual((await admin.query(`
    select committed_on::text, position::int
    from public.dostigator_focus_commitments
    where user_id = $1 and action_id = $2 order by committed_on
  `, [ownerB, importedTombstone.id])).rows, [
    { committed_on: portableFocusDayOne, position: 2 },
    { committed_on: portableFocusDayTwo, position: 2 },
  ])
  assert.deepEqual((await admin.query(`
    select status, focus_date, focus_position, revision::int,
      (select count(*)::int from public.dostigator_focus_commitments where action_id = $1) as commitments
    from public.dostigator_actions where id = $1 and user_id = $2
  `, [portableTombstoneActionId, ownerA])).rows[0], {
    status: 'cancelled', focus_date: null, focus_position: null, revision: 3, commitments: 2,
  })

  console.log('PostgreSQL history gate passed: atomic RPC, CAS, RLS, idempotency, Undo and cursor pagination')
} finally {
  await Promise.allSettled(clients.map((client) => client.end()))
  await postgres.stop().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}
