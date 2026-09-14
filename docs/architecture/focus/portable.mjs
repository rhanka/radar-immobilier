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
  ['docs/architecture.md', '../../architecture.md', 'canonical-four-scene-source'],
  ['docs/architecture/transitions-target.md', '../transitions-target.md', 'effective-transition-and-after-targets'],
  ['docs/architecture/proposal.md', '../proposal.md', 'T1-causal-detail'],
  ['docs/architecture/transitions.md', '../transitions.md', 'transition-register'],
  ['docs/architecture/decision-dossier.md', '../decision-dossier.md', 'D8-dossier'],
  ['docs/reports/architecture-monthly/report-through-2026-09-13.md', `${monthlyDir}/report-through-2026-09-13.md`, 'monthly-report'],
  ['docs/reports/architecture-monthly/token-audit-2026-08-10_2026-09-13.json', `${monthlyDir}/token-audit-2026-08-10_2026-09-13.json`, 'token-audit'],
  ['docs/spec/reports/study-2026-08/report.pdf', '../../spec/reports/study-2026-08/report.pdf', 'preceding-report-exact-attachment'],
].map(async ([path, local, role]) => ({ path, role, sha256: await hashFile(local) })));
const evidence = {
  schema: 'immo-architecture-monthly-evidence/v6', revision: 'D9', generatedAt: new Date().toISOString(),
  period: { timezone: 'America/Toronto', startInclusive: '2026-08-10T00:00:00-04:00', endExclusive: '2026-09-14T00:00:00-04:00', days: 35, hours: 840,
    inclusiveLabel: '10 août → 13 septembre 2026',
    joinEvidence: 'preceding report is located at historical revision 72b966664523801ea00cfcb704e0285ee765c136 without claiming main ancestry', externalInvoiceIdentityVerified: false,
    tokenCaptureCutoff: tokenAudit.generatedAt, september13TokensAfterCutoffIncluded: false },
  transitionState: {
    refresh: { graphify: '0.18.0', preproduction: 'accepted with Luna high trial', production: 'dormant-pending-promotion', selectedProductionModel: null,
      m1: 'awaiting matched three-candidate benchmark and owner ratification' },
    t2: { rawParityAndOvhRebind: true, docsHistoricalPreprodMinio: { objects: 144193, gigabytes: 28.34 }, docsProductionScwReference: { bucket: 'docs-pocs', objects: 59017, bytes: 12534514457 },
      ownerDecision: 'production source is exact initial canonical set; OVH prod and preprod converge to same 59,017 keys+hashes; preprod surplus not migrated',
      implementationCommit: { branch: 'chore/scw-final-sweep', head: '2ccabfc8', onOriginMain: false },
      preproduction: { status: 'accepted', objects: 59017, bytes: 12534514457, canonicalManifestSha256: '52646a7b…0425', failed: 0,
        docsOvhActive: true, removed: ['MinIO StatefulSet', 'MinIO Pod', 'MinIO Service', '40 Gi data PVC', 'six MinIO NetworkPolicies'],
        retained: ['migration/checkpoint PVC'], quotaBefore: { pvcs: 4, storageGi: 47 }, quotaAfter: { pvcs: 3, storageGi: 7 }, workloadsReady: { api: '1/1', mcp: '1/1', ui: '1/1' } },
      production: { status: 'runtime-cutover-observed', accepted: false, open: ['destination attribute parity', 'final source rescan', 'global legacy dependency sweep'] } },
    t3: { status: 'gated', verdict: 'await production T2 and post-cleanup capacity proof' }, scwTem: 'retained until replacement validated',
  },
  focus: { html: 'architecture-before-after-2026-09-13.html', htmlSha256: sha256(html),
    artifactInputHash: manifest.artifactInputHash, architectureHash: manifest.architectureHash,
    transitionTargetsHash: manifest.transitionTargetsHash, dossierHash: manifest.dossierHash,
    presentationHash: manifest.presentationHash, choicesHash: manifest.choicesHash,
    nativeNestedSvelteFlow: true, renderedMermaidCount: manifest.graphs.length,
    graphOrder: manifest.graphOrder, canonicalScenes: manifest.graphs,
    serviceIconsAndRepoProvenance: 'required for every node and group' },
  billing: { infrastructureProjection: { quantity: 1, sku: 'b3-8', hourlyRateCad: 0.082, hours: 840, amountCad: 68.88,
      excluded: 'observed two/three-node platform pass-through/internal costs' },
    llmAllocation: { immoCad: 139.33773242975033, geoCad: 111.87770524666708, totalCad: 251.21543767641742,
      method: 'previous-report subscription capacity allocation and unit basis; refreshed deduplicated local sessions' },
    indicativeTotalCad: 320.0954376764174 },
  claims: { deployment: 'storage runtime cutover observed with final parity/sweep open; refresh preproduction accepted; refresh production dormant pending promotion', invoice: 'none',
    decisionOptions: 'M1 has exactly three candidates; no winner; Gemini no-output is not classifiable and is not a result', llmRatification: 'provisional-non-critical-non-final' },
  previousReport: { path: 'docs/spec/reports/study-2026-08/report.pdf', historicalRevision: '72b966664523801ea00cfcb704e0285ee765c136',
    sourceSha256: '86ae37810016bca61cc897105121cfcbcd1951426fc889616ae1efe37ae29528', sourcePages: 9,
    attachmentName: 'study-2026-08-report.pdf', ancestryClaim: 'none' },
  sourceFiles,
  replay: 'make -f docs/architecture/focus/Makefile test build audit browser clipboard report-check PORT=5200 ENV=test-architecture-two-transitions',
};
await writeFile(`${monthlyDir}/evidence-manifest-2026-09-13.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Portable D9 Focus: ${Buffer.byteLength(html)} bytes; ${sha256(html)}`);
