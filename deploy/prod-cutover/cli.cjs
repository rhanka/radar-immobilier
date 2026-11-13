const r = require('./runtime.cjs');
const backup = require('./backup.cjs');
const migrations = require('./migrate.cjs');
async function smoke() {
  const base = r.env.ENV === 'prod' ? 'https://immo.sent-tech.ca' : r.env.SMOKE_URL;
  if (!base || (r.env.ENV !== 'prod' && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)))
    r.fail('explicit_local_smoke_url_required');
  const started = Date.now();
  for (const [url, status, check] of [
    ['/', 200, async res => (res.headers.get('content-type') || '').startsWith('text/html')],
    ['/build.json', 200, async res => (await res.json()).sha === r.SHA.slice(0, 7)],
    ['/health', 200, async res => { const x = await res.json(); return x.sha === r.SHA && x.db?.ok && x.objectStore?.ok; }],
    ['/api/v1/workspaces', 401, async () => true],
    ['/mcp', 401, async res => /^Bearer /i.test(res.headers.get('www-authenticate') || '')],
    ['/.well-known/oauth-protected-resource/mcp', 200, async res => (await res.json()).resource === `${base}/mcp`],
  ]) {
    const res = await fetch(`${base}${url}`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (res.status !== status || !await check(res)) r.fail('smoke_failed');
  }
  return { ok: true, sha: r.SHA, durationMs: Date.now() - started,
    functional: 'Recette authentifiée Période/Pertinence/URL/écartés/refresh requise. Voir runbook.' };
}
async function main(operation = process.argv[2]) {
  let result;
  switch (operation) {
    case 'backup': result = backup.backup(); break;
    case 'restore-test': result = backup.restoreTest(); break;
    case 'migrate': result = migrations.migrate(); break;
    case 'transition': result = migrations.hook('transition'); break;
    case 'verify': {
      r.destination();
      if (r.prefix(r.rows()) !== 44) r.fail('44_migrations_required');
      const t = r.receipt('transition');
      if (t.sha !== r.SHA || t.status !== 'open-success') r.fail('transition_receipt_required');
      // Re-enter the idempotent hook: it verifies current rights, attachments and epoch.
      result = migrations.hook('transition');
      break;
    }
    case 'rollback': result = backup.rollback(); break;
    case 'smoke': result = await smoke(); break;
    case 'rehearsal':
      if (r.env.ENV !== 'rehearsal') r.fail('rehearsal_environment_required');
      result = { restore: backup.restoreTest(), migrations: migrations.migrate(),
        transition: migrations.hook('transition'), smoke: await smoke() };
      r.save('rehearsal', result);
      break;
    default: r.fail('unknown_operation');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (require.main === module) main().catch(error => {
  // Messages outside this allowlist can contain SQL values or response bodies.
  const code = /^[a-z0-9_]+$/.test(error.message) ? error.message : 'operation_failed';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
module.exports = { main, smoke };
