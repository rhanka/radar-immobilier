# Runbook — Admission sync prod -> preprod (lot I1, R1)

## 1. Purpose

Every user approved in prod (`prod.public.account_users`, `status='approved'`)
can open preprod artifacts with no prior step, no database restore, and no
per-environment declaration. The two environments use distinct IdP domains, so
the preprod `sub` may differ from the prod `sub`: the join key is the verified
email, never the sub.

Mechanism (converged R2 §2.6):

- Prod builds a MINIMAL signed snapshot (Ed25519) from
  `prod.public.account_users`: `email`, `name`, `status`, `role`, `createdAt`,
  `approvedAt` only. No `sub`, no business content (Loi 25 minimisation; all
  data stays in BHS).
- Emission: on every admin status mutation (best-effort push) plus a periodic
  FULL snapshot (CronJob, every 15 min recommended).
- Preprod ingests read-only through `POST /api/v1/admission/ingest`
  (signature-verified webhook) or the `admission-ingest` cron job. Invalid
  signatures are rejected (401). A global monotonic replay guard
  (`admission_sync_state`, MAX over all keys) inside a serialised SQL
  transaction ignores delayed snapshots so an old FULL snapshot — including
  one signed with a rotated-out key — can never resurrect a newer revocation.
- `account_users.admission_source IN ('local','prod_sync')`: local preprod
  accounts are never overwritten by the sync; only `prod_sync` rows are
  status-propagated. A prod revocation takes effect at the next applied cycle.
- JIT reconciliation links the preprod `sub` on verified email
  (`email_verified=true`, trusted issuer), (a) in the reader opening flow on
  the control origin BEFORE `getRights`, and (b) at MCP/app login. Idempotent
  and concurrency-safe (two tabs, same email: one link). An already linked
  account is never relinked.
- Zero connection to prod from preprod, zero write towards prod. The only
  cross-environment direction is prod -> preprod (signed push).

## 2. Key generation (owner-run)

The agent never creates secrets. The owner generates one Ed25519 pair per
rotation with the repo's own generator (prints `kid`, private entry, public
entry — store them, do not paste them into chat/tickets):

The generator is the repo's own `generateAdmissionKeypair` (single source,
`api/src/admission/snapshot.ts`). It prints one JSON object with three values
and creates nothing:

- `kid` (16 chars) — the key id carried by every envelope;
- `privateEntry` (`kid.base64(jwk-json)`) — content of the prod Secret;
- `publicEntry` (`kid.base64(jwk-json)`) — preprod config value.

Owner terminal, inside the repo (prints the JSON to stdout, stores nothing):

```bash
make admission-keygen ENV=test-i1
```

## 3. Secrets and rotation

- Prod k8s Secret: **`radar-admission-signing`** (same pattern as
  `radar-sentropic-auth`), key **`signing-key`** = the private entry
  `kid.base64(jwk-json)`. Mounted as `ADMISSION_SIGNING_KEY`. Prod only.
- Rotation cycle: **90 days**, plus immediately on suspected compromise.
- Rotation procedure (overlap, zero downtime):
  1. Generate the new pair (§2). Owner GO #1.
  2. Add the new public entry to the preprod
     `ADMISSION_PROD_PUBLIC_KEYS` list (keep the old one: `old,new`). Deploy
     preprod. The webhook accepts both kids from this point.
  3. Switch the prod Secret to the new private entry. Deploy prod. New
     snapshots carry the new `kid`.
  4. After one FULL snapshot cycle + margin (≥ 1 h), remove the old public
     entry from preprod. Deploy preprod. Owner GO #2 confirms.
- The agent creates no Secret and rotates nothing: every step above is an
  explicit owner action.

## 4. Enabling the sync in preprod

Preprod deployment (owner/ops change, no code deploy needed beyond this lot):

