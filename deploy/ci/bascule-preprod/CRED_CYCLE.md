# Bascule prod — credential cycle (governance record)

The bascule prod bundle references two k8s Secrets by NAME. **CD-native v2:** their
material is committed as **SealedSecrets** (encrypted, safe in git —
`radar-db-ro-prod-sealed.yaml`, `radar-pra-admin-prod-sealed.yaml`) and materialized
in-cluster by the sealed-secrets controller. **No plaintext is ever committed and
no GH secret carries these creds anymore** — the pipeline applies the SealedSecret
manifests (`bascule-bundle-cd.yml`) and the controller decrypts. A `.env` copy stays
the étape-1 recovery convenience per the governed k8s↔immo cred cycle (CLAUDE.md).
i-cond (immo) holds this record so recovery is verifiable at any time — no per-act owner GO.

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

Committing the secrets to git as SealedSecrets = **étape-2, DONE** (v2). The
encrypted SealedSecrets are the committed source; the sealed-secrets controller is
the materializer; `.env` remains a recovery copy (not a pipeline dependency), and
this record documents the rotation cycle.
