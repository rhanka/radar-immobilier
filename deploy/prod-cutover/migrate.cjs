/* global require, module, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
function migrationSql(entry, expected) {
  const pairs = expected.map(e => `('${e.hash}',${e.when}::bigint)`).join(',');
  const text = r.fs.readFileSync(entry.file, 'utf8');
  // This release has no non-transactional DDL. Reject future incompatible input.
  if (/\bCONCURRENTLY\b|^\s*(COMMIT|ROLLBACK)\s*;/im.test(text)) r.fail('non_transactional_ddl_requires_review');
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='300s';
SELECT pg_advisory_xact_lock(hashtextextended('immo-prod-cutover-v1220',0));
DO $guard$ BEGIN
IF EXISTS (SELECT hash,created_at FROM drizzle.__drizzle_migrations
  EXCEPT SELECT * FROM (VALUES ${pairs}) AS expected(hash,created_at))
OR EXISTS (SELECT * FROM (VALUES ${pairs}) AS expected(hash,created_at)
  EXCEPT SELECT hash,created_at FROM drizzle.__drizzle_migrations)
OR (SELECT count(*) FROM drizzle.__drizzle_migrations) <> ${expected.length}
THEN RAISE EXCEPTION 'migration_prefix_changed'; END IF;
END $guard$;
${text.replaceAll('--> statement-breakpoint', '')}
INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('${entry.hash}',${entry.when});
COMMIT;`;
}
function migrate() {
  r.destination();
  r.mutationGuard();
  const { planSha256, rosterSha256 } = r.approvedPlan();
  const proof = r.evidence();
  const entries = r.journal();
  let count = r.prefix(r.rows(), entries);
  if (r.env.ENV === 'execution-prod') {
    const b = r.receipt('backup');
    if (r.receipt('restore').sha256 !== b.sha256 || b.run !== proof.run || b.drain !== proof.completedAt
      || !r.sameIdentity(b.destination, r.identity()))
      r.fail('tested_final_backup_required');
  } else {
    const restored = r.receipt('restore');
    if (!r.env.ARCHIVE || restored.sha256 !== r.hash(r.safeFile(r.env.ARCHIVE))
      || r.env.RESTORE_SHA256 !== restored.sha256 || !r.sameIdentity(restored.destination, r.identity()))
      r.fail('restored_production_copy_required');
  }
  const measured = [];
  const start = Date.now();
  const walStart = r.sql('SELECT pg_current_wal_lsn();');
  for (; count < entries.length; count++) {
    const e = entries[count];
    const at = Date.now();
    r.save('migration-current', { tag: e.tag, hash: e.hash, status: 'started', at: new Date().toISOString() });
    try { r.sql(migrationSql(e, entries.slice(0, count)), { timeout: 540000 }); }
    catch (error) {
      r.save('migration-failed', { tag: e.tag, durationMs: Date.now() - at,
        outcome: 'indéterminé : vérifier le journal avant reprise', code: error.message });
      throw error;
    }
    const result = { tag: e.tag, hash: e.hash, durationMs: Date.now() - at, status: 'committed' };
    measured.push(result);
    r.fs.appendFileSync(r.path.join(r.output(), 'migration-times.jsonl'), `${JSON.stringify(result)}\n`, { mode: 0o600 });
  }
  if (r.prefix(r.rows()) !== 44) r.fail('migration_verification_failed');
  const walBytes = Number(r.sql(`SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),'${walStart}');`));
  const result = { sha: r.SHA, planSha256, rosterSha256, destination: r.identity(), migrations: 44, applied: measured, walBytes, durationMs: Date.now() - start };
  r.save('migrations', result);
  return result;
}
function hook(operation) {
  r.destination();
  r.mutationGuard();
  const { plan, planSha256, rosterSha256 } = r.approvedPlan();
  if (r.prefix(r.rows()) !== 44) r.fail('44_migrations_required');
  const image = r.pinnedImage();
  const proof = r.evidence();
  const m = r.receipt('migrations');
  if (m.sha !== r.SHA || !r.sameIdentity(m.destination, r.identity())) r.fail('migration_receipt_mismatch');
  if (m.planSha256 !== planSha256 || m.rosterSha256 !== rosterSha256) r.fail('migration_plan_mismatch');
  const name = `immo-6h-${proof.run}`;
  const begin = Date.now();
  // The immutable hook accepts a strict four-field contract, not the controller's local receipt.
  const hookProof = { run: proof.run, release: proof.release, instances: proof.instances, completedAt: proof.completedAt };
  const variables = { ...r.env, CUTOVER_PLAN: JSON.stringify(plan), CUTOVER_EVIDENCE: JSON.stringify(hookProof),
    CUTOVER_OPERATION: operation, PGOPTIONS: '-c lock_timeout=5000 -c statement_timeout=300000' };
  const localCopy = r.env.ENV === 'rehearsal' && r.env.PGPORT === '25433'
    && r.env.PGDATABASE === 'radar_cutover_owner_20261113';
  if (localCopy) Object.assign(variables, { PGHOST: 'postgres', PGPORT: '5432' });
  const names = ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD', 'PGOPTIONS', 'PGPASSFILE',
    'CUTOVER_PLAN', 'CUTOVER_EVIDENCE', 'CUTOVER_OPERATION'];
  const args = ['run', '--pull=never', '--rm', '--name', name,
    localCopy ? '--network=radar-prod-copy-owner_copy-only' : '--network=host',
    '--user', `${process.getuid()}:${process.getgid()}`, '--read-only', '--tmpfs', '/tmp',
    '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--mount', `type=bind,src=${r.ROOT}/deploy/prod-cutover/hook.cjs,dst=/run-cutover.cjs,readonly`];
  if (r.env.PGPASSFILE) args.push('--mount', `type=bind,src=${r.env.PGPASSFILE},dst=${r.env.PGPASSFILE},readonly`);
  for (const name of names) args.push('-e', name);
  args.push('--entrypoint', 'node', image, '/run-cutover.cjs');
  if (!variables.PGPASSWORD) r.fail('hook_password_injected_by_operator_required');
  let verdict;
  try { verdict = JSON.parse(r.run('docker', args, { timeout: 550000, env: variables }).trim()); }
  finally {
    // A killed Docker client must never leave the hook running in the daemon.
    try { r.run('docker', ['rm', '-f', name], { timeout: 15000 }); } catch { /* already removed */ }
  }
  if (!verdict.ok || (operation === 'transition' && (verdict.status !== 'open-success'
    || verdict.epoch !== 'scoped' || verdict.sealedUnresolved !== 0 || verdict.maintenanceBarrier !== false)))
    r.fail('hook_verdict_refused');
  const result = { ...verdict, sha: r.SHA, planSha256, rosterSha256, run: proof.run, destination: r.identity(), durationMs: Date.now() - begin };
  r.save(operation, result);
  if (operation === 'transition') r.fs.appendFileSync(r.path.join(r.output(), 'transition-times.jsonl'),
    JSON.stringify({ durationMs: result.durationMs, status: result.status }) + '\n', { mode: 0o600 });
  return result;
}
module.exports = { migrationSql, migrate, hook };