```yaml
ADMISSION_SYNC_ENABLED: "1"
ADMISSION_PROD_PUBLIC_KEYS: "<kid1>.<b64>,<kid2>.<b64>"   # current (+ prev during rotation)
ADMISSION_TRUSTED_ISSUERS: "https://preprod.auth.sent-tech.ca,https://auth.sent-tech.ca"
```

Owner GO #3 (preprod activation) required before setting
`ADMISSION_SYNC_ENABLED=1`: it opens the ingest webhook and JIT linking.

## 5. Enabling the emitter in prod

Prod deployment (owner/ops change):

```yaml
ADMISSION_SIGNING_KEY: "<kid>.<b64-private-jwk>"          # from Secret radar-admission-signing
ADMISSION_SYNC_PUSH_URL: "https://preprod.immo.sent-tech.ca/api/v1/admission/ingest"
ADMISSION_TRUSTED_ISSUERS: "https://auth.sent-tech.ca"    # prod JIT for prod-local logins
```

Plus a prod CronJob (every 15 min recommended) running the emitter image:

```bash
npm run --silent admission:snapshot --workspace=api \
  | curl -fsS -X POST "$ADMISSION_SYNC_PUSH_URL" \
      -H 'content-type: application/json' --data-binary @-
```

Admin mutations push incrementally on their own (`admissionEmitted` in the
admin response tells whether the push landed); the CronJob converges
regardless. Owner GO #4 (prod emission) required: it lets identity
(email/name/status) leave prod towards preprod.

## 6. Manual check (preprod)

```bash
# 1. Emitter side (prod): print one FULL envelope (stdout is noisy — the
#    envelope is the single {"payload":...} line).
make admission-snapshot ENV=test-i1 2>/dev/null | grep -o '^{"payload".*}$' > ./tmp/i1/envelope.json
# 2. Offline signature check (no DB writes).
FILE=./tmp/i1/envelope.json make admission-verify ENV=test-i1
# 3. Apply (preprod): staging + prod_sync propagation summary.
FILE=./tmp/i1/envelope.json make admission-ingest ENV=test-i1
# 4. Read back (POSTGRES_* only needed when no .env sets them).
export POSTGRES_USER=radar POSTGRES_DB=radar
make db-query QUERY="SELECT kid, issued_at, entries FROM admission_sync_state" ENV=test-i1
make db-query QUERY="SELECT email, status, role FROM admission_sync_profiles ORDER BY email LIMIT 20" ENV=test-i1
make db-query QUERY="SELECT sub, email, status, admission_source FROM account_users WHERE admission_source='prod_sync'" ENV=test-i1
```

Expected: `verify` prints `{ok:true,...}`; `ingest` prints
`{applied:true,...}` (or `applied:false,stale:true` for a delayed envelope);
local rows (`admission_source='local'`) are byte-identical before/after.

## 7. Activation sequence (exact order)

1. Merge this lot; deploy preprod code (sync disabled by default — no-op).
2. Owner generates the keypair (§2). Owner GO #1 (key ceremony).
3. Owner creates Secret `radar-admission-signing` in prod (out of band).
4. Configure preprod env (§4, keys only, `ENABLED=0`). Deploy preprod.
5. Owner GO #3 → set `ADMISSION_SYNC_ENABLED=1` in preprod. Deploy.
6. Configure prod env + CronJob (§5). Owner GO #4 → emission starts.
7. Run the manual check (§6) against preprod; first prod-approved click on a
   shared preprod link must open the artifact (session → JIT link →
   `getRights` approved).
8. Rotation every 90 days (§3). Owner GO #2 closes each rotation.

## 8. Known gaps (I1 bound)

- Email change in prod leaves the old staging entry behind until the next FULL
  snapshot marks absent entries `rejected` (incremental snapshots only upsert).
- MCP bearer JIT needs email claims in the access token; otherwise the first
  MCP login requires one prior app login (which runs the full JIT).
- Sessions minted before this lot lack `email_verified`/`idp_issuer`: the
  opening-flow JIT skips them until the next login (the login-time JIT links
  on that same login, so no extra step is needed).
