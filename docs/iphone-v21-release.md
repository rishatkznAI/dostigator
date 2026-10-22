# V2.1 reliability release — hold production

Read-only inspection on 2026-10-22 confirmed that the live database has no `training_save_workout`, `training_cancel_workout`, `cardio_list_facts` or `cardio_apply_fact`, no `cardio_facts` table, and neither `pallof_press` nor `cable_hip_extension` reference key. RIR is already nullable. This is an incompatible frontend/backend release, not evidence of a broken iPhone session.

The current production frontend is based on main `f80ec009560615ea6eb8881e35dab9b92fbd6728`. This branch is not a production release.

Two committed, pending migrations supply the missing backend contract:

- `20261022050058_persist_exact_cardio_and_atomic_workouts.sql`
- `20261022175114_add_v21_exercise_references.sql`

They have been applied to disposable real PostgreSQL and checked through PostgREST. Upgrade assertions compare complete snapshots of existing history, active sessions, template rows and existing exercise references before/after adding V2.1 keys; repeating the reference migration does not duplicate entries. No new schema change is required by this client fix.

Before an authorized production release:

1. Recheck the live migration ledger/schema and take a recoverable database backup. There is pre-existing migration-ledger drift; do not blindly push every local migration.
2. Apply only the missing, reviewed migrations in dependency order. Do not reset or reseed the database, replace old workout snapshots or rewrite legacy template rows.
3. Verify real Auth + PostgREST using disposable accounts in a genuine isolated Supabase project. Branching is unavailable on the current free plan; the local stand's Auth fixture is not sufficient for this gate.
4. Verify save/retry/cancel RPCs and exact cardio, then publish the client only with separate user approval. Verify Pages assets and service-worker activation against the intended commit.
5. On the actual iPhone origin, preserve the existing draft, reopen it, complete/synchronize it, then start a new V2.1 workout. Do not clear Safari/PWA data to force an update. Check keyboard, bottom browser bar, background/resume, offline/reconnect and token refresh.

NO-GO for production and unqualified real-iPhone use until these gates pass. Local functional testing can proceed at the separate Wi-Fi test origin; its data is synthetic.
