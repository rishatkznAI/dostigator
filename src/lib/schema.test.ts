import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const core = readFileSync(`${process.cwd()}/supabase/migrations/20260827124224_create_dostigator_core.sql`, 'utf8')
const stage4 = readFileSync(`${process.cwd()}/supabase/migrations/20260830163718_add_stage4_habit_history_and_review_metrics.sql`, 'utf8')
const stage5 = readFileSync(`${process.cwd()}/supabase/migrations/20260830163749_add_atomic_mutation_history.sql`, 'utf8')
const stage6 = readFileSync(`${process.cwd()}/supabase/migrations/20260830163757_add_atomic_backup_import.sql`, 'utf8')

describe('Stage 4 schema contract', () => {
  it('keeps one owner-scoped review per week and RLS update checks', () => {
    expect(core).toContain('unique (user_id, week_start)')
    expect(core).toMatch(/dostigator reviews update own[\s\S]*using \(\(select auth\.uid\(\)\) = user_id\)[\s\S]*with check \(\(select auth\.uid\(\)\) = user_id\)/)
  })

  it('adds constrained habit history and immutable review snapshots without privileged code', () => {
    expect(stage4).toMatch(/activity_periods jsonb not null/)
    expect(stage4).toContain("jsonb_typeof(activity_periods) = 'array'")
    expect(stage4).toContain('metrics_snapshot jsonb')
    expect(stage4).toContain("jsonb_typeof(metrics_snapshot) = 'object'")
    expect(stage4).toContain('where metrics_snapshot is null')
    expect(stage4.toLowerCase()).not.toContain('security definer')
  })
})

describe('Stage 6 atomic backup contract', () => {
  it('restores every backup group inside one owner-bound database RPC', () => {
    expect(stage6).toContain('create or replace function public.dostigator_import_backup')
    expect(stage6).toContain('security definer')
    expect(stage6).toContain('backup import owner mismatch')
    expect(stage6).toContain("perform public.dostigator_apply_mutation(")
    expect(stage6).toContain('dostigator_backup_area_map')
    expect(stage6).toContain('dostigator_backup_entity_map')
    expect(stage6).toContain("coalesce(p_payload->'focusCommitments', '[]'::jsonb)")
    expect(stage6).toContain('public.dostigator_focus_commitments')
    expect(stage6).toContain("backup area id and name match different destination areas")
    expect(stage6).toContain("jsonb_build_object('area_id', v_destination_area_id)")
    expect(stage6).toContain("'payload_md5', md5(p_payload::text)")
    expect(stage6).toContain("set_config('dostigator.trusted_backup_import_token', v_trusted_import_token, true)")
    expect(stage6).toContain("set_config('dostigator.trusted_backup_import_token', '', true)")
    expect(stage6).toContain("set request_envelope = v_envelope")
    expect(stage6).toMatch(/revoke all on function public\.dostigator_import_backup[\s\S]*from public, anon/)
    expect(stage6).toMatch(/grant execute on function public\.dostigator_import_backup[\s\S]*to authenticated/)
  })
})

describe('Stage 5 history schema contract', () => {
  it('makes history append-only, owner-scoped and cursor-indexed', () => {
    expect(stage5).toContain('create table public.dostigator_history_events')
    expect(stage5).toContain('unique (user_id, mutation_id)')
    expect(stage5).toContain('dostigator_history_one_undo_idx')
    expect(stage5).toContain('dostigator_history_owner_cursor_idx')
    expect(stage5).toMatch(/history select own[\s\S]*auth\.uid\(\)[\s\S]*user_id/)
    expect(stage5).toContain('grant select on table public.dostigator_history_events to authenticated')
    expect(stage5).not.toMatch(/grant (insert|update|delete)[^;]*dostigator_history_events to authenticated/i)
  })

  it('routes mutations through restricted, revision-aware RPCs', () => {
    expect(stage5).toContain('create or replace function public.dostigator_apply_mutation')
    expect(stage5).toContain('create or replace function public.dostigator_undo_mutation')
    expect(stage5).toContain('security definer')
    expect(stage5).toContain('set search_path = public, pg_temp')
    expect(stage5).toMatch(/revision <> p_expected_revision/)
    expect(stage5).toContain("operation = 'undo'")
    expect(stage5).toMatch(/revoke insert, update, delete on table[\s\S]*from authenticated/)
  })

  it('uses explicit snapshot allowlists and preserves review metrics on edit', () => {
    expect(stage5).toContain("when 'goal' then jsonb_build_object")
    expect(stage5).toContain("when 'action' then jsonb_build_object")
    expect(stage5).toContain("when 'habit' then jsonb_build_object")
    expect(stage5).toContain("when 'review' then jsonb_build_object")
    expect(stage5).toContain("v_is_undo or p_source = 'import'")
    expect(stage5).toContain('else v_review.metrics_snapshot end')
    expect(stage5).toContain("raise exception 'untrusted import source'")
    expect(stage5).toContain("request.request_envelope->>'trusted_context' = v_trusted_import_token")
  })
})
