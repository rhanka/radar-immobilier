import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { marked } from 'marked';

const reportBase = '../../reports/rapport-mois-2026-08-10_2026-09-13';
const markdown = await readFile(`${reportBase}.md`, 'utf8');
const focusHtml = await readFile('../decision-focus.html', 'utf8');
const { graphs } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');

// A4 geometry in CSS pixels at 96 dpi; the body and the annex are both portrait,
// and an annex page uses the same inclusion mechanism as the body figure: the
// whole scene fitted to the page width, never cut into strips (owner, v11).
const MM = 96 / 25.4;
const A4 = { short: 210 * MM, long: 297 * MM };
const ANNEX = { margin: 10 * MM, header: 54, comment: 168 };
const ANNEX_BOX = { width: A4.short - 2 * ANNEX.margin, height: A4.long - 2 * ANNEX.margin };
// The frame carries the 1 px rule, so the image itself is never clipped by it.
const ANNEX_IMAGE = { width: ANNEX_BOX.width - 2, height: ANNEX_BOX.height - ANNEX.header - ANNEX.comment - 2 };
const REPORT_BOX = { width: A4.short - 2 * 12 * MM, height: A4.long - 2 * 14 * MM };
const SMALLEST_TYPE_PX = 22; // the code line of the single A' card
// Card geometry contract, mirrored from scenes.js so the print path refuses a
// silent drift between the layout and what is measured in the page.
const CARD_BOX = { A: { width: 460, height: 200 } };
const CARD_TYPE = { code: 22, title: 32, name: 24, detail: 24, repo: 24 };
// Capture surface. Chromium composites a 16000x8800 surface in tiles and drops
// some of them, so the surface stays just larger than the widest scene.
const CANVAS = { width: 5700, height: 2400 };
// Two inline target scenes in the body: the hosting target in section 6 and the
// pipeline target in section 5, each under half a portrait page.
const INLINE_SCENES = [
  { id: 'hosting-today-20260913', section: 6, anchor: null, part: 'A' },
  { id: 'pipeline-after-20260913', section: 5, anchor: '<strong>Après</strong>', part: 'B' }];
const ANNEX_LABEL = { 'hosting-july-2026': 'A1', 'hosting-august-20260810': 'A2',
  'hosting-today-20260913': 'A3', 'pipeline-before-20260810': 'B1', 'pipeline-after-20260913': 'B2' };
const ANNEX_PART = { A: 'Annexe A · hébergement', B: 'Annexe B · pipeline' };
const SCENE_CAPTION = { 'hosting-july-2026': 'Hébergement · juillet 2026 · Scaleway',
  'hosting-august-20260810': 'Hébergement · 10 août 2026 · OVH, MinIO encore présent',
  'hosting-today-20260913': 'Hébergement · 13 septembre 2026 · OVH, sans MinIO',
  'pipeline-before-20260810': 'Pipeline PV → Signaux · avant intégration',
  'pipeline-after-20260913': 'Pipeline PV → Signaux · après intégration' };
