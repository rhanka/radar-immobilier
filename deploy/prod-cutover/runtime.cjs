/* global require, module, process, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */
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
  const containerRun = env.RUN || (['psql', 'pg_dump', 'pg_restore'].includes(bin)
    && env.EVIDENCE ? json(env.EVIDENCE).run : '');
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 60000,
    maxBuffer: 32 * 1024 * 1024, ...options,
    env: { ...env, PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c lock_timeout=5000 -c statement_timeout=300000',
      ...options.env, CUTOVER_CONTAINER_RUN: containerRun } });
  // Never relay SQL, stderr, connection strings or row values on failure.
  if (result.error || result.status !== 0) {
    if (env.ENV === 'rehearsal' && bin === 'pg_restore') {
      // Report only fixed error categories. Never SQL, row data or connection strings.
      for (const [pattern, code] of [[/schema "topology" already exists/, 'restore_topology_schema_exists'],
        [/schema "public" already exists/, 'restore_public_schema_exists'],
        [/schema "[a-zA-Z0-9_]+" already exists/, 'restore_preloaded_schema_exists'],
        [/role "[a-zA-Z0-9_]+" does not exist/, 'restore_role_missing'],
        [/unrecognized configuration parameter/, 'restore_client_server_version_mismatch']])
        if (pattern.test(result.stderr || '')) fail(code);
    }
    fail(`command_failed_${bin.replace(/[^a-z0-9]/gi, '_')}`);
  }
  return result.stdout;
}
function sql(query, options = {}) {
  return run('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '--file=-'], { input: query, ...options }).trim();
}
function destination(query = sql) {
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
  if (query('SELECT current_database();') !== env.PGDATABASE) fail('database_identity_mismatch');
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
function identity(query = sql) {
  return { host: env.PGHOST, port: Number(env.PGPORT || 5432), database: env.PGDATABASE,
    system: query('SELECT system_identifier FROM pg_control_system();'),
    oid: query('SELECT oid FROM pg_database WHERE datname=current_database();') };
}
function sameIdentity(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function approvedPlan() {
  const planFile = safeFile(env.PLAN || fail('approved_6h_plan_required'));
  const rosterFile = safeFile(env.ROSTER || fail('approved_6h_roster_required'));
  const planBytes = fs.readFileSync(planFile);
  const rosterBytes = fs.readFileSync(rosterFile);
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const binding = { planSha256: digest(planBytes), rosterSha256: digest(rosterBytes) };
  const a = json(env.APPROVAL || fail('owner_approval_required'));
  if (!a.owner || a.sha !== SHA || !Number.isFinite(Date.parse(a.expiresAt))
    || Date.parse(a.expiresAt) <= Date.now()
    || a.planSha256 !== binding.planSha256 || a.rosterSha256 !== binding.rosterSha256)
    fail('approved_6h_content_mismatch');
  const plan = JSON.parse(planBytes.toString('utf8'));
  if (JSON.stringify(plan.accounts) !== JSON.stringify(JSON.parse(rosterBytes.toString('utf8')))) fail('roster_plan_mismatch');
  return { plan, ...binding };
}
function mutationGuard() {
  const runId = env.RUN || (env.EVIDENCE ? json(env.EVIDENCE).run : null);
  if (runId) require('./containers.cjs').guard(runId);
  if (env.ENV !== 'execution-prod') return;
  const kube = path.join(env.HOME, '.kube/radar-prod-tenant-admin.kubeconfig');
  const lock = JSON.parse(run('kubectl', ['--kubeconfig', kube, '--request-timeout=15s',
    '-n', 'radar-immobilier', 'get', 'configmap', 'radar-change-lock', '-o', 'json']));
  lockOwnership(JSON.parse(lock.data.record));
}
function lockOwnership(record) {
  if (!env.CUTOVER_LOCK_RUN || !env.CUTOVER_LOCK_EXECUTOR || record.kind !== 'cutover'
    || record.manualV1220 !== true || record.run !== env.CUTOVER_LOCK_RUN
    || JSON.stringify(record.executor) !== JSON.stringify(JSON.parse(env.CUTOVER_LOCK_EXECUTOR))
    || record.executor.state !== 'running') fail('change_lock_ownership_required');
}
function prefix(rows, entries = journal()) {
  if (rows.length < 13 || rows.length > 44 || new Set(rows.map(r => r.hash)).size !== rows.length)
    fail('migration_count_or_duplicates');
  // Historical rows were inserted out of journal order. Match exact hash/time pairs.
  for (const e of entries.slice(0, rows.length)) {
    if (!rows.some(r => r.hash === e.hash && String(r.created_at) === String(e.when))) fail('migration_prefix_mismatch');
  }
  return rows.length;
}
function rows(query = sql) {
  return JSON.parse(query("SELECT coalesce(json_agg(json_build_object('hash',hash,'created_at',created_at)), '[]'::json) FROM drizzle.__drizzle_migrations;"));
}
function evidence() {
  const e = json(env.EVIDENCE || fail('drain_evidence_required'));
  const age = Date.now() - Date.parse(e.completedAt);
  if (e.release !== SHA || !/^[0-9a-f-]{36}$/.test(e.run) || !Array.isArray(e.instances)
    || !e.instances.length || e.instances.some(i => typeof i !== 'string' || !i)
    || !Number.isFinite(age) || age < 0 || age > 86400000) fail('drain_evidence_invalid');
  if (env.ENV === 'rehearsal') require('./local-proof.cjs').verify(e);
  if (env.ENV === 'execution-prod') {
    const approval = json(env.APPROVAL);
    if (JSON.stringify(approval.drain) !== JSON.stringify(e) || approval.writersStopped !== true
      || e.run !== env.CUTOVER_LOCK_RUN) fail('operator_drain_attestation_required');
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
  destination, output, save, receipt, journal, prefix, rows, evidence, pinnedImage, identity, sameIdentity, safeFile,
  approvedPlan, mutationGuard, lockOwnership };
