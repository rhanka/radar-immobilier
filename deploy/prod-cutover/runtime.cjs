const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const SHA = 'b7724bdd9015a4f26319897bf240baaf9ee636ae';
const ROOT = path.resolve(__dirname, '../..');
const fail = code => { throw new Error(code); };
function safeFile(file) {
  if (typeof file !== 'string' || /(^|\/)\.env[^/]*(\/|$)/.test(file)
    || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()
    || /(^|\/)\.env[^/]*(\/|$)/.test(fs.realpathSync(file))) fail('unsafe_input_path');
  return file;
}
const json = file => JSON.parse(fs.readFileSync(safeFile(file), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const env = process.env;
process.umask(0o077);
function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000,
    maxBuffer: 32 * 1024 * 1024, env: { ...env, PGCONNECT_TIMEOUT: '5',
      PGOPTIONS: '-c lock_timeout=5000 -c statement_timeout=300000' }, ...options });
  // Never relay SQL, stderr, connection strings or row values on failure.
  if (result.error || result.status !== 0) fail(`command_failed_${bin.replace(/[^a-z0-9]/gi, '_')}`);
  return result.stdout;
}
function sql(query, options = {}) {
  return run('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '--file=-'], { input: query, ...options }).trim();
}
function destination() {
  if (!env.PGHOST || !env.PGUSER || !env.PGDATABASE || !/^\d+$/.test(env.PGPORT || '5432')) fail('explicit_database_required');
  if (env.PGSERVICE || env.PGSERVICEFILE) fail('implicit_service_forbidden');
  if (env.ENV === 'prod') fail('production_read_only_lane');
  if (env.ENV === 'execution-prod') {
    if (env.CUTOVER_ALLOW_PROD !== SHA || !env.APPROVAL) fail('owner_approval_required');
    const a = json(env.APPROVAL);
    if (a.sha !== SHA || !a.owner || Date.parse(a.expiresAt) <= Date.now()
      || !Number.isFinite(Date.parse(a.expiresAt)) || a.database !== env.PGDATABASE
      || a.host !== env.PGHOST || a.port !== Number(env.PGPORT || 5432)) fail('approval_mismatch');
  } else if (!(env.ENV === 'rehearsal' || /^test-/.test(env.ENV || ''))
    || !['127.0.0.1', 'localhost', '::1'].includes(env.PGHOST)
    || !/^radar_cutover_[a-z0-9_]+$/.test(env.PGDATABASE)) fail('disposable_local_database_required');
  if (sql('SELECT current_database();') !== env.PGDATABASE) fail('database_identity_mismatch');
}
function output() {
  if (!env.OUTPUT || !path.isAbsolute(env.OUTPUT)) fail('absolute_output_required');
  fs.mkdirSync(env.OUTPUT, { recursive: true, mode: 0o700 });
  return env.OUTPUT;
}
function save(name, value) {
  const file = path.join(output(), `${name}.json`);
  fs.writeFileSync(`${file}.partial`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.partial`, file);
}
function receipt(name) { return json(path.join(output(), `${name}.json`)); }
function journal() {
  const candidate = run('git', ['show', `${SHA}:api/drizzle/meta/_journal.json`]);
  if (candidate !== fs.readFileSync(path.join(ROOT, 'api/drizzle/meta/_journal.json'), 'utf8'))
    fail('candidate_journal_changed');
  const entries = json(path.join(ROOT, 'api/drizzle/meta/_journal.json')).entries;
  if (entries.length !== 44) fail('candidate_journal_changed');
  return entries.map(e => ({ ...e, file: path.join(ROOT, `api/drizzle/${e.tag}.sql`),
    hash: hash(path.join(ROOT, `api/drizzle/${e.tag}.sql`)) })).map(e => {
      const original = run('git', ['show', `${SHA}:api/drizzle/${e.tag}.sql`]);
      if (crypto.createHash('sha256').update(original).digest('hex') !== e.hash)
        fail('candidate_sql_changed');
      return e;
    });
}
function identity() {
  return { host: env.PGHOST, port: Number(env.PGPORT || 5432), database: env.PGDATABASE,
    system: sql('SELECT system_identifier FROM pg_control_system();'),
    oid: sql('SELECT oid FROM pg_database WHERE datname=current_database();') };
}
function sameIdentity(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function prefix(rows, entries = journal()) {
  if (rows.length < 13 || rows.length > 44 || new Set(rows.map(r => r.hash)).size !== rows.length)
    fail('migration_count_or_duplicates');
  // Historical rows were inserted out of journal order. Match exact hash/time pairs.
  for (const e of entries.slice(0, rows.length)) {
    if (!rows.some(r => r.hash === e.hash && String(r.created_at) === String(e.when))) fail('migration_prefix_mismatch');
  }
  return rows.length;
}
function rows() {
  return JSON.parse(sql("SELECT coalesce(json_agg(json_build_object('hash',hash,'created_at',created_at)), '[]'::json) FROM drizzle.__drizzle_migrations;"));
}
function evidence() {
  const e = json(env.EVIDENCE || fail('drain_evidence_required'));
  const age = Date.now() - Date.parse(e.completedAt);
  if (e.release !== SHA || !/^[0-9a-f-]{36}$/.test(e.run) || !Array.isArray(e.instances)
    || !e.instances.length || e.instances.some(i => typeof i !== 'string' || !i)
    || !Number.isFinite(age) || age < 0 || age > 86400000) fail('drain_evidence_invalid');
  if (env.ENV === 'execution-prod') {
    const approval = json(env.APPROVAL);
    if (JSON.stringify(approval.drain) !== JSON.stringify(e) || approval.writersStopped !== true
      || approval.lockFree !== true) fail('operator_drain_attestation_required');
  }
  return e;
}
function pinnedImage() {
  const r = json(env.RELEASE || fail('release_manifest_required'));
  if (r.gitSha !== SHA || r.dataMigration !== '6h'
    || !/^ghcr\.io\/rhanka\/radar-api@sha256:[a-f0-9]{64}$/.test(r.apiImage)
    || !/^ghcr\.io\/rhanka\/radar-ui@sha256:[a-f0-9]{64}$/.test(r.uiImage)
    || r.apiServedSha !== SHA || r.uiServedSha !== SHA.slice(0, 7)) fail('release_manifest_mismatch');
  const pinned = json(path.join(__dirname, 'release.json'));
  if (JSON.stringify(r) !== JSON.stringify(pinned)) fail('candidate_images_mismatch');
  return r.apiImage;
}
module.exports = { fs, path, crypto, SHA, ROOT, env, fail, json, hash, run, sql,
  destination, output, save, receipt, journal, prefix, rows, evidence, pinnedImage, identity, sameIdentity, safeFile };