// Transition commentary, in the spirit of the codex-13-sept decision dossier:
// under each scene, how the state above was reached, in dated facts already
// carried by the report body.
const SCENE_TRANSITION = {
  'hosting-july-2026': { title: 'Point de départ — juillet 2026',
    text: 'Tout tourne chez Scaleway, en Scaleway pur, avant la décision de migrer. Il n’existe qu’un seul '
      + 'environnement : ce qui est déployé est directement ce que voit l’utilisateur, sans étape intermédiaire '
      + 'pour voir une livraison avant elle. Les documents sont conservés par un service de stockage interne au '
      + 'cluster, adossé à un disque. C’est une plateforme qui fonctionne, mais sans filet — et c’est cet état '
      + 'que les deux transitions suivantes corrigent.' },
  'hosting-august-20260810': { title: 'De A1 à A2 — juillet → 10 août 2026 : changer d’hébergeur, pas encore de stockage',
    text: 'Le changement est un déménagement d’hébergeur : la migration de Scaleway vers OVH est faite à environ '
      + '90 % — estimation datée fournie par l’owner, pas une mesure. Le but de cette étape est de basculer le coût '
      + 'et l’exécution chez le nouveau fournisseur ; la façon de stocker les documents n’est pas encore touchée, '
      + 'donc le stockage interne au cluster est conservé tel quel, et le registre d’images d’origine reste utilisé. '
      + 'Il n’y a toujours qu’un seul environnement : la double dépendance n’est pas encore levée.' },
  'hosting-today-20260913': { title: 'De A2 à A3 — 10 août → 13 septembre 2026 : préproduction, stockage du fournisseur, une seule machine',
    text: 'Trois changements, dans cet ordre. Une préproduction complète est ajoutée à côté de la production, sur le '
      + 'même cluster : une livraison est désormais visible et validable avant d’atteindre l’utilisateur. Le stockage '
      + 'interne au cluster est retiré en deux temps (#683, #685) au profit du stockage objet du fournisseur ; la copie '
      + 'est prouvée par son journal d’exécution — 59 017 objets, 12 534 514 457 octets, aucun échec. Enfin la plateforme '
      + 'est consolidée sur une seule machine <code>r2-15</code> au lieu de trois. L’envoi d’e-mails transactionnels demeure la '
      + 'seule exception restée chez Scaleway.' },
  'pipeline-before-20260810': { title: 'Point de départ — la chaîne avant intégration',
    text: 'Les quatre étapes existent déjà, mais elles ne sont pas au même endroit. La collecte et la lecture tournent '
      + 'dans le cluster ; l’extraction s’exécute sur le poste de l’opérateur, avec ses propres clés d’accès aux modèles '
      + 'de langage ; la projection est déclenchée à la main. Rien ne peut donc partir seul : chaque rafraîchissement '
      + 'demande une personne devant son écran, et la partie la plus coûteuse du traitement vit hors de l’infrastructure.' },
  'pipeline-after-20260913': { title: 'De B1 à B2 — les quatre étapes au même endroit, sous une seule tâche planifiée',
    text: 'Les quatre étapes s’exécutent maintenant dans le cluster, sous une tâche planifiée unique '
      + '(<code>radar-refresh-pv</code>, 05:17 UTC) : plus d’étape sur le poste de l’opérateur, plus de déclenchement manuel. '
      + 'L’extracteur est consommé comme une bibliothèque au lieu d’un outil externe, l’accès aux modèles de langage se '
      + 'fait à l’intérieur du même processus, et les clés sont conservées chiffrées côté serveur ; le poste de '
      + 'l’opérateur ne sert plus qu’à l’enrôlement initial des accès. L’ensemble est accepté en préproduction ; la '
      + 'production est représentée à part, dormante, tant que la PR #682 n’est pas promue.' } };

const renderer = new marked.Renderer();
renderer.html = () => '';
let body = marked.parse(markdown, { renderer });
for (const match of [...body.matchAll(/<img([^>]+)src="([^":]+)"([^>]*)>/g)]) {
  const file = resolve(dirname(reportBase), match[2]);
  const encoded = (await readFile(file)).toString('base64');
  body = body.replace(match[0], `<img${match[1]}src="data:image/png;base64,${encoded}"${match[3]}>`);
}

