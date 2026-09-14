import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

let html = await readFile('dist/index.html', 'utf8');
const script = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/)?.[0];
const css = html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/)?.[0];
if (!script || !css) throw Error('Expected one bundled JS and CSS asset');
const asset = tag => `dist/${tag.match(/(?:src|href)="([^"]+)"/)[1].replace(/^\.\//, '')}`;
html = html.replace(script, () => '<script type="module"></script>');
const code = (await readFile(asset(script), 'utf8')).replaceAll('</script', '<\\/script');
html = html.replace('<script type="module"></script>', () => `<script type="module">${code}</script>`);
html = html.replace(css, () => '<style></style>');
const style = (await readFile(asset(css), 'utf8')).replaceAll('</style', '<\\/style');
html = html.replace('<style></style>', () => `<style>${style}</style>`);
const shell = html.replace(/<script type="module">[\s\S]*?<\/script>/gi, '').replace(/<style>[\s\S]*?<\/style>/gi, '');
if (/<(?:script|link|img)\b[^>]+(?:src|href)=/i.test(shell)) throw Error('External asset remains');

await writeFile('../decision-focus.html', html);
const monthlyDir = '../../reports/architecture-monthly';
await writeFile(`${monthlyDir}/architecture-before-after-2026-09-13.html`, html);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hashFile = async file => sha256(await readFile(file));
const { manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const tokenAudit = JSON.parse(await readFile(`${monthlyDir}/token-audit-2026-08-10_2026-09-13.json`, 'utf8'));
const sourceFiles = await Promise.all([
  ['docs/architecture.md', '../../architecture.md', 'canonical-five-scene-source'],
  ['docs/architecture/transitions-target.md', '../transitions-target.md', 'effective-transition-and-after-targets'],
  ['docs/architecture/proposal.md', '../proposal.md', 'T1-causal-detail'],
  ['docs/architecture/transitions.md', '../transitions.md', 'transition-register'],
  ['docs/architecture/decision-dossier.md', '../decision-dossier.md', 'D8-dossier'],
  ['docs/reports/rapport-mois-2026-08-10_2026-09-13.md', '../../reports/rapport-mois-2026-08-10_2026-09-13.md', 'monthly-activity-report'],
  ['docs/reports/couts-2026-08-10_2026-09-13.md', '../../reports/couts-2026-08-10_2026-09-13.md', 'separate-cost-report'],
  ['docs/reports/architecture-monthly/token-audit-2026-08-10_2026-09-13.json', `${monthlyDir}/token-audit-2026-08-10_2026-09-13.json`, 'token-audit'],
  ['docs/reports/rapport-mois-2026-07-13_2026-08-09.pdf', '../../reports/rapport-mois-2026-07-13_2026-08-09.pdf', 'preceding-report-exact-copy'],
].map(async ([path, local, role]) => ({ path, role, sha256: await hashFile(local) })));
const evidence = {
  schema: 'immo-architecture-monthly-evidence/v6', revision: 'D9', generatedAt: new Date().toISOString(),
  period: { timezone: 'America/Toronto', startInclusive: '2026-08-10T00:00:00-04:00', endExclusive: '2026-09-14T00:00:00-04:00', days: 35, hours: 840,
    inclusiveLabel: '10 août → 13 septembre 2026',
    joinEvidence: 'preceding report is located at historical revision 72b966664523801ea00cfcb704e0285ee765c136 without claiming main ancestry', externalInvoiceIdentityVerified: true,
    tokenCaptureCutoff: tokenAudit.generatedAt, september13TokensAfterCutoffIncluded: true },
  transitionState: {
    refresh: { graphify: '0.18.0', llmMesh: '0.19.1', cronUtc: '05:17', preproduction: 'accepted',
      production: 'dormant-pending-PR-682-promotion', selectedProductionModel: null },
    hosting: { july: 'Scaleway-only before OVH decision', august10: 'approximately 90 percent migrated to OVH with MinIO retained',
      september13: 'OVH preproduction and production without MinIO' },
    t2: { rawParityAndOvhRebind: true, minioRemovedFrom: ['preproduction', 'production'], mergedPullRequests: [683, 685],
      copyJob: { name: 'radar-object-storage-copy-docs-prod-vz8kd', objects: 59017, bytes: 12534514457, copied: 0, failed: 0, sha256Anchors: 4 },
      workloadsOnOvhS3: ['api', 'graph', 'scrape'], scwRadarException: 'TEM' },
    cluster: { r2_15: { created: true, allocatableMiB: 12785, cpuPercent: 70, memoryPercent: 53 },
      kedaRemoved: true, b3_8Drained: 3, consolidationComplete: true },
    scwTem: 'retained until replacement validated',
  },
  focus: { html: 'architecture-before-after-2026-09-13.html', htmlSha256: sha256(html),
    artifactInputHash: manifest.artifactInputHash, architectureHash: manifest.architectureHash,
    transitionTargetsHash: manifest.transitionTargetsHash, dossierHash: manifest.dossierHash,
    presentationHash: manifest.presentationHash, choicesHash: manifest.choicesHash,
    nativeNestedSvelteFlow: true, renderedMermaidCount: manifest.graphs.length,
    graphOrder: manifest.graphOrder, canonicalScenes: manifest.graphs,
    serviceIconsAndRepoProvenance: 'required for every node and group' },
  billing: { paidCadToDate: 0, invoices: [{ id: 'QC281819', amountCad: 0 }, { id: 'QC285954', amountCad: 0 }],
    trialCredit: { initialCad: 270, consumedCad: 179.23, expiredCad: 90.77, expiredOn: '2026-08-12' },
    septemberUnbilledEstimateCad: 71.62, firstRealDebitExpectedAround: '2026-10-01',
    payableBasis: { quantity: 1, sku: 'r2-15', monthlyCad: 58.58, excludes: 'three b3-8 operator-error overcost' },
    llmAllocation: { immoCad: 142.48476964674762, geoCad: 112.23163135257916, totalCad: 254.71640099932677,
      method: 'provisional, non-critical and non-final allocation; not an invoice' } },
  claims: { deployment: 'MinIO removed from preproduction and production; refresh preproduction accepted; refresh production dormant pending PR 682 promotion', invoice: 'paid to date: CAD 0.00',
    decisionOptions: 'M1 has exactly three candidates; no winner; Gemini no-output is not classifiable and is not a result', llmRatification: 'provisional-non-critical-non-final' },
  previousReport: { path: 'docs/reports/rapport-mois-2026-07-13_2026-08-09.pdf', historicalRevision: '72b966664523801ea00cfcb704e0285ee765c136',
    sourceSha256: '86ae37810016bca61cc897105121cfcbcd1951426fc889616ae1efe37ae29528', sourcePages: 9,
    attachmentName: 'rapport-mois-2026-07-13_2026-08-09.pdf', ancestryClaim: 'none' },
  sourceFiles,
  replay: 'make -f docs/architecture/focus/Makefile test build audit browser clipboard report-check PORT=5200 ENV=test-architecture-two-transitions',
};
await writeFile(`${monthlyDir}/evidence-manifest-2026-09-13.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Portable D9 Focus: ${Buffer.byteLength(html)} bytes; ${sha256(html)}`);
