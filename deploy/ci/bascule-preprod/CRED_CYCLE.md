# Bascule prod — credential cycle (governance record)

The bascule prod bundle references two k8s Secrets by NAME only; their material is
NEVER committed. They are minted operationally by the k8s lane at the prod-apply GO
and backed up to `.env`, per the governed k8s↔immo cred cycle (CLAUDE.md). i-cond
(immo) holds this record so recovery is verifiable at any time — no per-act owner GO.

## Minted secrets (ns radar-immobilier, materialized at GO by the k8s lane)

| secret (k8s name, hyphen) | keys | consumer | source |
| --- | --- | --- | --- |
| `radar-db-ro-prod` | `POSTGRES_USER=radar_db_ro_prod`, `POSTGRES_PASSWORD=<openssl rand>`, `POSTGRES_DB=radar` | CronJob dump (pg_dump RO) + Job `db-ro-role-provision` (`RO_PASSWORD`) | generated (openssl) |
| `radar-pra-admin-prod` | `S3_ACCESS_KEY`, `S3_SECRET_KEY` | CronJob dump upload (S3 PutObject → backups bucket) | `.env` (radar-pra-admin AWS_*) |

**Naming (do not conflate):** the SECRET object name is hyphenated (`radar-db-ro-prod`,
RFC1123); the PG ROLE name and the `POSTGRES_USER` VALUE are underscored
(`radar_db_ro_prod`). `db-ro-role-provision.yaml` sets the role password from
`radar-db-ro-prod/POSTGRES_PASSWORD` via psql `\getenv` (never in argv/logs;
`log_statement=none` measured in prod → the plaintext `ALTER ROLE` is not logged).

## Rotation
- `radar-db-ro-prod`: regenerate password (openssl) → update secret → re-run the
  idempotent `db-ro-role-provision` Job (its `ALTER ROLE` re-asserts the new password)
  → `.env` backup. No app impact (dump-only role).
- `radar-pra-admin-prod`: rotate the underlying radar-pra-admin S3 key → update secret.

## Verify recovery (any operator/owner/AI, no owner GO)
1. secrets present: `kubectl -n radar-immobilier get secret radar-db-ro-prod radar-pra-admin-prod`.
2. role usable: dump CronJob's last Job `.status` = Complete (or a psql login as
   `radar_db_ro_prod` with the secret password succeeds).
3. `.env` holds the current values (backup) at the documented owner location.

Committing the secrets to git = étape-2 (SealedSecrets). Until then, `.env` + this
record are the source of truth for recovery.