const base = 'http://127.0.0.1:9238';
const page = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  const item = pending.get(data.id);
  if (item) {
    pending.delete(data.id);
    data.error ? item.reject(data.error) : item.resolve(data.result);
  }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const waitFor = async expression => {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    try { if (await evaluate(expression)) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw Error(`Timed out: ${expression}`);
};

await mkdir('.generated', { recursive: true });
await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', { width: CANVAS.width, height: CANVAS.height, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: `data:text/html;base64,${Buffer.from(focusHtml).toString('base64')}` });
await waitFor(`document.querySelectorAll('.flow').length === ${graphs.length} && document.querySelectorAll('[data-node-kind]').length === ${graphs.reduce((sum, graph) => sum + graph.nodes.length + graph.groups.length, 0)}`);

// v11: no cut at all. The annex prints the whole scene on one portrait page,
// fitted to the page width exactly as the body figure is — the owner accepted a
// scale below 1 rather than a diagram sliced into strips. The fit is recomputed
// from the rendered image later in this script, so what is written in the page
// header is a measurement, not this prediction.
const annexFit = (width, height) => Math.min(ANNEX_IMAGE.width / width, ANNEX_IMAGE.height / height);

const captures = [];
for (const graph of graphs) {
  const measure = () => evaluate(`(async () => {
    const sceneId = ${JSON.stringify(graph.id)};
    document.querySelector('.dossier').style.cssText = 'max-width:none;width:${CANVAS.width}px;padding:0;margin:0';
    document.querySelectorAll('.pair').forEach(pair => { pair.style.cssText = 'display:block;border:0;padding:0;margin:0'; });
    document.querySelectorAll('.pair-grid').forEach(grid => { grid.style.cssText = 'display:block'; });
    document.querySelectorAll('.scene').forEach(scene => { scene.style.display = scene.dataset.scene === sceneId ? 'block' : 'none'; });
    const scene = document.querySelector('[data-scene="' + sceneId + '"]');
    scene.style.cssText += ';width:${CANVAS.width}px;padding:0;margin:0;border:0';
    [...scene.children].forEach(child => { if (!child.classList.contains('flow')) child.style.display = 'none'; });
    const flow = scene.querySelector('.flow');
    flow.style.cssText = 'width:${CANVAS.width}px;height:${CANVAS.height}px;overflow:visible;background:#eef4f5';
    window.scrollTo(0, 0);
    await new Promise(resolve => setTimeout(resolve, 500));
    flow.querySelector('[data-action="actual-size"]').click();
    await new Promise(resolve => setTimeout(resolve, 500));
    flow.querySelector('[data-action="actual-size"]').click();
    await new Promise(resolve => setTimeout(resolve, 400));
    const transform = getComputedStyle(flow.querySelector('.svelte-flow__viewport')).transform;
    const scale = Number((transform.match(/^matrix\\(([^,]+)/) || [])[1] || 1);
    const elements = [...flow.querySelectorAll('[data-node-kind], g[data-canonical-edge] path, [data-text-role="edge-label"]')];
    const boxes = elements.map(element => element.getBoundingClientRect()).filter(box => box.width > 0 || box.height > 0);
    const flowBox = flow.getBoundingClientRect(), pad = 40;
    const left = Math.max(flowBox.left, Math.min(...boxes.map(box => box.left)) - pad);
    const top = Math.max(flowBox.top, Math.min(...boxes.map(box => box.top)) - pad);
    const right = Math.min(flowBox.right, Math.max(...boxes.map(box => box.right)) + pad);
    const bottom = Math.min(flowBox.bottom, Math.max(...boxes.map(box => box.bottom)) + pad);
    const truncated = [];
    const readText = (node, role) => {
      const element = node.querySelector('[data-text-role="' + role + '"]');
      if (!element) return null;
      if (element.scrollWidth > element.clientWidth + 1) truncated.push(node.dataset.id + '/' + role);
      return parseFloat(getComputedStyle(element).fontSize) * scale;
    };
    const ordinary = [...flow.querySelectorAll('[data-node-kind="ordinary"]')].map(node => {
      const style = getComputedStyle(node), box = node.getBoundingClientRect();
      const lines = ['code', 'service-title', 'name', 'detail', 'repo']
        .map(role => [role, readText(node, role)]).filter(([, px]) => px !== null);
      const icon = node.querySelector('[data-service-icon]').getBoundingClientRect();
      const code = node.querySelector('[data-text-role="code"]').getBoundingClientRect();
      const title = node.querySelector('[data-text-role="service-title"]').getBoundingClientRect();
      return { id: node.dataset.id, template: node.dataset.card, width: box.width, height: box.height,
        iconPx: icon.height / scale, twoLinePx: (title.bottom - code.top) / scale,
        hasStatus: !!node.querySelector('[data-text-role="status"]'),
        paddingTop: parseFloat(style.paddingTop), paddingRight: parseFloat(style.paddingRight),
        paddingBottom: parseFloat(style.paddingBottom), paddingLeft: parseFloat(style.paddingLeft),
        typePx: Object.fromEntries(lines), lineCount: node.querySelectorAll('[data-text-role]').length,
        contentOverflow: node.scrollHeight > node.clientHeight + 1 };
    });
    const clusters = [...flow.querySelectorAll('[data-node-kind="cluster"]')].map(node => ({
      id: node.dataset.id, titlePx: readText(node, 'subflow-title'),
      hasStatus: !!node.querySelector('[data-text-role="status"]'), repoPx: readText(node, 'repo') }));
    const edgeLabels = [...flow.querySelectorAll('[data-text-role="edge-label"]')].map(label => parseFloat(getComputedStyle(label).fontSize) * scale);
    return { clip: { x: left + scrollX, y: top + scrollY, width: Math.ceil(right - left), height: Math.ceil(bottom - top) },
      scale, visualViewportScale: visualViewport.scale, devicePixelRatio, ordinary, clusters, edgeLabels, truncated,
      nodes: flow.querySelectorAll('[data-node-kind="ordinary"]').length,
      groups: flow.querySelectorAll('[data-node-kind="cluster"]').length,
      edges: flow.querySelectorAll('g[data-canonical-edge]').length };
  })()`);
  let metrics = await measure();
  for (let attempt = 0; attempt < 3 && metrics.scale !== 1; attempt++) metrics = await measure();
  if (metrics.scale !== 1 || metrics.visualViewportScale !== 1 || metrics.devicePixelRatio !== 1) throw Error(`${graph.id}: non-native capture scale`);
  if (metrics.clip.width > CANVAS.width || metrics.clip.height > CANVAS.height) throw Error(`${graph.id}: capture ${metrics.clip.width}x${metrics.clip.height} exceeds the ${CANVAS.width}x${CANVAS.height} surface`);
  if (metrics.nodes !== graph.nodes.length || metrics.groups !== graph.groups.length || metrics.edges !== graph.edges.length) throw Error(`${graph.id}: incomplete native capture inventory`);
  if (metrics.truncated.length) throw Error(`${graph.id}: ellipsised card text ${metrics.truncated.join(', ')}`);
  for (const card of metrics.ordinary) {
    const box = CARD_BOX[card.template];
    if (!box) throw Error(`${graph.id}/${card.id}: unknown card template ${card.template}`);
    if (Math.abs(card.width - box.width) > .01 || Math.abs(card.height - box.height) > .01)
      throw Error(`${graph.id}/${card.id}: card ${card.width}x${card.height} differs from template ${card.template}`);
    if (card.lineCount !== 5)
      throw Error(`${graph.id}/${card.id}: template ${card.template} has ${card.lineCount} text lines`);
    if (card.hasStatus) throw Error(`${graph.id}/${card.id}: a status line is still rendered`);
    if (Math.abs(card.iconPx - card.twoLinePx) > 1)
      throw Error(`${graph.id}/${card.id}: icon ${card.iconPx}px is not the height of the two first lines ${card.twoLinePx}px`);
    if ([card.paddingTop, card.paddingRight, card.paddingBottom, card.paddingLeft].some(value => Math.abs(value - 8) > .01)) throw Error(`${graph.id}/${card.id}: padding differs from 8px`);
    for (const [role, px] of Object.entries(card.typePx)) {
      const expected = CARD_TYPE[role === 'service-title' ? 'title' : role];
      if (Math.abs(px - expected) > .01) throw Error(`${graph.id}/${card.id}: ${role} at ${px}px, expected ${expected}px`);
    }
    if (card.contentOverflow) throw Error(`${graph.id}/${card.id}: card content clipped vertically`);
  }
  for (const cluster of metrics.clusters) {
    if (cluster.hasStatus) throw Error(`${graph.id}/${cluster.id}: a container status line is still rendered`);
    if (Math.abs(cluster.titlePx - 32) > .01 || Math.abs(cluster.repoPx - 24) > .01) throw Error(`${graph.id}/${cluster.id}: cluster typography differs from 32/24px`);
  }
  if (metrics.edgeLabels.some(value => Math.abs(value - 24) > .01)) throw Error(`${graph.id}: edge typography differs from 24px`);
  const pngResult = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...metrics.clip, scale: 1 } });
  const png = Buffer.from(pngResult.data, 'base64');
  const file = `.generated/report-scene-${graph.id}.png`;
  await writeFile(file, png);
  captures.push({ id: graph.id, pair: graph.pair, date: graph.date, sceneHash: graph.sceneHash,
    file, png, captureSha256: sha256(png), width: metrics.clip.width, height: metrics.clip.height, metrics,
    fit: annexFit(metrics.clip.width, metrics.clip.height) });
}

