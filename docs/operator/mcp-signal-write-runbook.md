# MCP signal writes — commissioning runbook (PR #1107)

Scoped MCP classification writes (`classify_signal`, `confirm_classification`,
`annotate_signal`, plus the read tools). The prod base manifest stays inert:
`IMMO_MCP_SIGNALS_WRITE_ENABLED="0"`, the `immo:signals:write` scope is not
announced, and the signal Secret reference is optional, so the base —
reapplied on every main push — boots and serves reads with none of the
steps below done.

## Commissioning, in order

Exact order, per environment: role, migration + grants, Secret, IdP scope,
then activation. Never announce the scope or set the flag before the steps
above it exist.

**Preprod is active by default** (since 2026-11-18): its prerequisites are
verified in place, so the preprod overlay itself announces the scope and
sets the flag to `"1"`, and the CD reapplies it on every main push. The old
`deploy/overlays/preprod-signal-write` activation overlay was removed: the
default overlay now carries its values, keeping one source. A flag at
`"1"` with no Secret no longer crashes the server, but it starts read-only
(twelve tools, explicit `signal binding unavailable` log line) and the five
signal tools stay unregistered until the Secret and the binding are in
place. The CI deployer account cannot read Secrets (0 secrets by design),
so no kubectl Secret check gates the deploy: after the rollout, CD reads
the unauthenticated `GET /mcp/.well-known/signal-write` enum
(`active | read-only | disabled`) on the preprod endpoint and fails the
deploy unless it reports `active`.

**Prod stays inert.** Remaining prod steps, in order: create role
`immo_mcp_signal_writer` (step 1), apply migration 0048 + grants (step 2),
create Secret `immo-mcp-signal-writer` (step 3, BEFORE any activation),
declare `immo:signals:write` at the prod IdP (step 4), then apply the
activation overlay `deploy/overlays/prod-signal-write` (step 5).

> **Mandatory logging**: every manual production step below (role/grants SQL,
> Secret creation or rotation, and prod overlay apply) MUST be appended to
> [`docs/operator/manual-operations-log.md`](./manual-operations-log.md) with
> role, UTC timestamp, scope, redacted command, diff summary, Product Owner GO
> reference, and planned CD return — never log Secret values or URIs.

1. **Role.** Create the dedicated PostgreSQL role with LOGIN:
   `CREATE ROLE immo_mcp_signal_writer LOGIN;` and set its password through
   the operator credential cycle. The role holds no direct table privilege;
   the migrator grants it EXECUTE on `signal_mcp_read`,
   `signal_mcp_write_mcp` and `signal_mcp_result`, plus
   `SELECT (profile_id,code,verdict)` on `facet_reason_codes`.
2. **Migration and grants.** Apply migration `0048_signal_mcp_write` through
   the usual db-migrate path, which replays
   `api/src/db/service-role-grants.ts` right after. Verify with a connection
   as the role: `SELECT signal_mcp_read(...)` works, and a direct
   `INSERT INTO signal_mcp_events` is refused.
3. **Secret.** Create Secret `immo-mcp-signal-writer`, key
   `IMMO_MCP_SIGNAL_DATABASE_URL`, pointing at the same database as the API.
   Rotation: create the new password on the role, update the Secret value,
   roll `radar-immo-mcp` (Recreate), verify `tools/list` still answers and a
   `list_class_reasons` call succeeds, then drop the old password. Keep the
   value only in the Secret and the `.env` operator record, never in git.
4. **IdP scope.** Declare `immo:signals:write` in the IdP scope catalogue
   and on the `immo-mcp` client row (preprod IdP, qualify, then prod IdP).
   Announcing the scope before this step makes authorization requests fail
   with `invalid_scope`.
5. **Activation.** Only now activate: preprod is already covered (the
   default overlay carries scope + flag `"1"` since 2026-11-18); for prod,
   apply `deploy/overlays/prod-signal-write` (render check first, then
   apply), which announces the scope and sets the flag to `"1"`.
   The five signal tools appear in `tools/list` only while the binding is
   active, which needs flag `"1"` AND the Secret present: with the flag on
   and the Secret missing, the server starts read-only and logs
   `signal binding unavailable` instead of crashing. Users then grant the
   new scope explicitly and reconnect; the default consent selection stays
   read-only.

## Verification at flag "0" (base, no Secret)

The base render must carry `IMMO_MCP_SIGNALS_WRITE_ENABLED: "0"`, no
`immo:signals:write` in `IMMO_MCP_OAUTH_SCOPES_SUPPORTED`, and
`optional: true` on the `IMMO_MCP_SIGNAL_DATABASE_URL` secretKeyRef, so the
pod starts without Secret `immo-mcp-signal-writer` and the twelve read
tools answer normally.

## Rollback

1. Reapply the base (flag back to `"0"`, scope unannounced) or delete the
   activation overlay apply. The signal tools disappear from `tools/list`.
2. Drop the 0048 objects. This destroys the scoped journal and the audit
   trail; export them first if they must be kept.

```sql
DROP FUNCTION IF EXISTS signal_mcp_write_mcp(text,text,text,jsonb,text,text);
DROP FUNCTION IF EXISTS signal_mcp_write_browser(text,jsonb,text,text);
DROP FUNCTION IF EXISTS signal_mcp_write_core(text,text,text,jsonb,text,text,text,text);
DROP FUNCTION IF EXISTS signal_mcp_result(text,text,text,text,text,jsonb,jsonb);
DROP FUNCTION IF EXISTS signal_mcp_read_city(text,uuid,text);
DROP FUNCTION IF EXISTS signal_mcp_read(text,jsonb);
DROP TABLE IF EXISTS signal_mcp_events;
DROP TABLE IF EXISTS signal_mcp_audit;
DROP INDEX IF EXISTS signal_class_annotation_history_city_idx;
```

The append-only triggers drop with their tables. The audit columns added
to `signal_mcp_audit` in 0048 drop with that table. Nothing else in 0048
widens another table: the `source` CHECKs of `signal_class_annotations`
and `facet_events` were left untouched, so no constraint rollback is
needed. Finally delete Secret `immo-mcp-signal-writer` and, if the
activation was announced, remove `immo:signals:write` from the IdP client
row after clients have reconnected without it.
