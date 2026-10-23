# Opt-in correction release gate

This test never connects to production. A release operator supplies a private,
read-only export of the actual `public` and `private` application catalog and all
24 application tables. The test restores it into disposable embedded PostgreSQL,
validates the foreign keys, then applies **only**
`20261023105721_add_safe_workout_set_corrections.sql`.

Print the single read-only export query:

```sh
node tests/postgres/correction-production-copy.audit.mjs --export-sql
```

Execute that SELECT through the authorized read-only production connection and
save **the `snapshot` object**, without the result-array wrapper, as
`../private-release/application-snapshot.json` relative to the repository. Set
the directory to mode 700 and the file to 600. Never commit the export, put it
in `outputs`, paste its rows into a PR, or upload it to another cloud database.
`rowsJson` is intentionally a string to preserve PostgreSQL numeric precision.

Run locally with Node 22 or later:

```sh
node tests/postgres/correction-production-copy.audit.mjs
```

`AUDIT_APPLICATION_SNAPSHOT` overrides the private file path. The default strict
table count is 24; `AUDIT_EXPECTED_TABLES` permits a deliberately reviewed schema
change. The script prints only table counts, hashes and PASS/FAIL flags, then
removes its disposable database even on failure. No row values or user IDs are
printed. Treat the exported function bodies as trusted release input: this test
executes their DDL locally as PostgreSQL owner.

The export includes table columns/defaults, enums, constraints, indexes,
application functions, triggers, RLS flags/policies, owners and explicit ACLs.
Triggers are installed after importing rows so the restoration cannot synthesize
history or alter copied data. The original export hash is validated first. Every
existing row is then compared as complete PostgreSQL JSON text using binary `C`
collation and two-way `EXCEPT ALL`, preserving duplicate multiplicity. Canonical
table hashes use the same `C` ordering before and after migration. This removes
only locale-dependent array row ordering; no field is ignored or normalized.
The new public invoker/private definer grants, anonymous denial, expected-owner
guard and arbitrary-session denial are verified without changing any copied row.

This is an **application logical restoration gate**, not a whole-cluster disaster
recovery claim. `auth.users` contains only the exported IDs to validate application
foreign keys. Auth passwords, identities, tokens and service configuration,
Storage metadata/binary objects, extensions, cluster roles' attributes/membership,
sequences, views, partitioned tables and default privileges are not restored.
The current application uses ordinary UUID-keyed tables; the script refuses
identity, generated and `nextval` columns rather than silently degrading them.
Physical backups and hosted Auth/Storage recovery require their own restore drill.