const dataUri = capture => `data:image/png;base64,${capture.png.toString('base64')}`;
const partOf = id => ANNEX_LABEL[id][0];
const listOf = part => captures.filter(capture => partOf(capture.id) === part)
  .map(capture => `${ANNEX_LABEL[capture.id]} — ${SCENE_CAPTION[capture.id]}`).join(' ; ');
const annexPages = captures.map(capture => {
  const fit = capture.fit;
  const label = `Annexe ${ANNEX_LABEL[capture.id]}`;
  const transition = SCENE_TRANSITION[capture.id];
  if (!transition) throw Error(`${capture.id}: no transition commentary`);
  return { sceneId: capture.id, label, part: partOf(capture.id), fit,
    effectiveTypePt: Object.fromEntries(Object.entries(CARD_TYPE).map(([role, px]) => [role, px * fit * 0.75])
      .concat([['edge', 24 * fit * 0.75]])),
    html: `<section class="diagram" data-scene="${capture.id}" data-annex="${ANNEX_LABEL[capture.id]}" data-scene-hash="${capture.sceneHash}">`
      + `<header><h2>${label} — ${SCENE_CAPTION[capture.id]}</h2>`
      + `<p>${ANNEX_PART[partOf(capture.id)]} · ${capture.id} · A4 portrait · scène entière, sans découpe`
      + ` · ajustement ${(fit * 100).toFixed(1)} % · plus petit texte imprimé ${(SMALLEST_TYPE_PX * fit * 0.75).toFixed(2)} pt`
      + ` · image à résolution native (${capture.width} × ${capture.height} px), lisible en zoomant dans le PDF`
      + ` · SHA-256 scène <code>${capture.sceneHash.slice(0, 16)}</code></p></header>`
      // The 1 px rule is on the image itself, sized border-box, so the frame hugs
      // the scene instead of drawing a box around half a page of white.
      + `<div class="frame"><img alt="Schéma ${capture.id}" src="${dataUri(capture)}"`
      + ` style="width:${capture.width * fit + 2}px;height:${capture.height * fit + 2}px"></div>`
      + `<div class="transition"><h3>${transition.title}</h3><p>${transition.text}</p></div></section>` };
});

