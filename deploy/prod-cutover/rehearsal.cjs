/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
const config = require('./rehearsal-config.cjs');
const privateDir = r.path.join(r.env.HOME, '.local/share/radar-prod-copy');
const file = name => r.path.join(privateDir, name);
const write = (name, value) => r.fs.writeFileSync(file(name), value, { mode: 0o600, flag: 'wx' });
const compose = (...args) => r.run('docker', ['compose', '--env-file', '/dev/null', '-p', 'radar-prod-copy-owner',
  '-f', r.path.join(r.ROOT, 'deploy/prod-cutover/rehearsal.compose.yml'), '-f', file('services.json'), ...args], { timeout: 120000 });
function prepare() {
  if (r.run('docker', ['ps', '-q', '--filter', 'label=com.docker.compose.project=radar-prod-copy-owner']).trim())
    r.fail('prepare_before_local_stack_required');
  const proof = require('./preparation-proof.json');
  const planFile = file('plan.json'); const rosterFile = file('roster.json');
  if (r.hash(r.safeFile(planFile)) !== proof.roster.planSha256 || r.hash(r.safeFile(rosterFile)) !== proof.roster.sha256
    || r.hash(r.safeFile(file(proof.archive.file))) !== proof.archive.sha256) r.fail('preparation_fingerprint_mismatch');
  if (!r.env.OWNER?.trim()) r.fail('rehearsal_attestation_owner_required');
  if (r.fs.existsSync(file('approval.json'))) {
    const previous = r.json(file('approval.json'));
    if (previous.environment !== 'rehearsal' || previous.productionAuthorized !== false) r.fail('local_attestation_only');
  }
  const approvalBytes = JSON.stringify({
    environment: 'rehearsal', productionAuthorized: false, owner: r.env.OWNER, sha: r.SHA,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    planSha256: proof.roster.planSha256, rosterSha256: proof.roster.sha256,
  }, null, 2) + '\n';
  r.fs.writeFileSync(file('approval.json.partial'), approvalBytes, { mode: 0o600 });
  r.fs.renameSync(file('approval.json.partial'), file('approval.json'));
  r.approvedPlan();
  const output = file(`rehearsal-${r.crypto.randomUUID()}`);
  r.fs.writeFileSync(file('active-copy.json'), JSON.stringify({ output }), { mode: 0o600 });
  if (!r.fs.existsSync(file('auth.json'))) {
    const secret = () => r.crypto.randomBytes(36).toString('hex');
    write('auth.json', JSON.stringify({ database: r.fs.readFileSync(r.safeFile(file('local-password')), 'utf8').trim(),
      login: secret(), client: secret(), session: secret(), account: secret(), artifact: secret(),
      workload: secret(), cursor: r.crypto.randomBytes(48).toString('base64'), upload: secret(),
      grant: secret(), reader: secret(), storage: secret() }));
  }
  const tls = r.fs.existsSync(file('tls.key')) ? ['-key', file('tls.key')]
    : ['-newkey', 'rsa:2048', '-nodes', '-keyout', file('tls.key')];
  r.run('openssl', ['req', '-x509', ...tls, '-out', file('ca.crt'), '-days', '2', '-subj', '/CN=radar-rehearsal',
    '-addext', 'subjectAltName=DNS:recette.localhost,DNS:pages.localhost,DNS:*.pages.localhost,DNS:localhost,DNS:minio.localhost']);
  if (!r.fs.existsSync(file('idp.key'))) {
    r.run('openssl', ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', file('idp.key')]);
    r.run('openssl', ['pkey', '-in', file('idp.key'), '-pubout', '-out', file('idp.pub')]);
  }
  for (const [name, bytes] of Object.entries({ 'services.json': JSON.stringify(config.compose(privateDir, r.json(file('auth.json'))), null, 2),
    'nginx.conf': config.nginx() })) {
    r.fs.writeFileSync(file(`${name}.partial`), bytes, { mode: 0o600 });
    r.fs.renameSync(file(`${name}.partial`), file(name));
  }
  compose('config', '--quiet');
  return { ok: true, environment: 'rehearsal', productionAuthorized: false, credentialsPrinted: false };
}
async function main() {
  if (r.env.ENV !== 'rehearsal') r.fail('local_rehearsal_only');
  let result = { ok: true };
  switch (process.argv[2]) {
    case 'prepare': result = prepare(); break;
    case 'evidence': result = require('./local-proof.cjs').observe(); break;
    case 'services-up': {
      const started = Date.now();
      const query = require('./local-query.cjs').read;
      r.destination(query); r.approvedPlan();
      if (r.prefix(r.rows(query)) !== 44 || r.receipt('transition').status !== 'open-success') r.fail('transition_required');
      const auth = r.json(file('auth.json'));
      r.fs.writeFileSync(file('services.json.partial'), JSON.stringify(config.compose(privateDir, auth), null, 2), { mode: 0o600 });
      r.fs.renameSync(file('services.json.partial'), file('services.json'));
      r.fs.writeFileSync(file('nginx.conf'), config.nginx(), { mode: 0o600 });
      compose('config', '--quiet');
      // These roles already have the candidate grants. Passwords are local and carry no new privilege.
      r.sql(`ALTER ROLE immo_mcp_account_reader LOGIN PASSWORD '${auth.account}';
        ALTER ROLE immo_mcp_artifact_writer LOGIN PASSWORD '${auth.artifact}';`);
      compose('up', '-d', '--wait', '--wait-timeout', '60', '--no-build', '--pull', 'never', 'minio', 'idp', 'api', 'mcp', 'ui');
      compose('exec', '-T', 'ui', 'nginx', '-s', 'reload');
      compose('run', '--rm', '--no-deps', '-T', '-v', `${privateDir}:/private-input:ro`,
        '-v', `${r.ROOT}/deploy/prod-cutover/rehearsal-storage.cjs:/run-storage.cjs:ro`,
        '--entrypoint', 'node', 'api', '/run-storage.cjs');
      result = { ok: true, durationMs: Date.now() - started };
      r.save('services', result);
      break;
    }
    case 'services-stop': compose('stop', '--timeout', '30', 'ui', 'api', 'mcp', 'idp', 'minio');
      result = require('./local-proof.cjs').observe(); break;
    case 'config-check': compose('config', '--quiet'); break;
    case 'read-check': {
      const read = require('./local-query.cjs').read;
      if (read("SELECT current_setting('transaction_read_only');") !== 'on') r.fail('copy_reader_not_read_only');
      let refused = false;
      try { read('UPDATE drizzle.__drizzle_migrations SET id=id WHERE false;'); } catch { refused = true; }
      if (!refused) r.fail('copy_reader_write_allowed');
      result = { ok: true, readOnly: true, emptyUpdateRefused: true }; break;
    }
    case 'timings': {
      result = {};
      const times = r.path.join(r.output(), 'migration-times.jsonl');
      if (r.fs.existsSync(times)) result.committed = r.fs.readFileSync(times, 'utf8').trim().split('\n')
        .filter(Boolean).map(line => { const { tag, durationMs } = JSON.parse(line); return { tag, durationMs }; });
      const current = r.path.join(r.output(), 'migration-current.json');
      if (r.fs.existsSync(current)) { const { tag, at } = r.json(current); result.current = { tag, at }; }
      const transitions = r.path.join(r.output(), 'transition-times.jsonl');
      if (r.fs.existsSync(transitions)) result.transitions = r.fs.readFileSync(transitions, 'utf8').trim().split('\n').map(JSON.parse);
      for (const name of ['restore', 'migrations', 'transition', 'verify', 'services', 'smoke', 'rollback', 'rollback-first', 'rollback-second']) {
        const path = r.path.join(r.output(), `${name}.json`);
        if (!r.fs.existsSync(path)) continue;
        const receipt = r.json(path);
        result[name] = { durationMs: receipt.durationMs, migrations: receipt.migrations,
          applied: receipt.applied?.map(({ tag, durationMs }) => ({ tag, durationMs })) };
      }
      break;
    }
    case 'export-timings': {
      result = { run: r.receipt('local-run').run, forward: r.receipt('forward-first'),
        transitions: r.fs.readFileSync(r.path.join(r.output(), 'transition-times.jsonl'), 'utf8').trim().split('\n').slice(0, 2).map(JSON.parse),
        rollbacks: ['rollback-first', 'rollback-second'].map(name => {
          const receipt = r.receipt(name); return { ok: receipt.ok, durationMs: receipt.durationMs };
        }) };
      result.candidate = {};
      for (const name of ['migrations', 'transition', 'verify', 'services', 'smoke']) {
        const receipt = r.receipt(name);
        result.candidate[name] = { durationMs: receipt.durationMs, walBytes: receipt.walBytes,
          applied: receipt.applied?.map(({ tag, durationMs }) => ({ tag, durationMs })) };
      }
      result.candidate.transitions = r.fs.readFileSync(r.path.join(r.output(), 'transition-times.jsonl'), 'utf8').trim().split('\n').slice(-2).map(JSON.parse);
      for (const name of r.fs.readdirSync(privateDir).filter(name => /^rehearsal-[a-f0-9-]{36}$/.test(name))) {
        if (!r.env.COMPARE_REHEARSAL_RUN) break;
        const run = r.path.join(privateDir, name, 'local-run.json');
        if (!r.fs.existsSync(run) || r.json(run).run !== r.env.COMPARE_REHEARSAL_RUN) continue;
        const prior = r.json(r.path.join(privateDir, name, 'migrations.json'));
        result.prior = { run: r.env.COMPARE_REHEARSAL_RUN, durationMs: prior.durationMs,
          walBytes: prior.walBytes, applied: prior.applied.map(({ tag, durationMs }) => ({ tag, durationMs })) };
      }
      break;
    }
    case 'rollback-audit': {
      const query = require('./local-query.cjs').read;
      const receipt = r.receipt('rollback');
      const physical = JSON.parse(query(`SELECT json_build_object('system',
        (SELECT system_identifier::text FROM pg_control_system()),'oid',
        (SELECT oid::text FROM pg_database WHERE datname=current_database()));`));
      if (receipt.destination.system !== physical.system || receipt.destination.oid !== physical.oid
        || receipt.destination.database !== 'radar_cutover_owner_20261113' || receipt.sha256 !== r.hash(r.safeFile(r.env.ARCHIVE)))
        r.fail('rollback_receipt_required');
      if (r.prefix(JSON.parse(query("SELECT json_agg(json_build_object('hash',hash,'created_at',created_at)) FROM drizzle.__drizzle_migrations;"))) !== 13)
        r.fail('rollback_schema_mismatch');
      const toc = r.run('bash', ['-c', 'exec docker exec -i radar-prod-copy-owner-postgres-1 pg_restore --list < "$ARCHIVE"']);
      const expected = toc.split('\n').map(line => line.match(/^\d+; \d+ \d+ TABLE (\S+) (\S+) (\S+)$/)).filter(Boolean);
      const owners = JSON.parse(query(`SELECT json_object_agg(n.nspname||'.'||c.relname,pg_get_userbyid(c.relowner))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p');`));
      if (!expected.length || expected.some(([, schema, name, owner]) => owners[`${schema}.${name}`] !== owner))
        r.fail('rollback_table_owner_mismatch');
      if (query("SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public';") !== 'pg_database_owner')
        r.fail('rollback_public_owner_mismatch');
      const legacy = query('BEGIN READ ONLY; SET LOCAL ROLE radar; SELECT count(*) FROM drizzle.__drizzle_migrations; COMMIT;');
      const writer = query("SELECT has_table_privilege('immo_mcp_artifact_writer','drizzle.__drizzle_migrations','SELECT');");
      if (legacy !== '13' || writer !== 'f') r.fail('rollback_legacy_access_mismatch');
      result = { ok: true, migrations: 13, archiveTables: expected.length, archiveTableOwnersMatch: true,
        publicOwner: 'pg_database_owner', legacyRole: 'radar', legacyRead: true,
        candidateWriterRead: false, originalAclReplay: 'pg_restore_exit_0' };
      r.save('rollback-audit', result); break;
    }
    case 'rollback-twice': {
      // Keep the same physical copy and RUN. Preserve both receipts before any replay.
      const forward = {};
      for (const name of ['restore', 'migrations', 'transition', 'verify', 'services', 'smoke']) {
        const receipt = r.receipt(name);
        forward[name] = { durationMs: receipt.durationMs, walBytes: receipt.walBytes,
          applied: receipt.applied?.map(({ tag, durationMs }) => ({ tag, durationMs })) };
      }
      r.save('forward-first', forward);
      compose('stop', '--timeout', '30', 'ui', 'api', 'mcp', 'idp', 'minio');
      require('./local-proof.cjs').observe();
      const first = require('./backup.cjs').rollback(); r.save('rollback-first', first);
      const second = require('./backup.cjs').rollback(); r.save('rollback-second', second);
      result = { first: { ok: first.ok, durationMs: first.durationMs },
        second: { ok: second.ok, durationMs: second.durationMs } };
      break;
    }
    case 'smoke':
      result = JSON.parse(compose('exec', '-T', '-e', 'ENV=rehearsal', '-e', `SMOKE_URL=${config.base}`,
        'api', 'node', '/run-controller/cli.cjs', 'smoke'));
      r.save('smoke', result); break;
    default: r.fail('unknown_local_operation');
  }
  process.stdout.write(JSON.stringify(result) + '\n');
}
main().catch(error => { process.stderr.write((/^[a-z0-9_]+$/.test(error.message) ? error.message : 'local_rehearsal_failed') + '\n'); process.exitCode = 1; });
