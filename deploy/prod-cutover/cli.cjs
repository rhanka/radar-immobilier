/* global require, module, process, fetch, AbortSignal */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
const backup = require('./backup.cjs');
const migrations = require('./migrate.cjs');
async function smoke() {
  const base = r.env.ENV === 'prod' ? 'https://immo.sent-tech.ca' : r.env.SMOKE_URL;
  if (!base || (r.env.ENV !== 'prod' && !/^(http:\/\/(127\.0\.0\.1|localhost):\d+|https:\/\/recette\.localhost:15321)$/.test(base)))
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
    case 'authorize': r.destination(); r.approvedPlan(); r.pinnedImage(); result = { ok: true }; break;
    case 'configuration-check': {
      r.destination(); r.mutationGuard();
      const manifest = r.json(r.env.CONFIGURATION || r.fail('configuration_required'));
      const items = manifest.kind === 'List' ? manifest.items : [manifest];
      if (!Array.isArray(items) || !items.length || items.some(x =>
        x.kind !== 'ConfigMap' || x.metadata?.namespace !== 'radar-immobilier'
        || !['radar-api', 'immo-mcp-config', 'radar-mcp-receiver', 'radar-cutover-6h'].includes(x.metadata.name))) r.fail('configuration_scope_mismatch');
      if (new Set(items.map(x => x.metadata.name)).size !== items.length) r.fail('configuration_duplicate');
      const plan = items.find(x => x.metadata.name === 'radar-cutover-6h');
      if (!plan || r.crypto.createHash('sha256').update(plan.data?.['plan.json'] || '').digest('hex')
        !== r.approvedPlan().planSha256) r.fail('configuration_plan_mismatch');
      result = { ok: true }; break;
    }
    case 'reopen-authorize': {
      r.destination(); r.mutationGuard();
      const a = r.json(r.env.APPROVAL);
      if (a.reopen !== true || a.run !== r.env.CUTOVER_LOCK_RUN) r.fail('reopen_go_required');
      result = { ok: true }; break;
    }
    case 'rollback-verify':
      r.destination(); r.mutationGuard();
      if (r.prefix(r.rows()) !== 13 || r.receipt('rollback').run !== r.env.CUTOVER_LOCK_RUN
        || !r.sameIdentity(r.receipt('rollback').destination, r.identity())
        || r.receipt('rollback').sha256 !== r.receipt('backup').sha256)
        r.fail('rollback_receipt_required');
      result = { ok: true }; break;
    case 'backup': result = backup.backup(); break;
    case 'restore-test': result = backup.restoreTest(); break;
    case 'migrate': result = migrations.migrate(); break;
    case 'transition': result = migrations.hook('transition'); break;
    case 'verify': {
      const startedVerify = Date.now();
      const query = r.env.ENV === 'rehearsal' && r.env.PGPORT === '25433' ? require('./local-query.cjs').read : r.sql;
      r.destination(query);
      if (r.prefix(r.rows(query)) !== 44) r.fail('44_migrations_required');
      const t = r.receipt('transition');
      if (t.sha !== r.SHA || t.status !== 'open-success') r.fail('transition_receipt_required');
      if (!r.sameIdentity(t.destination, r.identity(query))) r.fail('transition_database_mismatch');
      const { plan, planSha256, rosterSha256 } = r.approvedPlan();
      if (t.planSha256 !== planSha256 || t.rosterSha256 !== rosterSha256) r.fail('transition_plan_mismatch');
      const literal = s => `'${String(s).replaceAll("'", "''")}'`;
      const state = query(`BEGIN READ ONLY; SELECT count(*) FROM facet_activation_state s
        JOIN workspaces w ON w.id=s.workspace_id WHERE w.slug=${literal(plan.workspaceSlug)}
        AND s.writer_epoch='scoped' AND NOT s.maintenance_barrier; COMMIT;`);
      if (state !== '1') r.fail('scoped_workspace_not_open');
      for (const account of plan.accounts) {
        const active = query(`BEGIN READ ONLY; SELECT count(*) FROM account_users a
          JOIN workspace_memberships m ON m.account_id=a.id JOIN workspaces w ON w.id=m.workspace_id
          JOIN facet_stream_attachments f ON f.account_id=a.id AND f.workspace_id=w.id
          WHERE a.sub=${literal(account.sub)} AND a.status='approved' AND w.slug=${literal(plan.workspaceSlug)}
          AND m.status='active' AND m.revoked_at IS NULL AND f.status='attached'
          AND m.moderate_archive=${account.moderateArchive === true} AND m.manage_members=${account.manageMembers === true}; COMMIT;`);
        if (active !== '1') r.fail('account_membership_mismatch');
      }
      result = { ok: true, migrations: 44, epoch: 'scoped', maintenanceBarrier: false,
        accounts: plan.accounts.length, durationMs: Date.now() - startedVerify };
      break;
    }
    case 'rollback': result = backup.rollback(); break;
    case 'smoke': result = await smoke(); break;
    case 'rehearsal':
      if (r.env.ENV !== 'rehearsal') r.fail('rehearsal_environment_required');
      result = { restore: backup.restoreTest(), migrations: migrations.migrate(),
        transition: migrations.hook('transition') };
      await main('verify');
      result.rollback = backup.rollback();
      result.rollbackRepeat = backup.rollback();
      r.save('rehearsal', result);
      break;
    default: r.fail('unknown_operation');
  }
  if (['verify', 'smoke'].includes(operation) && r.env.OUTPUT) r.save(operation, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (require.main === module) main().catch(error => {
  // Messages outside this allowlist can contain SQL values or response bodies.
  const code = /^[a-z0-9_]+$/.test(error.message) ? error.message : 'operation_failed';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
module.exports = { main, smoke };