const inlineFigures = INLINE_SCENES.map(entry => {
  const target = captures.find(capture => capture.id === entry.id);
  if (!target) throw Error(`${entry.id}: inline scene not captured`);
  const fit = Math.min(REPORT_BOX.width / target.width, (REPORT_BOX.height / 2) / target.height);
  const annexLabel = ANNEX_LABEL[entry.id];
  const scope = entry.part === 'A'
    ? `Les trois états d'hébergement sont en annexe A (${listOf('A')}).`
    : `L'avant et l'après sont en annexe B (${listOf('B')}).`;
  return { ...entry, fit, annexLabel,
    widthPx: Math.round(target.width * fit), heightPx: Math.round(target.height * fit),
    halfPageHeightPx: Math.round(REPORT_BOX.height / 2),
    withinHalfPage: Math.round(target.height * fit) <= Math.round(REPORT_BOX.height / 2),
    html: `<figure class="inline-scene"><img alt="Scène cible ${entry.id}"`
      + ` src="${dataUri(target)}" style="width:${Math.round(target.width * fit)}px;height:${Math.round(target.height * fit)}px">`
      + `<figcaption>Vue d'ensemble de la scène cible <code>${entry.id}</code> (13 septembre 2026), réduite à `
      + `${(fit * 100).toFixed(1)} % pour tenir sous une demi-page A4 portrait. Version pleine page : `
      + `annexe ${annexLabel}. ${scope}</figcaption></figure>` };
});

