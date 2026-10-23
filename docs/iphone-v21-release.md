# V2.1 release hold — audit, 23 October 2026

Production has only been read. PR #4 must remain unmerged until separately approved. Starting head: ec0454da311e55f9a59fd3c12a8f8985f51a6d81; published main: f80ec009560615ea6eb8881e35dab9b92fbd6728.

## Problems fixed

- Hosted PostgREST retried business exceptions using SQLSTATE 40001 indefinitely. Reproduced with timed-out requests and an active backend. The pending migration now uses PT409 / HTTP 409; clients recognize both codes. Only looping test-project backends were terminated. [Supabase explanation](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
- Direct legacy INSERT could resurrect a cancelled workout. The new regression failed before the fix. A private trigger now checks tombstones, and legacy writes share the RPC session lock. Sequential and two-connection cancellation/write races pass.
- Account switching between identity check and request could send a draft under another user's session. Workout save/cancel and cardio mutations require p_expected_owner checked against auth.uid(). The guard is outside the mutation fingerprint, preserving exact previously persisted request payloads.
- The published client omits that owner guard. Its workout save/cancel and cardio request shapes now fail before writing with PT426 / HTTP 426. History reads remain available. Backend-only deployment intentionally leaves old tabs unable to synchronize until the client updates. Do not roll back to the unguarded frontend.
- Delayed cancellation preserves a different workout opened in another tab and archives newer retained input. Stale enqueues cannot replace newer/completed queue entries.
- Removed the HTTP stand's blanket table grant, which overrode migration permissions. Added a PR verification workflow without production credentials or deployment privileges.

## Migration drift

Production project vbxkcvygfakmosjvxjwh has 19 recorded migrations.

| Local version | Production version | Finding |
| --- | --- | --- |
| 20260914175954_add_cloud_journal | 20260914180646_add_cloud_journal | SQL bodies equal after outer whitespace; already applied |
| 20261014180703_add_cardio_sessions | 20261014181324_add_cardio_sessions | SQL bodies equal after outer whitespace; already applied |

The local initial migration is a rewritten bootstrap: types, constraints, indexes and seeds differ from the original production SQL. Other differences are comments and an intermediate reference policy superseded by a later consolidation. Do not replay the bootstrap or timestamp aliases. RIR is already nullable.

Actually missing: cardio_facts, private request/tombstone tables, workout revision/protocol triggers, five workout/cardio RPCs, and pallof_press / cable_hip_extension. Apply only these reviewed final files, in order:

1. 20261022050058_persist_exact_cardio_and_atomic_workouts.sql
2. 20261022175114_add_v21_exercise_references.sql

No production ledger repair or db push was performed. Prefer an explicitly reviewed local baseline aligned to established production versions. Any alternative ledger repair needs its exact mapping approved; never mark missing SQL as applied. Targeted API migrations may receive generated versions: record the returned version and SQL hash, so a later CLI push cannot unknowingly repeat the same DDL.

## Evidence

- pnpm test:all: lint, TypeScript, 496 app tests, 31 program tests, PostgreSQL integration and build pass. Default runs explicitly skip six remote tests plus the opt-in Auth gate.
- Independent project xorlzijpgklasatxzcnn: real Supabase Auth password login, refresh event and token rotation, save/replay, completion, cancel, stale CAS returning HTTP 409 promptly, logout/revoked refresh, re-login, retained local draft and two-user isolation pass. Exact replay follows a real commit whose response is deliberately discarded. Real issued JWTs are used; no fake Auth endpoint. Confirmed synthetic users were provisioned in the isolated Auth schema; signup/email delivery and OAuth are not tested.
- All six unchanged remote anonymous tests pass there, with real /auth/v1/settings HTTP 200. Authenticated positive controls read nonempty owned fixtures in all six tables; a second real user sees none.
- tests/postgres/production-upgrade.audit.mjs reconstructs the actual production catalog, including table types, constraints, indexes, policies, grants, triggers and function bodies, then loads existing training data and applies both final migrations. All old fields of 5 completed + 2 active sessions, 50 exercise snapshots and 146 sets are unchanged. Only revision=0 and two references are added. Repeating the reference migration creates no duplicate. Private exports stay outside Git/output bundles. This is not a whole-cluster backup or PITR restore test.
- tests/http-browser/api-cases.mjs: real PostgreSQL/PostgREST, all 30 A/B sets, optional RIR, rollback, CAS, lost response/replay, cancellation and exact linked 20:17 cardio pass. This separate local stand uses fixture Auth.
- Real-Auth browser: app login, set without RIR and reload restore one recorded set and confirmed cloud status. Loopback service-worker checks do not establish physical iOS behavior.
- Advisors: private tables intentionally have no caller policies; definer RPCs have empty search paths, ownership checks and denied anonymous execution. Test-project leaked-password protection is disabled. FK index notices were addressed. Unused-index notices on a fresh test project do not justify deleting indexes.

Cloud reproduction, Node 24, isolated credentials in a gitignored .env.audit.local:

```sh
DOSTIGATOR_AUTH_AUDIT=1 node --env-file=.env.audit.local node_modules/vitest/vitest.mjs run --mode audit tests/real-auth.audit.test.ts src/lib/security.remote.test.ts
```

The gate refuses the production ref. Supply private catalog exports to the copy gate using AUDIT_SNAPSHOT_DIR; never commit them.

## Ordered release procedure — requires approval

1. Complete physical iPhone acceptance on a separate HTTPS origin, in Safari and installed PWA. Preserve each context's existing local drafts; never clear site data or reinstall over unexported drafts.
2. Pin the reviewed client commit and both SQL SHA-256 values. Require green PR CI. Re-read production catalog/ledger immediately before release; unexpected differences stop the release.
3. Take a recoverable database backup to an approved private destination and test restore away from production. Export local drafts/queues from every real Safari/PWA context and verify readability; cloud history is not their backup.
4. Approve baseline/ledger alignment separately. Apply only migration 1, then 2, each transactionally with the specified lock timeout. A timeout stops the attempt. Never reset, reseed, truncate, rewrite history or run bulk db push.
5. Verify object definitions, RLS, anonymous denial, 409/426 behavior, exact old-history preservation and exercise keys. Creating/deleting production user workouts requires specific approval.
6. Publish the guarded client in the same approved window. Main merge automatically deploys Pages: merge authorization must cover deployment. Verify served asset hashes and service-worker activation. Reopen existing drafts at the same origin and synchronize only with acknowledged writes.
7. Observe errors, pending queues and history cardinality. On failure, stop rollout; preserve additions, tombstones and queues. Roll forward or restore a reviewed guarded client. Do not drop new tables or restore an old backup over newer user writes. Database recovery requires separate approval.

NO-GO until device acceptance, recoverable backup, final CI and explicit production authorization. The independent project was quoted at $0/month and contains reference data plus synthetic users/workouts, not copied personal history.
