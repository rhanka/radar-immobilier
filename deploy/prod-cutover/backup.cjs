/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
const { fs, path, env, fail, sql, run, hash, save, receipt } = r;
function archive() {
  if (!env.ARCHIVE || !path.isAbsolute(env.ARCHIVE) || /(^|\/)\.env/.test(env.ARCHIVE)) fail('absolute_archive_required');
  if (fs.existsSync(env.ARCHIVE)) r.safeFile(env.ARCHIVE);
  return env.ARCHIVE;
}
function checkedArchive() {
  const file = archive();
  if (!/^[a-f0-9]{64}$/.test(env.RESTORE_SHA256 || '') || hash(file) !== env.RESTORE_SHA256)
    fail('archive_checksum_mismatch');
  const toc = run('pg_restore', ['--list', file]);
  if (!/^;\s+dbname: radar\s*$/m.test(toc)) fail('archive_not_from_radar');
  return file;
}
function backup() {
  r.destination();
  r.mutationGuard();
  const { planSha256, rosterSha256 } = r.approvedPlan();
  const proof = r.evidence();
  const source = { ...env, PGHOST: env.SOURCE_PGHOST, PGPORT: env.SOURCE_PGPORT,
    PGUSER: env.SOURCE_PGUSER, PGDATABASE: env.SOURCE_PGDATABASE,
    PGPASSFILE: env.SOURCE_PGPASSFILE, PGSERVICE: '', PGSERVICEFILE: '',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=840000 -c lock_timeout=5000' };
  delete source.PGPASSWORD;
  if (!source.PGHOST || !source.PGPORT || !source.PGPASSFILE
    || source.PGDATABASE !== 'radar' || source.PGUSER !== 'radar_db_ro_prod') fail('explicit_existing_ro_source_required');
  if (env.ENV !== 'execution-prod') fail('production_dump_requires_separate_owner_execution');
  if (source.PGHOST !== env.PGHOST || source.PGPORT !== (env.PGPORT || '5432')
    || env.PGDATABASE !== 'radar') fail('backup_source_destination_mismatch');
  // Inspect capabilities, never role passwords. Refuse inherited table write privileges.
  const safe = sql(`SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')
      AND has_table_privilege(current_user, quote_ident(schemaname)||'.'||quote_ident(tablename),
      'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')) FROM pg_roles WHERE rolname=current_user;`, { env: source });
  if (safe !== 't') fail('source_role_not_read_only');
  if (!/^s3:\/\/sentropic-pgbackup\/immo\/v1220\/[a-zA-Z0-9_-]+$/.test(env.BACKUP_URI || '')
    || env.BACKUP_ENDPOINT !== 'https://s3.bhs.io.cloud.ovh.net') fail('backup_location_required');
  const file = archive();
  const record = path.join(r.output(), 'backup.json');
  if (fs.existsSync(record)) {
    const prior = receipt('backup');
    if (prior.sha256 !== hash(file) || prior.run !== proof.run || prior.drain !== proof.completedAt
      || !r.sameIdentity(prior.destination, r.identity()))
      fail('backup_receipt_conflict');
    return prior;
  }
  const context = { run: proof.run, drain: proof.completedAt, destination: r.identity(), archive: file };
  const startedFile = path.join(r.output(), 'backup-start.json');
  if (fs.existsSync(startedFile)) {
    if (JSON.stringify(receipt('backup-start')) !== JSON.stringify(context)) fail('backup_start_conflict');
  } else {
    if (fs.existsSync(file)) fail('archive_without_receipt_requires_new_path');
    save('backup-start', context);
  }
  const begin = Date.now();
  const bytes = Number(sql('SELECT pg_database_size(current_database());', { env: source }));
  const disk = fs.statfsSync(path.dirname(file));
  if (disk.bavail * disk.bsize < bytes * 4) fail('backup_disk_headroom_required');
  // Keep ACLs in the archive for rollback. Disposable restore ignores them.
  if (!fs.existsSync(file)) {
    run('pg_dump', ['--format=custom', '--lock-wait-timeout=5s',
      `--file=${file}.partial`], { env: source, timeout: 840000 });
    fs.renameSync(`${file}.partial`, file);
  }
  fs.chmodSync(file, 0o600);
  const sha256 = hash(file);
  const uri = `${env.BACKUP_URI}/${sha256}.dump`;
  const s3 = args => run('s5cmd', ['--endpoint-url', env.BACKUP_ENDPOINT, ...args], { timeout: 180000 });
  s3(['cp', file, uri]);
  s3(['cp', uri, `${file}.roundtrip`]);
  if (hash(`${file}.roundtrip`) !== sha256) fail('s3_roundtrip_checksum_mismatch');
  fs.unlinkSync(`${file}.roundtrip`);
  fs.writeFileSync(`${file}.sha256`, `${sha256}\n`, { mode: 0o600 });
  s3(['cp', `${file}.sha256`, `${uri}.sha256`]);
  const result = { sha256, uri, planSha256, rosterSha256, run: proof.run, drain: proof.completedAt,
    databaseBytes: bytes, destination: r.identity(), durationMs: Date.now() - begin, sha: r.SHA };
  save('backup', result);
  return result;
}
function restoreTest() {
  r.destination();
  if (env.ENV === 'execution-prod') fail('restore_test_must_be_disposable');
  const { planSha256, rosterSha256 } = r.approvedPlan();
  const proof = r.evidence();
  const file = checkedArchive();
  const exists = fs.existsSync(path.join(r.output(), 'restore.json'));
  if (exists) {
    const old = receipt('restore');
    if (old.sha256 !== hash(file) || !r.sameIdentity(old.destination, r.identity()))
      fail('restore_already_used_or_conflicting');
    const b = receipt('backup');
    if (b.sha256 !== old.sha256 || b.run !== proof.run || b.drain !== proof.completedAt
      || !r.sameIdentity(b.destination, old.destination)) fail('backup_receipt_conflict');
    r.prefix(r.rows()); // Same copy may have progressed from 13 to 44. Never restore over it.
    return old;
  }
  if (Number(sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e');")))
    fail('empty_database_required');
  const begin = Date.now();
  run('pg_restore', ['--exit-on-error', '--single-transaction',
    `--dbname=${env.PGDATABASE}`, file], { timeout: 1800000 });
  if (r.prefix(r.rows()) !== 13) fail('restore_expected_13_migrations');
  const result = { sha256: hash(file), planSha256, rosterSha256, destination: r.identity(), durationMs: Date.now() - begin };
  // Same recovery contract as production, bound to the physical disposable copy.
  save('backup', { ...result, sha: r.SHA, run: proof.run, drain: proof.completedAt,
    uri: null, databaseBytes: Number(sql('SELECT pg_database_size(current_database());')) });
  save('restore', result);
  return result;
}
function rollback() {
  r.destination();
  r.mutationGuard();
  const proof = r.evidence();
  const file = checkedArchive();
  const b = receipt('backup');
  if (b.sha256 !== hash(file) || b.sha !== r.SHA || b.run !== proof.run
    || !r.sameIdentity(b.destination, r.identity())) fail('rollback_backup_mismatch');
  const begin = Date.now();
  run('bash', [path.join(r.ROOT, 'deploy/cutover/atomic-restore.sh')], { timeout: 1800000,
    env: { ...env, PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c lock_timeout=5000 -c statement_timeout=1500000',
      RESTORE_DUMP: file, EXPECTED_DATABASE: env.PGDATABASE, TARGET_DB: '', LIVE_DB: '',
      EXPECTED_TOC_ENTRIES: '', RESTORE_ASSERT_DB: '1', DUMP_DATABASE: 'radar', RESTORE_KEEP_OWNER: '1' } });
  // Replay only original ACLs. Candidate service grants cannot run on schema 13.
  const aclList = path.join(r.output(), 'rollback-acl.list');
  const toc = run('pg_restore', ['--list', file]);
  fs.writeFileSync(aclList, toc.split('\n').filter(line => /^\d+;.*\s(?:DEFAULT )?ACL\s/.test(line)).join('\n') + '\n', { mode: 0o600 });
  run('pg_restore', ['--no-owner', '--exit-on-error', '--single-transaction',
    '--use-list', aclList, `--dbname=${env.PGDATABASE}`, file], { timeout: 60000 });
  if (r.prefix(r.rows()) !== 13) fail('rollback_schema_mismatch');
  const result = { ok: true, sha256: b.sha256, run: proof.run, destination: r.identity(), durationMs: Date.now() - begin,
    images: 'Rollback release + MCP/CronJobs par k8s, routes encore fermées' };
  save('rollback', result);
  return result;
}
module.exports = { checkedArchive, backup, restoreTest, rollback };