// Inserted from the last section to the first, so an earlier anchor keeps its
// offset. Section 6 takes the figure right after its opening paragraph; section
// 5 takes it after the paragraph that describes the deployed « Après » state.
for (const figure of [...inlineFigures].sort((left, right) => right.section - left.section)) {
  const heading = body.search(new RegExp(`<h2[^>]*>\\s*${figure.section}\\.`));
  if (heading < 0) throw Error(`section ${figure.section} anchor not found in the rendered report body`);
  const from = figure.anchor ? body.indexOf(figure.anchor, heading) : heading;
  if (from < 0) throw Error(`section ${figure.section}: anchor ${figure.anchor} not found`);
  const afterParagraph = body.indexOf('</p>', from);
  if (afterParagraph < 0) throw Error(`section ${figure.section}: no paragraph after the anchor`);
  body = `${body.slice(0, afterParagraph + 4)}${figure.html}${body.slice(afterParagraph + 4)}`;
}

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport d'activité · 10 août → 13 septembre 2026</title><style>
@page report{size:A4 portrait;margin:14mm 12mm}@page graph{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{font:14px/1.48 Arial,sans-serif;color:#172033;margin:0}.report-copy{page:report}h1{font-size:30px;border-bottom:4px solid #145f68;padding-bottom:12px}h2{font-size:21px;color:#145f68;margin-top:30px;break-after:avoid}h3{font-size:17px}table{border-collapse:collapse;width:100%;font-size:12px;margin:16px 0}th,td{border:1px solid #bdcad0;padding:7px;vertical-align:top}th{background:#eaf3f4;text-align:left}code{background:#edf1f3;padding:1px 4px}pre{white-space:pre-wrap;background:#edf1f3;padding:10px}.report-copy img{display:block;width:100%;height:auto;margin:10px 0;border:1px solid #bdcad0}figure.inline-scene{margin:12px 0;break-inside:avoid}figure.inline-scene img{width:auto;max-width:100%;border:1px solid #bdcad0}figure.inline-scene figcaption{font-size:11px;line-height:1.4;color:#44545f;margin-top:5px}.diagram{page:graph;break-before:page;width:${ANNEX_BOX.width}px;height:${ANNEX_BOX.height}px;overflow:hidden;display:flex;flex-direction:column}.diagram header{height:${ANNEX.header}px;overflow:hidden;flex:0 0 auto}.diagram .frame{flex:0 0 auto;display:flex;align-items:flex-start;justify-content:center;overflow:hidden;max-height:${ANNEX_IMAGE.height + 2}px}.diagram h2{font-size:13px;line-height:1.2;margin:0 0 3px;color:#145f68}.diagram p{font-size:9px;line-height:1.22;margin:0;color:#44545f}.diagram .frame img{display:block;max-width:none;border:1px solid #bdcad0}.diagram .transition{flex:0 0 auto;height:${ANNEX.comment}px;overflow:hidden;border-top:2px solid #145f68;margin-top:10px;padding-top:8px}.diagram .transition h3{font-size:13px;line-height:1.25;margin:0 0 5px;color:#145f68}.diagram .transition p{font-size:11.5px;line-height:1.5;margin:0;color:#172033}@media print{a{color:inherit}}
</style></head><body><main class="report-copy">${body}</main>${annexPages.map(page => page.html).join('')}</body></html>`.replace(/>\s+</g, '><');
await writeFile(`${reportBase}.html`, html);
const frameTree = await call('Page.getFrameTree');
await call('Page.setDocumentContent', { frameId: frameTree.frameTree.frame.id, html });
await waitFor(`document.querySelectorAll('.diagram img').length === ${annexPages.length} && [...document.images].every(image => image.complete)`);
// Measured in the laid-out page, not predicted: each annex image is whole inside
// its frame, the transition commentary is not clipped, and the printed type size
// written in the header is the one the image is actually rendered at.
const annexLayout = await evaluate(`[...document.querySelectorAll('.diagram')].map(section => {
  const image = section.querySelector('img'), frame = section.querySelector('.frame');
  const comment = section.querySelector('.transition'), paragraph = comment.querySelector('p');
  const imageBox = image.getBoundingClientRect(), frameBox = frame.getBoundingClientRect();
  // The image is sized border-box with a 1 px rule, so the drawn scene is the
  // bounding box minus that rule on each side.
  const drawn = { width: imageBox.width - 2, height: imageBox.height - 2 };
  return { annex: section.dataset.annex, sceneId: section.dataset.scene,
    measuredFit: drawn.width / image.naturalWidth,
    naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
    imageWidth: drawn.width, imageHeight: drawn.height,
    insideFrame: imageBox.left >= frameBox.left - 0.5 && imageBox.right <= frameBox.right + 0.5
      && imageBox.top >= frameBox.top - 0.5 && imageBox.bottom <= frameBox.bottom + 0.5,
    aspectKept: Math.abs(drawn.width / drawn.height - image.naturalWidth / image.naturalHeight) < 0.01,
    sectionOverflow: section.scrollHeight > section.clientHeight + 1,
    commentClipped: comment.scrollHeight > comment.clientHeight + 1
      || paragraph.getBoundingClientRect().bottom > comment.getBoundingClientRect().bottom + 0.5,
    commentChars: paragraph.textContent.length, commentLines: Math.round(paragraph.getBoundingClientRect().height / 17.25) };
})`);
if (annexLayout.length !== annexPages.length) throw Error('annex page count changed between build and layout');
for (const item of annexLayout) {
  const page = annexPages.find(entry => entry.sceneId === item.sceneId);
  if (!item.insideFrame) throw Error(`${item.annex}: the scene does not fit whole inside the page frame`);
  if (!item.aspectKept) throw Error(`${item.annex}: the scene is distorted`);
  if (item.sectionOverflow) throw Error(`${item.annex}: the annex page overflows its A4 box`);
  if (item.commentClipped) throw Error(`${item.annex}: the transition commentary is clipped`);
  if (Math.abs(item.measuredFit - page.fit) > 0.002)
    throw Error(`${item.annex}: measured fit ${item.measuredFit} differs from the announced ${page.fit}`);
  page.measuredFit = item.measuredFit;
  page.measuredTypePt = SMALLEST_TYPE_PX * item.measuredFit * 0.75;
  page.commentLines = item.commentLines;
}
// The annex exists to be at least as large as the body figure it completes.
for (const figure of inlineFigures) {
  if (!figure.withinHalfPage) throw Error(`${figure.id}: the inline figure exceeds half a page`);
  const page = annexPages.find(entry => entry.sceneId === figure.id);
  if (page.measuredFit < figure.fit - 1e-9)
    throw Error(`${page.label}: the annex page is smaller than the inline figure of the body`);
}
const printed = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
const currentPdf = Buffer.from(printed.data, 'base64');
await writeFile('.generated/current-report.pdf', currentPdf);
const output = { schema: 'immo-report-native-captures/v3', chromium: { zoom: 1, deviceScaleFactor: 1 },
  paper: { annex: 'A4 portrait', report: 'A4 portrait', annexMode: 'whole scene, no split',
    annexBoxPx: ANNEX_BOX, annexImageBoxPx: ANNEX_IMAGE, reportBoxPx: REPORT_BOX },
  inline: inlineFigures.map(({ html: _html, ...figure }) => figure),
  currentPdfSha256: sha256(currentPdf),
  annexPages: annexPages.map(({ html: _html, ...page }) => page),
  annexLayout,
  captures: captures.map(({ png, ...capture }) => ({ ...capture, scale: capture.metrics.scale })) };
await writeFile('.generated/report-render.json', `${JSON.stringify(output, null, 2)}\n`);
ws.close();
await fetch(`${base}/json/close/${page.id}`);
console.log(JSON.stringify({ currentPdfBytes: currentPdf.length, annexPages: annexPages.length,
  inline: output.inline.map(figure => ({ id: figure.id, section: figure.section,
    fit: Number(figure.fit.toFixed(4)), heightPx: figure.heightPx, withinHalfPage: figure.withinHalfPage })),
  annex: annexPages.map(page => ({ annex: page.label, id: page.sceneId,
    measuredFit: Number(page.measuredFit.toFixed(4)), typePt: Number(page.measuredTypePt.toFixed(2)),
    commentLines: page.commentLines })) }));
