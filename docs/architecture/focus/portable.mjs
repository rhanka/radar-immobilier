import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
let html = await readFile('dist/index.html', 'utf8');
const script = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/)?.[0];
const css = html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/)?.[0];
if (!script || !css) throw Error('Expected one bundled JS and CSS asset');
const asset = tag => `dist/${tag.match(/(?:src|href)="([^"]+)"/)[1].replace(/^\.\//, '')}`;
html = html.replace(script, () => `<script type="module">${''}</script>`);
const code = (await readFile(asset(script), 'utf8')).replaceAll('</script', '<\\/script');
html = html.replace('<script type="module"></script>', () => `<script type="module">${code}</script>`);
html = html.replace(css, () => `<style>${''}</style>`);
const style = (await readFile(asset(css), 'utf8')).replaceAll('</style', '<\\/style');
html = html.replace('<style></style>', () => `<style>${style}</style>`);
const shell = html.replace(/<script type="module">[\s\S]*?<\/script>/gi, '').replace(/<style>[\s\S]*?<\/style>/gi, '');
if (/<(?:script|link|img)\b[^>]+(?:src|href)=/i.test(shell)) throw Error('External asset remains');
await writeFile('../decision-focus.html', html);
const monthlyDir = '../../reports/architecture-monthly';
const monthlyHtml = `${monthlyDir}/architecture-transition-2026-09-13.html`;
await writeFile(monthlyHtml, html);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const { manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const sourceFiles = await Promise.all([
  ['docs/architecture.md', '../../architecture.md', 'current-state'],
  ['docs/architecture/proposal.md', '../proposal.md', 'target-nondeployed'],
  ['docs/architecture/transitions.md', '../transitions.md', 'post-period-register'],
  ['docs/architecture/decision-dossier.md', '../decision-dossier.md', 'D4'],
  ['docs/reports/architecture-monthly/2026-08-12_2026-09-10-companion.md', `${monthlyDir}/2026-08-12_2026-09-10-companion.md`, 'monthly-companion'],
].map(async ([path, local, role]) => ({ path, role, sha256: sha256(await readFile(local)) })));
const evidence = {
  schema: 'immo-architecture-monthly-evidence/v1',
  period: { timezone: 'America/Toronto', from: '2026-08-12T00:00:00-04:00', to: '2026-09-10T23:59:59-04:00' },
  snapshotAt: '2026-09-13', transitionRelation: 'post-period', monetaryProposalAudit: 'incomplete',
  deploymentClaim: 'none; the target view is explicitly nondeployed',
  focus: { html: 'architecture-transition-2026-09-13.html', htmlSha256: sha256(html),
    artifactInputHash: manifest.artifactInputHash, architectureHash: manifest.architectureHash,
    dossierHash: manifest.dossierHash, presentationHash: manifest.presentationHash,
    choicesHash: manifest.choicesHash, referenceFocusNodeHash: manifest.referenceFocusNodeHash,
    nativeFocusRouterHash: manifest.nativeFocusRouterHash },
  verifiedCostBoundaries: { b3_8Bhs5HourlyCad: 0.082, projectedHours: 720,
    oneNodeProjectionCad: 59.04, historicalLlmCapacityAllocationCad: 214.743159,
    extraNodePassThrough: false, nonNodeAndProductAllocation: 'audit-incomplete' },
  sourceFiles,
  externalReadOnlyEvidence: [
    { path: '.lanes/conductor/docs/reports/rapport-mois-2026-08-12_2026-09-10.md', sha256: '9feec9b82cabba0df368ab8c8d3d33a4b887756beab2ca595b8920c16ac3ea14' },
    { path: '.lanes/conductor/docs/reports/couts-2026-08-12_2026-09-10.md', sha256: '05be0279be73eea7c9ae788b04dcbcd647c23e1b1f0f2de096efcff3a33f171d' },
    { path: '.lanes/conductor/.remote/month-evidence/billing-RUN2_202608.json', sha256: 'de951460b768ac448e223419db5cae0f8c13669aeaf7754514a5a6039835f744' },
    { path: '.lanes/conductor/.remote/month-evidence/billing-RUN2_202609.json', sha256: '545d4e0b3e353a0d0555d35b0d58f85e15d1c394b92682259b199612e3e5c3f9' },
    { path: '.lanes/conductor/.remote/month-evidence/claude-dedup-audit.json', sha256: '276dcc4ba1e4d359ac30afd7fd002271b179ae25990123b85b2580cc004d56fd' },
    { path: '.lanes/conductor/.remote/month-evidence/codex-exact-dedup-audit.json', sha256: 'e79adfbd9bc55cebf1159fce2144d893712d6c2857b4e3d97fdd739039d00701' },
    { path: '.lanes/conductor/.remote/month-evidence/token-audit-scope.txt', sha256: '6b2159c666531d123fe01b66b68c65a68d1d51c0226728e7160f2b34ac73af47' },
  ],
  replay: 'make -f docs/architecture/focus/Makefile test build browser clipboard ENV=test-architecture',
  portability: 'Requires the read-only Sentropic decision kit path configured by KIT_ROOT; it is not vendored.'
};
await writeFile(`${monthlyDir}/evidence-manifest-2026-09-13.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Portable native Focus dossier: ${Buffer.byteLength(html)} bytes; monthly evidence ${sha256(html)}`);
