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
await writeFile(`${monthlyDir}/architecture-transition-2026-09-13.html`, html);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hashFile = async file => sha256(await readFile(file));
const { manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const tokenAudit = JSON.parse(await readFile(`${monthlyDir}/token-audit-2026-08-10_2026-09-13.json`, 'utf8'));
const sourceFiles = await Promise.all([
  ['docs/architecture.md', '../../architecture.md', 'before-state'],
  ['docs/architecture/transitions-target.md', '../transitions-target.md', 'effective-transition-and-after-targets'],
  ['docs/architecture/proposal.md', '../proposal.md', 'T1-causal-detail'],
  ['docs/architecture/transitions.md', '../transitions.md', 'transition-register'],
  ['docs/architecture/decision-dossier.md', '../decision-dossier.md', 'D6-dossier'],
  ['docs/reports/architecture-monthly/report-through-2026-09-13.md', `${monthlyDir}/report-through-2026-09-13.md`, 'monthly-report'],
  ['docs/reports/architecture-monthly/token-audit-2026-08-10_2026-09-13.json', `${monthlyDir}/token-audit-2026-08-10_2026-09-13.json`, 'token-audit'],
  ['docs/reports/couts-2026-07-13_2026-08-09.md', '../../reports/couts-2026-07-13_2026-08-09.md', 'preceding-merged-report'],
].map(async ([path, local, role]) => ({ path, role, sha256: await hashFile(local) })));
const evidence = {
  schema: 'immo-architecture-monthly-evidence/v3', revision: 'D6', generatedAt: new Date().toISOString(),
  period: { timezone: 'America/Toronto', startInclusive: '2026-08-10T00:00:00-04:00', endExclusive: '2026-09-14T00:00:00-04:00', days: 35, hours: 840,
    joinEvidence: 'last cost report merged on origin/main ends 2026-08-09', externalInvoiceIdentityVerified: false,
    tokenCaptureCutoff: tokenAudit.generatedAt, september13TokensAfterCutoffIncluded: false },
  transitionState: {
    t1: { graphify: '0.18.0', model: 'Luna high', firstKubernetesRun: 'failed before LLM because input was .html, PDF required', accepted: false },
    t2: { rawParityAndOvhRebind: true, docsPreprod: { objects: 144193, gigabytes: 28.34 }, docsProductionScwReference: { bucket: 'docs-pocs', objects: 59017, bytes: 12534514457 },
      ownerDecision: 'production source is exact initial canonical set; OVH prod and preprod converge to same 59,017 keys+hashes; preprod surplus not migrated',
      toolingCommit: { branch: 'chore/scw-final-sweep', head: 'be362561', onOriginMain: false },
      docsCopyParityRebind: false, productionMigration: 'launched; completed outcome unknown', minioRemoval: 'only after exact parity and recoverability' },
    t3: { status: 'not-started', verdict: 'NO-GO today' }, scwTem: 'retained until replacement validated',
  },
  focus: { html: 'architecture-transition-2026-09-13.html', htmlSha256: sha256(html),
    artifactInputHash: manifest.artifactInputHash, architectureHash: manifest.architectureHash,
    transitionTargetsHash: manifest.transitionTargetsHash, dossierHash: manifest.dossierHash,
    presentationHash: manifest.presentationHash, choicesHash: manifest.choicesHash,
    nativeNestedSvelteFlow: true, renderedMermaidCount: manifest.graphs.length,
    serviceIconsAndRepoProvenance: 'required for every node and group' },
  billing: { infrastructureProjection: { quantity: 1, sku: 'b3-8', hourlyRateCad: 0.082, hours: 840, amountCad: 68.88,
      excluded: 'observed two/three-node platform pass-through/internal costs' },
    llmAllocation: { immoCad: 139.33773242975033, geoCad: 111.87770524666708, totalCad: 251.21543767641742,
      method: 'previous-report subscription capacity allocation and unit basis; refreshed deduplicated local sessions' },
    indicativeTotalCad: 320.0954376764174 },
  claims: { deployment: 'partial effective transition only; after targets not deployed', invoice: 'none', decisionOptions: 'none; owner DOCS canonical-set instruction is fixed' },
  sourceFiles,
  replay: 'make -f docs/architecture/focus/Makefile tokens test build browser clipboard ENV=test-architecture',
};
await writeFile(`${monthlyDir}/evidence-manifest-2026-09-13.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Portable D6 Focus: ${Buffer.byteLength(html)} bytes; ${sha256(html)}`);
