#!/usr/bin/env node
// Chaperon Immobilier triage reprise (reference set C, 21/09 state) into the
// PREPROD personal signal facets of the workspace `agence-chaperon-immobilier`.
//
//   node scripts/chaperon-reprise.mjs --refc-dir <private-dir> [--owner-account <uuid>]... [--fresh-xlsx <file>]
//        [--key-only] [--receipt <file outside the repo>] [--apply --confirm agence-chaperon-immobilier]
//
// <private-dir> comes from `node scripts/reference-seal.mjs unseal ... --out <private-dir>`.
// Default: READ-ONLY dry run inside radar-api (plan piped on stdin, nothing written).
// `--apply`: insert-only write through the governed in-image writer
// `api/dist/scripts/chaperon-reprise-apply.js`, then readback per account.
// Without `--owner-account`, the single member of the client's email domain is used.
// Reports carry counts, row numbers and identifiers, never sheet text.
/* global console */
import process from 'node:process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, basename, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SOURCE, PROFILE, MAPPING_VERSION, buildPlan, diffFresh, readSheet } from './chaperon-reprise-plan.mjs';
import { podDryRun } from './chaperon-reprise-pod.mjs';

const NAMESPACE = 'radar-immobilier-preprod';
const DEFAULT_KUBECONFIG = join(homedir(), '.kube', 'radar-preprod-tenant.kubeconfig');
const WORKSPACE_SLUG = 'agence-chaperon-immobilier';
const OWNER_EMAIL_DOMAIN = 'chaperonimmobilier.com';
// Fixed namespace of the deterministic (UUIDv5) command keys of this reprise.
const KEY_NAMESPACE = '6c1f3a52-8f0e-5b7d-9a41-2e6d0c9b7f13';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function kubectl(kubeconfig, args, input) {
  const result = spawnSync('kubectl', ['--kubeconfig', kubeconfig, '-n', NAMESPACE, ...args],
    { input, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (result.status !== 0) throw new Error(`kubectl failed: ${(result.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
  return result.stdout;
}
const lastJson = (text) => JSON.parse(text.trim().split('\n').pop());
const values = (argv, flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const arg = (argv, flag) => values(argv, flag).pop();

async function main(argv) {
  const refcDir = arg(argv, '--refc-dir');
  if (!refcDir) throw new Error('usage: --refc-dir <private-dir> [--owner-account <uuid>]... [--apply --confirm <slug>]');
  const kubeconfig = arg(argv, '--kubeconfig') ?? DEFAULT_KUBECONFIG;
  if (!/preprod/.test(basename(kubeconfig))) throw new Error('refused: only the preprod tenant kubeconfig is allowed');
  const owners = values(argv, '--owner-account');
  if (owners.some((id) => !UUID.test(id)) || new Set(owners).size !== owners.length) throw new Error('invalid --owner-account');
  const receipt = arg(argv, '--receipt');
  if (receipt && resolve(receipt).startsWith(`${REPO_ROOT}/`)) throw new Error('refused: the receipt must live outside the repository');

  const csvBytes = readFileSync(join(refcDir, 'reference-c.csv'));
  const csvSha = createHash('sha256').update(csvBytes).digest('hex');
  if (csvSha !== SOURCE.referenceCsvSha256) throw new Error(`reference-c.csv sha256 ${csvSha} differs from the sealed reference`);
  const built = buildPlan(csvBytes.toString('utf8'));
  const report = { source: { ...SOURCE, rows: built.rows, columns: built.columns, planIssues: built.issues }, mapping: MAPPING_VERSION };
  const fresh = arg(argv, '--fresh-xlsx');
  if (fresh) {
    if (!existsSync(fresh)) throw new Error('fresh export not found');
    report.freshDiff = diffFresh(csvBytes.toString('utf8'), readSheet(fresh, 'Triage'));
  }
  const keyOnly = argv.includes('--key-only');
  const PLAN = { workspaceSlug: WORKSPACE_SLUG, ownerEmailDomain: OWNER_EMAIL_DOMAIN, ownerAccountIds: owners,
    profile: PROFILE, keyOnly, targets: built.targets };
  const program = `const PLAN = ${JSON.stringify(PLAN)};\n(${podDryRun.toString()})(PLAN)`
    + '.catch((e) => { console.error(e.message); process.exit(1); });\n';
  const dry = lastJson(kubectl(kubeconfig, ['exec', '-i', 'deploy/radar-api', '--', 'node', '--input-type=module', '-'], program));
  report.release = kubectl(kubeconfig, ['exec', 'deploy/radar-api', '--', 'cat', 'api/release-sha']).trim();
  report.dryRun = { ...dry, targets: undefined };

  if (argv.includes('--apply')) {
    if (keyOnly) throw new Error('--key-only is a dry-run measurement');
    if (arg(argv, '--confirm') !== WORKSPACE_SLUG) throw new Error(`--apply requires --confirm ${WORKSPACE_SLUG}`);
    if (!dry.writable) throw new Error('refused: workspace, accounts or reason codes not writable (see dryRun)');
    if (dry.match.ambiguous.length || dry.match.notFound.length) throw new Error('refused: unresolved targets');
    kubectl(kubeconfig, ['exec', 'deploy/radar-api', '--', 'test', '-f', 'api/dist/scripts/chaperon-reprise-apply.js']);
    const payload = JSON.stringify({ workspaceSlug: WORKSPACE_SLUG, ownerAccountIds: dry.accounts.map((a) => a.accountId),
      keyNamespace: KEY_NAMESPACE, manifestSha: csvSha, mapping: MAPPING_VERSION,
      targets: dry.targets.map(({ row, citySlug, type, id, verdict, reasonCode }) => ({ row, citySlug, type, id, verdict, reasonCode })) });
    report.apply = lastJson(kubectl(kubeconfig, ['exec', '-i', 'deploy/radar-api', '--', 'node',
      'api/dist/scripts/chaperon-reprise-apply.js', '--apply', '--confirm', WORKSPACE_SLUG], payload));
  }
  if (receipt) {
    // Hashes and counts only: no row, no identifier, no sheet text.
    writeFileSync(receipt, `${JSON.stringify({ label: SOURCE.label, manifestSha: csvSha, mapping: MAPPING_VERSION,
      keyNamespace: KEY_NAMESPACE, release: report.release, workspace: dry.workspace,
      accounts: dry.accounts.map((a) => ({ accountId: a.accountId, plan: { insert: a.plan.insert, noop: a.plan.noop,
        skipExisting: a.plan.skipExisting.length }, counts: a.counts })),
      apply: report.apply ? { accounts: report.apply.accounts.map((a) => ({ accountId: a.accountId, applied: a.applied,
        readback: { ...a.readback, mismatchedRows: a.readback.mismatchedRows.length } })) } : null,
      at: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  if (argv.includes('--json')) report.targets = dry.targets;
  console.log(JSON.stringify(report, null, 2));
  if (report.apply?.accounts.some((a) => a.readback.mismatchedRows.length)) process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => { console.error(`chaperon-reprise: ${error.message}`); process.exit(1); });
}
