import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARD } from '../../../../architecture/focus/scenes.js';
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';
import { questions } from './choices.js';

const { graphs, decisionSections, annexes, manifest, header, glossary } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const markdown = await readFile('../DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md', 'utf8');
// Text between two headings of the dossier (the second one excluded).
const between = (from, to) => { const start = markdown.indexOf(from); assert.ok(start >= 0, from); const end = markdown.indexOf(to, start + from.length); assert.ok(end > start, to); return markdown.slice(start, end); };
// Decision fiches: G1 to G8 and D1 to D17 in chapter 9 (plan adopted in §B6, version figée L5).
const decisionText = between('\n## 9. Décisions', '\n## 10. ');
// Text compared without Markdown marks: the fiches mix tables, lists and bold labels, the
// interactive copy keeps plain sentences (one source of text, aligned by this test).
const plain = text => text.replace(/<br>/g, ' ').replace(/[*`]/g, '').replace(/^\s*[-•]\s+/gm, ' ').replace(/\s+/g, ' ').replace(/’/g, "'").trim();
const sentences = text => plain(text).split(/(?<=[.?!»)])\s+(?=[A-ZÀ-Ý«(0-9])/).filter(Boolean);
const SCENE_ORDER = ['criteres-steve', 'affichage-abc', 'modele-donnees', 'flux-import-reference', 'architecture-ui'];
// Sections still being written (the others were integrated on 2026-10-06).
const MARKERS = [];

test('cinq scènes canoniques, dans l’ordre des chapitres qui les portent', () => {
  assert.deepEqual(graphs.map(graph => graph.id), SCENE_ORDER);
  assert.equal(manifest.graphs.length, 5);
  assert.deepEqual([...markdown.matchAll(/<!-- scene:([\w-]+) -->/g)].map(match => match[1]), SCENE_ORDER);
  // Each scene sits in its chapter: §2.6, §7.2, §8.2, §8.4, §8.5.
  for (const [id, from, to] of [['criteres-steve', '\n### 2.6 ', '\n## 3. '], ['affichage-abc', '\n### 7.2 ', '\n### 7.3 '], ['modele-donnees', '\n### 8.2 ', '\n### 8.3 '],
    ['flux-import-reference', '\n### 8.4 ', '\n### 8.5 '], ['architecture-ui', '\n### 8.5 ', '\n## 9. ']]) assert.ok(between(from, to).includes(`<!-- scene:${id} -->`), id);
});

test('table des matières : ouverture, dix chapitres, annexes A à F (plan du §B6, version figée L5)', async () => {
  const level2 = [...markdown.matchAll(/^## (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(level2, ['Ouverture', '1. L\'intention de l\'owner', '2. Ce que veut Steve', '3. Comment un signal est retenu ou écarté',
    '4. Les données de Steve, analysées en profondeur', '5. Ce qu\'on demande à Steve', '6. Tentative de détection sur les données actuelles',
    '7. Comment C remplacerait B', '8. Capitaliser les retours de Steve', '9. Décisions', '10. Risques et suites',
    'Annexe A — Mesures', 'Annexe B — Méthode', 'Annexe C — Modèle physique et détail technique', 'Annexe D — Règle de décision complète',
    'Annexe E — Glossaire complet', 'Annexe F — Sources et traçabilité']);
  const chapter4 = [...between('\n## 4. ', '\n## 5. ').matchAll(/^### (4\.\d) /gm)].map(match => match[1]);
  assert.deepEqual(chapter4, ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8']);
  assert.equal(decisionSections.length, 10);
  assert.match(decisionSections[0].heading, /^1\. L'intention de l'owner/);
  assert.match(decisionSections[2].heading, /^3\. Comment un signal est retenu ou écarté/);
  assert.deepEqual(annexes.map(section => section.id), ['annexe-A', 'annexe-B', 'annexe-C', 'annexe-D', 'annexe-E', 'annexe-F']);
  assert.equal(header.heading, 'Ouverture');
  assert.equal(glossary.heading, 'Annexe E — Glossaire complet');
  for (const section of [header, ...decisionSections, ...annexes]) assert.ok(!section.markdown.includes('```mermaid'), section.heading);
  // One version date, with the frozen-version mention, in the banner under the title.
  assert.match(manifest.banner, /^Dossier de décision · pour Farid \(Product Owner\) · validation technique : Fabien \(AI Builder\) · version du 10 octobre 2026 · version figée L5$/);
  // Banners required by Z13⁗, word for word.
  assert.ok(between('\n## 3. ', '\n## 4. ').startsWith('\n## 3. Comment un signal est retenu ou écarté\n\n> **fidélité en cours de contrôle**\n'));
  assert.ok(between('\n## 6. ', '\n## 7. ').includes('\n> **L4b en cours**\n'));
  assert.equal(markdown.split('\n> **en cours de vote**\n').length - 1, 4);
  // The consolidation journal and the canonical scenes live beside the report.
  const journal = await readFile('../JOURNAL_CONSOLIDATION.md', 'utf8');
  for (const part of ['## A.1 Chiffres', '## A.2 Constats', '## A.3 Options, recommandations et décisions', '## A.4 Points laissés à la décision']) assert.ok(journal.includes(part), part);
  const sources = between('\n## Annexe F', '\n### F.5 ');
  assert.ok(sources.includes('[JOURNAL_CONSOLIDATION.md](JOURNAL_CONSOLIDATION.md)') && sources.includes('[SCENES_FOCUS.md](SCENES_FOCUS.md)'));
  assert.match(between('\n### F.4 ', '\n### F.5 '), /\| §9\.3 Nouveau jeu de référence \| §4\.9/);
  assert.match(between('\n### F.4 ', '\n### F.5 '), /Renvois des cartes #783 et #784/);
  // Full text of the questions to Steve: never in clear in the public report (D16).
  assert.ok(!markdown.includes('159-04-2026') && !markdown.includes('26-06-163'));
});

test('repères de rédaction : sections en attente, chacune signalée', () => {
  const found = [...markdown.matchAll(/^<!-- A_INTEGRER: ([\w.-]+) -->\nSection en cours de rédaction\.$/gm)].map(match => match[1]);
  assert.deepEqual(found, MARKERS);
  assert.equal((markdown.match(/<!-- A_INTEGRER/g) ?? []).length, MARKERS.length);
});

test('écarts et suites : 113 lignes évaluées, 89 accords, 24 écarts, une suite chacun ; ouverture et §4.6 concordants', () => {
  const s46 = between('\n### 4.6 ', '\n### 4.7 ');
  const rows = s46.split('\n').filter(line => /^\| [A-ZÉ].*\| \d+ \|$/.test(line));
  assert.deepEqual(rows.map(line => Number(line.split('|').at(-2))), [7, 3, 3, 7, 4]);
  assert.equal(rows.reduce((sum, line) => sum + Number(line.split('|').at(-2)), 0), 24);
  assert.ok(s46.includes('La règle donne le classement de Steve sur 89 lignes et s\'en écarte sur 24.'));
  const opening = between('\n## Ouverture', '\n## 1. ');
  assert.ok(opening.includes('Sur 113 lignes évaluées, la règle proposée'));
  assert.ok(opening.includes('| C45-bis | 114 | 90 | 24 |'));
  // Y phrase after C45-ter (rule of B9b §3.3): only n° 119 is cited.
  for (const text of [opening, s46]) assert.ok(text.includes('serait masquée selon l\'une de ces valeurs (n° 119).'));
  const body = between('\n## Ouverture', '\n## Annexe A');
  for (const word of ['erreurs de notre outillage', '51 désaccords', 'actée par', 'flux-import-oracle']) assert.ok(!body.includes(word), word);
});

test('inputs de Steve : colonnes L à T de l’assistant, P, Q, R de Steve ; tableau de référence C', () => {
  const s44 = between('\n### 4.4 ', '\n### 4.5 ');
  for (const text of ['Les colonnes **L à T** de Triage, hors P, Q et R', '**rédigées par l\'assistant du triage**', 'Seules **P (sens), Q (classement) et R (code de motif)** sont les décisions de Steve', '**B** (passe observée)',
    '**80 documents distincts sur 80, HTTP 200**', 'Emplacement décidé par Fabien : « Dépôt public, fichier chiffré »', '3 sur 3 pour les 605 champs']) assert.ok(s44.includes(text), text);
  const s43 = between('\n### 4.3 ', '\n### 4.4 ');
  for (const text of ['**12 paires**', '**Lecture identique dans 12 paires sur 12**', '**dans 5 paires sur 12**', 'Les **7 autres**']) assert.ok(s43.includes(text), text);
  assert.match(between('\n### 4.1 ', '\n### 4.2 '), /\*\*Aucune de ces lignes ne sert de test confirmatoire\.\*\*/);
  assert.match(between('\n## 7. ', '\n## 8. '), /\*\*Statut : `not run`\.\*\*/);
});

test('chaque carte respecte le gabarit A’ et ses champs', () => {
  assert.deepEqual(CARD.A, { width: 460, height: 200 });
  assert.deepEqual(graphs.map(graph => graph.kind), ['matrix', 'lanes', 'er', 'lanes', 'flow']);
  for (const graph of graphs.filter(item => item.kind === 'flow')) for (const node of graph.nodes) {
    const meta = node.metadata;
    assert.equal(meta.card, 'A', `${graph.id}/${node.id}`);
    assert.ok(meta.code && meta.role && meta.name && meta.detail, `${graph.id}/${node.id}`);
    assert.ok(roleIsShort(meta.role), `${graph.id}/${node.id} rôle trop long`);
    assert.ok(meta.name.length <= 28 && meta.detail.length <= 30, `${graph.id}/${node.id} texte trop long`);
  }
});

// Géométrie commune aux scènes en SVG : boîtes disjointes, routes orthogonales qui ne
// traversent aucune boîte hors de leurs extrémités, libellés dans le canevas et hors des boîtes.
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function assertGeometry(graph, edges) {
  const { boxes, routes, labels, width, height } = graph.layout;
  for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) assert.ok(!overlaps(a, b), `${graph.id}: ${a.id} / ${b.id}`);
  for (const edge of edges) {
    const points = routes[edge.id];
    assert.ok(points.length >= 2, edge.id);
    for (const [index, point] of points.entries()) {
      assert.ok(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height, `${edge.id} hors canevas`);
      if (!index) continue;
      const previous = points[index - 1];
      assert.ok(point.x === previous.x || point.y === previous.y, `${edge.id} non orthogonale`);
      const segment = { x: Math.min(point.x, previous.x) + 0.5, y: Math.min(point.y, previous.y) + 0.5,
        width: Math.max(Math.abs(point.x - previous.x) - 1, 0.01), height: Math.max(Math.abs(point.y - previous.y) - 1, 0.01) };
      for (const box of boxes) if (box.id !== edge.source && box.id !== edge.target) assert.ok(!overlaps(segment, box), `${edge.id} traverse ${box.id}`);
    }
    const label = labels[edge.id];
    if (!label) continue;
    assert.ok(label.x >= 0 && label.y >= 0 && label.x + label.width <= width && label.y + label.height <= height, `libellé ${edge.id} hors canevas`);
    for (const box of boxes) assert.ok(!overlaps(label, box), `libellé ${edge.id} sur ${box.id}`);
  }
}

test('scène 2 : stockage réel en colonnes, propriétaire du schéma ou du code en badge', () => {
  const model = graphs.find(graph => graph.id === 'modele-donnees');
  assert.equal(model.kind, 'er');
  assert.deepEqual(model.layout.layers.map(layer => layer.title), ['Exécution (jobs et service)', 'Postgres d’immo : tables immo', 'Postgres d’immo : tables du paquet (sentropic)',
    'S3 d’immo (bucket radar-immobilier-docs)', 'Service geo (PostGIS, S3 geo)', 'Dépôt git d’immo (code, profil, .track)']);
  const owner = Object.fromEntries(model.entities.map(entity => [entity.id, entity.owner]));
  // Propriétaire ≠ stockage : les tables annotation_* sont à sentropic mais dans le Postgres d’immo.
  for (const id of ['annotation_sources', 'annotation_revisions', 'annotation_validations', 'annotation_targets']) {
    assert.equal(owner[id], 'sentropic', id);
    assert.equal(model.layout.layers[model.layout.boxes.findIndex(box => box.id === id) >= 0 ? 2 : 0].title.startsWith('Postgres'), true);
  }
  assert.equal(owner.job_refresh, 'engram · job immo');
  assert.equal(owner.s3_graph, 'engram · immo');
  assert.equal(owner.s3_reference_sets, 'engram');
  assert.equal(owner.decisions_track, 'track');
  const relation = (source, label) => model.relations.find(item => item.source === source && item.label === label);
  assert.equal(relation('job_refresh', 'ecrit').target, 's3_graph');
  assert.equal(relation('job_refresh', 'projette').target, 'graph_nodes');
  assert.equal(relation('job_evaluation', 'ecrit_eval').target, 's3_reference_sets');
  for (const entity of model.entities) assert.ok(entity.owner, `${entity.id} sans propriétaire`);
  assertGeometry(model, model.relations.filter(item => item.source !== item.target));
});

test('architecture en couloirs : utilisateurs, UI, backend, données S3 et PostgreSQL ; jeu de référence en bande basse', () => {
  const lanes = graphs.find(graph => graph.id === 'flux-import-reference');
  assert.equal(lanes.kind, 'lanes');
  assert.deepEqual(lanes.layout.lanes.map(lane => lane.kind), ['user', 'ui', 'backend', 'data']);
  for (const [index, lane] of lanes.layout.lanes.entries()) if (index) assert.ok(lane.x >= lanes.layout.lanes[index - 1].x + lanes.layout.lanes[index - 1].width);
  const bottom = Math.max(...lanes.layout.lanes.map(lane => lane.y + lane.height));
  assert.ok(lanes.layout.band.y > bottom, 'jeu de référence sous les couloirs');
  assert.ok(lanes.layout.band.width >= lanes.layout.lanes.reduce((sum, lane) => sum + lane.width, 0) * 0.95, 'jeu de référence transversal');
  const laneOf = id => lanes.nodes.find(node => node.id === id).lane;
  assert.deepEqual(['STV', 'MAP', 'COL', 'DET', 'IMP', 'RAT', 'GSA', 'ANA', 'DOCS', 'GRA', 'ADJ', 'OE'].map(laneOf), ['L1', 'L2', 'L3', 'L3', 'L3', 'L3', 'L3', 'L3', 'L4', 'L4', 'OR', 'OR']);
  assert.deepEqual(lanes.groups.filter(group => group.parent === 'L4').map(group => group.label), ['S3 · stockage objet', 'PostgreSQL']);
  assert.ok(lanes.edges.some(edge => edge.source === 'ANN' && edge.target === 'ADJ'), 'jeu de référence alimenté par les annotations en base');
  for (const node of lanes.nodes) {
    assert.ok(['observed', 'declared', 'historical'].includes(node.evidence), node.id);
    assert.ok(node.label.length <= 30 && node.detail.length <= 32, `${node.id} texte trop long`);
  }
  assertGeometry(lanes, lanes.edges);
});

test('les chiffres des cartes sont ceux du dossier', () => {
  const card = (sceneId, id) => graphs.find(graph => graph.id === sceneId).nodes.find(node => node.id === id).metadata;
  assert.match(graphs.find(graph => graph.id === 'flux-import-reference').nodes.find(node => node.id === 'STV').detail, /7 feuilles/);
  assert.match(card('architecture-ui', 'GCB').detail, /2 761 lignes/);
  assert.match(card('architecture-ui', 'DS').detail, /39 sur 69/);
  assert.match(card('architecture-ui', 'COL').detail, /0 sur 3/);
  assert.match(graphs.find(graph => graph.id === 'modele-donnees').entities.find(entity => entity.id === 'profil_domaine').attributes[1].comment, /motifs/);
});

test('A/B/C : deux zones, application en couloirs (écran, backend, base) et évaluation hors ligne en bas', () => {
  const abc = graphs.find(graph => graph.id === 'affichage-abc');
  assert.equal(abc.kind, 'lanes');
  assert.equal(abc.projection.zone, 'Application — ce que voient les utilisateurs');
  const { zone, lanes, band } = abc.layout;
  for (const lane of lanes) assert.ok(lane.x >= zone.x && lane.x + lane.width <= zone.x + zone.width && lane.y >= zone.y && lane.y + lane.height <= zone.y + zone.height, lane.id);
  assert.ok(band.y > zone.y + zone.height, 'évaluation sous l’application');
  const byId = Object.fromEntries(abc.nodes.map(node => [node.id, node]));
  // Où chaque élément vit : écran, backend, base, ou job d'évaluation hors ligne.
  assert.deepEqual(['MAPB', 'MAPC', 'UATC'].map(id => byId[id].tag), ['écran', 'écran', 'écran']);
  assert.deepEqual(['APIB', 'APIC'].map(id => byId[id].tag), ['backend', 'backend']);
  assert.deepEqual(['GRA', 'ANN', 'ORR'].map(id => byId[id].tag), ['PG', 'PG', 'PG']);
  assert.deepEqual(['PA', 'DIFF', 'ORA', 'MES', 'GATE', 'DEC'].map(id => byId[id].lane), Array(6).fill('EV'));
  assert.equal(byId.MAPB.evidence, 'observed');
  assert.equal(byId.APIC.evidence, 'declared');
  assert.equal(byId.PA.evidence, 'historical');
  // Seule la décision de Farid fait passer les utilisateurs de B à C.
  assert.deepEqual(abc.edges.filter(edge => edge.target === 'MAPC' && byId[edge.source].lane === 'EV').map(edge => edge.source), ['DEC']);
  assertGeometry(abc, abc.edges);
});

test('vingt-cinq décisions G1 à G8 et D1 à D17 dans l’ordre des tours ; D1 et D17 tranchées par Fabien, D13 sans recommandation', () => {
  // Ordre de décision : le tour de Fabien d'abord, puis celui de Farid.
  assert.deepEqual(questions.map(question => question.key), ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'D1', 'D2', 'D3', 'D4', 'D9', 'D10', 'D11', 'D17', 'D5', 'D6', 'D7', 'D8', 'D12', 'D13', 'D14', 'D15', 'D16']);
  assert.deepEqual(questions.map(question => question.step), [...Array(16).fill(1), ...Array(9).fill(2)]);
  assert.deepEqual(questions.filter(question => question.family === 'générique').map(question => question.key), ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']);
  assert.ok(questions.every(question => (question.step === 1) === (question.decides === 'Fabien')));
  // Options lettered everywhere (a), (b)… ; the recommended one exists, D13 recommends no value of X.
  for (const question of questions) {
    assert.ok(question.options.every(option => /^[a-z]$/.test(option.key) && option.title.startsWith(`(${option.key})`)), question.key);
    if (question.key === 'D13') assert.equal(question.recommended, null);
    else assert.ok(question.options.some(option => option.key === question.recommended), question.key);
  }
  const byKey = Object.fromEntries(questions.map(question => [question.key, question]));
  assert.equal(byKey.D9.recommended, 'd');
  assert.equal(byKey.D9.question, 'D9 — Sens de « double annotation »');
  assert.deepEqual([byKey.D1.decides, byKey.D1.decided.option, byKey.D1.decided.date], ['Fabien', 'b', '2026-10-02']);
  assert.deepEqual([byKey.D17.decides, byKey.D17.consulted, byKey.D17.decided.option, byKey.D17.decided.date], ['Fabien', 'Steve, Farid', 'a', '2026-10-05']);
  assert.deepEqual([byKey.D7.question, byKey.D7.recommended], ['D7 — La règle de la nouvelle sélection (C)', 'b']);
  assert.deepEqual([byKey.D8.question, byKey.D8.consulted], ['D8 — Qui tranche quand la règle et Steve divergent', 'Steve, Mathieu, Fabien']);
  assert.deepEqual([byKey.D16.question, byKey.D16.consulted], ['D16 — Ce qu\'on demande et ce qu\'on renvoie à Steve', 'Mathieu, Fabien']);
  assert.match(byKey.D10.options.find(option => option.key === 'b').description, /Steve annote à l'aveugle deux groupes de cas pris dans les nouvelles villes/);
  assert.match(byKey.D13.options.find(option => option.key === 'a').title, /X = 10 %/);
  // Registre unique au §9.2 : une ligne par décision.
  const registry = between('\n### 9.2 ', '\n### 9.3 ');
  for (const question of questions) assert.ok(registry.includes(`| ${question.key} | `), `registre : ${question.key}`);
});

test('critères de Steve : une matrice, trois critères, deux exclusions, bruit de la passe 1', () => {
  const k = graphs.find(graph => graph.id === 'criteres-steve');
  assert.equal(k.kind, 'matrix');
  const { rows, total } = k.projection;
  assert.deepEqual(rows.map(row => row.criterion), ['1 · Résidentiel', '2 · Assouplissement', '3 · Densification', 'Exclusion · autorisation individuelle', 'Exclusion · point d\'ordre du jour']);
  assert.deepEqual(rows.map(row => row.coverage), ['partiel', 'absent', 'absent', 'partiel', 'absent']);
  // §2.2 : 3 hors résidentiel, 4 resserrements, 6 sans effet, 8 autorisations individuelles, 3 ordres du jour = 24 sur 73.
  assert.deepEqual(rows.map(row => row.noise), [3, 4, 6, 8, 3]);
  assert.equal(total.noise, 24);
  assert.equal(total.workingView, 73);
  assert.match(total.steve, /22 sur 73/);
  assert.match(total.radar, /34 des 40/);
});

test('chaque décision : introduction, dépendances antérieures, avantages et inconvénients par option, alignée sur sa fiche du ch. 9', async () => {
  const order = questions.map(question => question.key);
  const section9 = plain(decisionText);
  assert.ok(section9.includes('Tour de Fabien. Fabien tranche d\'abord ses 16 décisions'));
  for (const question of questions) {
    // The interactive copy repeats its fiche: every sentence of the introduction is in chapter 9.
    for (const sentence of sentences(question.intro)) assert.ok(section9.includes(sentence), `${question.key} : phrase absente du ch. 9 : ${sentence}`);
    assert.match(question.intro, /§\d|scène|chapitre|annexe|D\d+/, `${question.key} : renvoi au dossier`);
    // Une décision ne dépend que de décisions prises avant elle.
    for (const key of question.dependsOn) assert.ok(order.indexOf(key) < order.indexOf(question.key), `${question.key} dépend de ${key}, décidée après`);
    for (const option of question.options) {
      assert.ok(option.pros.length >= 1 && option.pros.length <= 4, `${question.key}/${option.key} avantages`);
      assert.ok(option.cons.length >= 1 && option.cons.length <= 4, `${question.key}/${option.key} inconvénients`);
      for (const item of [...option.pros, ...option.cons]) assert.ok(section9.includes(plain(item)), `${question.key}/${option.key} absent du ch. 9 : ${item}`);
    }
    assert.equal(typeof question.recommendation, 'string', question.key);
    assert.ok(decisionText.includes(`#### ${question.question}`), `${question.key} : titre absent du ch. 9`);
  }
  assert.ok(!/honn[êe]te/i.test(markdown + JSON.stringify(questions)));
});

test('graphiques : chaque valeur reprend un tableau du dossier, repères présents dans le Markdown', async () => {
  const { CHARTS } = await import('./charts.js');
  const markers = [...markdown.matchAll(/<!-- chart:([\w-]+) -->/g)].map(match => match[1]);
  assert.deepEqual(markers.sort(), Object.keys(CHARTS).sort());
  // Row of a table, looked up inside the section that carries the chart.
  const section = (from, to) => markdown.split(from)[1].split(to)[0];
  const rowIn = (text, start) => text.split('\n').find(line => line.startsWith(`| ${start} |`))?.split('|').slice(1, -1).map(cell => cell.trim().replaceAll('*', ''));
  const s42 = section('\n### 4.2 ', '\n### 4.3 ');
  const s53 = s42.split('**Sens de la modification × classement (CALCUL).**')[1].split('**Motifs')[0], s52 = s42.split('**Classement par passe (CALCUL, feuille Triage).**')[1].split('**Sens de la')[0];
  const s93 = section('\n### A.4 ', '\n### A.5 ');
  for (const item of CHARTS['sens-classement'].rows) {
    const [, p, s, n, total, pass1] = rowIn(s53, item.label);
    assert.deepEqual([Number(p), Number(s), Number(n), Number(total), Number(pass1)],
      [item.values.P, item.values.S, item.values.N, item.values.P + item.values.S + item.values.N, item.extra], item.label);
  }
  for (const item of CHARTS['classement-passes'].rows) {
    const [, p, s, n, total] = rowIn(s52, item.label);
    assert.deepEqual([Number(p), Number(s), Number(n), Number(total)], [item.values.P, item.values.S, item.values.N, item.values.P + item.values.S + item.values.N], item.label);
  }
  // Familles de bruit : §2.2 (bilan de la passe 1) et tableaux des critères (124 lignes).
  assert.deepEqual(CHARTS['bruit-familles'].rows.map(item => item.values[0]), [3, 4, 6, 8, 3]);
  assert.equal(CHARTS['bruit-familles'].rows.reduce((sum, item) => sum + item.values[0], 0), 24);
  assert.equal(CHARTS['bruit-familles'].rows.reduce((sum, item) => sum + item.values[1], 0), 55);
  assert.match(markdown, /les 24 Non pertinent se répartissent en \*\*3\*\* hors résidentiel ou hors urbanisme, \*\*4\*\* resserrements, \*\*6\*\* sans effet sur la capacité, \*\*11\*\* hors portée \(8 autorisations individuelles, 3 points d'ordre du jour\)/);
  for (const item of CHARTS['base-b'].rows) {
    const [, value, ratio] = rowIn(s93, item.label);
    assert.equal(value, `${String(item.value).replace('.', ',')} %`, item.label);
    assert.equal(ratio, item.ratio, item.label);
  }
});

test('options : description concrète pour chacune, schéma de tables pour D2 et D3, géométrie propre', async () => {
  const { parseEr } = await import('./parse-er.mjs');
  const { erLayout } = await import('./diagram-layout.js');
  const section9 = plain(decisionText);
  for (const question of questions) for (const option of question.options) {
    assert.ok(option.description.length >= 10, `${question.key}/${option.key} description trop courte`);
    assert.ok(section9.includes(plain(option.description)), `${question.key}/${option.key} description absente du ch. 9`);
  }
  const withDiagram = questions.flatMap(question => question.options.filter(option => option.diagram).map(option => `${question.key}/${option.key}`));
  assert.deepEqual(withDiagram, ['D2/a', 'D2/b', 'D2/c', 'D2/d', 'D3/a', 'D3/b', 'D3/c']);
  // Option schemas stay in their fiches (interactive copy); the former annexe III.5 is removed (B5.4, point 5).
  assert.ok(!markdown.includes('Schémas des options de D2 et D3'));
  for (const question of questions) for (const option of question.options.filter(item => item.diagram)) {
    const model = parseEr(option.diagram.er, option.key);
    const layout = erLayout(model, option.diagram);
    if (question.key === 'D2' && option.key === 'a') assert.ok(between('\n### 8.2 ', '\n### 8.3 ').includes(option.diagram.er), 'D2/a : modèle cible du §8.2');
    assertGeometry({ id: `${question.key}/${option.key}`, layout }, model.relations);
  }
});

test('introduction : protocole des trois passes et glossaire, avant toute mesure « Passe 1 »', async () => {
  const { PROTOCOL } = await import('./protocol.js');
  const intro = markdown.indexOf(`### 2.1 ${PROTOCOL.title}`);
  assert.ok(intro > 0 && intro < markdown.indexOf('| Passe 1 |') + 1 && intro < markdown.indexOf('<!-- chart:'));
  for (const row of PROTOCOL.passes) assert.ok(markdown.includes(`| ${row.pass} | ${row.filters} | ${row.signals} | ${row.aim} |`), row.pass);
  assert.ok(markdown.includes(PROTOCOL.summary));
  assert.equal(PROTOCOL.passes.reduce((sum, row) => sum + row.signals, 0) + 1, 124);
  const glossaryText = between('\n## Annexe E — Glossaire complet\n', '\n## Annexe F');
  // Glossaire de tête dans l'ouverture : quinze termes au plus (B1″).
  const headTerms = between('**Glossaire de tête**', '\n---').split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| Terme'));
  assert.equal(headTerms.length, 13);
  // First column of the glossary table: the defined terms.
  const terms = glossaryText.split('\n').filter(line => line.startsWith('| ')).map(line => line.split('|')[1]).join(' ; ');
  for (const term of ['Passe 1', '124 lignes', 'B′', 'Profil A gelé', 'Shadow', 'Jeu de référence C', 'Jeu de référence E', 'Seuil D13', 'Ancre', 'B0', 'Tombstone',
    'Motifs N-', 'K1 à K9', 'PIIA', 'PPCMOI', 'ODJ', 'CPTAQ', 'UAT', 'MCP',
    'steve_v1', 'Majorité IA', 'R1–R7, R′', 'Écart, désaccord', 'Montré, masqué, Pertinent masqué', 'Précision P ∪ S', 'B′ passes 1, 2, 3', 'Exploratoire, confirmatoire', '`pass`, `fail`, `indeterminate`', 'Rôles de l\'évaluation']) assert.ok(terms.includes(term), term);
});

test("existant et jeux de référence : schémas du texte, aucune table de jeu de référence en base, proposition ancien → nouveau jeu de référence", async () => {
  const { DOC_DIAGRAMS } = await import('./doc-diagrams.js');
  const { parseEr } = await import('./parse-er.mjs');
  const { erLayout } = await import('./diagram-layout.js');
  const schema = await readFile('../../../../../api/src/db/schema.ts', 'utf8');
  assert.deepEqual(Object.keys(DOC_DIAGRAMS).sort(), ['engram-store', 'etat-actuel', 'existant', 'jeux-reference', 'modele-minimal']);
  for (const [id, spec] of Object.entries(DOC_DIAGRAMS)) {
    assert.ok(markdown.includes(`\`\`\`mermaid\n${spec.er}\n\`\`\`\n\n<!-- diagram:${id} -->`), id);
    const model = parseEr(spec.er, id);
    assertGeometry({ id, layout: erLayout(model, spec) }, model.relations.filter(relation => relation.source !== relation.target));
  }
  // Les colonnes du schéma « existant » sont celles de schema.ts.
  const existing = parseEr(DOC_DIAGRAMS.existant.er, 'existant');
  for (const table of ['prospect_marks', 'prospect_notes'])
    for (const column of existing.entities.find(entity => entity.id === table).attributes) assert.ok(schema.includes(`("${column.name}"`), `${table}.${column.name}`);
  assert.ok(!/pgTable\(\s*"oracle/.test(schema), "aucune table de jeu de référence sur main");
  const s6 = between('\n### C.2 ', '\n### C.3 ');
  assert.match(s6, /Aucune table de jeu de référence n'existe en base aujourd'hui/);
  for (const reason of ['Auteur avec compte obligatoire', 'Une seule cible par note', '10 000 caractères au plus', 'Aucune provenance', 'défaut à corriger par B0']) assert.ok(s6.includes(reason), reason);
  // Jeu de référence C v2 : §4.8.
  const s93 = between('\n### 4.8 ', '\n## 5. ');
  assert.match(s93, /provenance par champ/);
  assert.match(s93, /<!-- diagram:jeux-reference -->/);
  assert.match(s93, /\(D10, D11\)/);
});

test('§9.1 et §9.2 : besoins de Steve → données, modèle minimal, ce qu\'il ne fait pas, tables existantes laissées telles quelles', async () => {
  const s63 = between('\n### 8.1 ', '\n### 8.3 ');
  assert.match(s63, /\*\*Besoins de Steve → données nécessaires\.\*\*/);
  assert.equal(s63.split('\n').filter(line => /^\| [1-9] \|/.test(line)).length, 9);
  for (const table of ['retours_fichiers', 'annotations', 'validations', 'motifs', 'annotation_cibles', 'reference_set_versions']) assert.ok(s63.includes(`| \`${table}\` |`), table);
  assert.match(s63, /Ce qui reste hors du périmètre, volontairement/);
  assert.match(s63, /Sort des six tables du brouillon/);
  assert.match(s63, /ni étendues ni réutilisées/);
  assert.match(s63, /#812/);
  // Architecture des données : cinq ensembles, en ligne (zone) ou hors ligne (bande), existe ou proposé.
  const { docLanes } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
  const arch = docLanes['architecture-donnees'];
  assert.deepEqual(arch.layout.lanes.map(lane => lane.title), ['Utilisateurs de l’application', '(a) Données de Steve · immo · proposé', '(b) Annotations · sentropic · proposé', '(c) Graphe · immo · existe', '(d) Jeu de référence · engram · proposé']);
  assert.match(arch.layout.zone.title, /En ligne/);
  assert.ok(arch.layout.band.y > arch.layout.zone.y + arch.layout.zone.height);
  assert.ok(markdown.indexOf('<!-- lanes:architecture-donnees -->') < markdown.indexOf('<!-- diagram:modele-minimal -->'));
  assertGeometry(arch, arch.edges);
  assert.match(s63, /Vision de l'owner/);
  const d1 = questions.find(question => question.key === 'D1');
  assert.deepEqual([d1.decides, d1.step, d1.decided.option, d1.decided.date], ['Fabien', 1, 'b', '2026-10-02']);
  assert.equal(questions.find(question => question.key === 'D5').recommended, 'c');
  const d2 = questions.find(question => question.key === 'D2');
  assert.deepEqual(d2.options.map(option => option.key), ['a', 'b', 'c', 'd']);
  assert.equal(d2.recommended, 'a');
  assert.ok(!/annotation_(?:raw_rows|assessments|anchors|codes|rules|findings)|label_set|prospect_notes v1/.test(between('\n## 8. ', '\n### 8.4 ')), 'plus de tables M3 au ch. 9');
});

test('annexe III.1 : état initial physique (PG, S3, geo), état proposé avec statuts (scène modele-donnees), rattachement des cibles, tableau des écarts', async () => {
  const { PHYSICAL } = await import('./physical-model.js');
  const { parseEr } = await import('./parse-er.mjs');
  const schema = await readFile('../../../../../api/src/db/schema.ts', 'utf8');
  const s60 = between('\n### C.1 ', '\n### C.2 ');
  // Chaque table Postgres du schéma « État actuel » existe dans schema.ts.
  const current = parseEr(PHYSICAL['etat-actuel'].er, 'actuel');
  const pgTables = current.entities.map(entity => entity.id).filter(id => !id.startsWith('s3_') && !['registre_villes', 'geo_ogc', 'job_refresh', 'app_immo'].includes(id));
  for (const table of pgTables) assert.ok(schema.includes(`pgTable(\n  "${table}"`) || schema.includes(`pgTable("${table}"`), table);
  // Statuts du schéma proposé : nouveau, modifié, inchangé ; rien de supprimé.
  const status = PHYSICAL['etat-propose'].status;
  assert.deepEqual(Object.keys(status).filter(id => status[id] === 'new').sort(), ['annotation_revisions', 'annotation_sources', 'annotation_targets', 'annotation_validations', 'decisions_track', 'job_evaluation', 'manifestes', 's3_reference_sets', 's3_retours']);
  assert.deepEqual(Object.keys(status).filter(id => status[id] === 'modified').sort(), ['account_users', 'graph_edges', 'graph_nodes', 'profil_domaine', 'prospect_notes']);
  assert.ok(!Object.values(status).includes('deleted'));
  for (const text of ['Les signaux sont les nœuds de type \x60Signal\x60 et \x60DesignationEvent\x60', 'Villes : aucune table.', '1 106 municipalités', 'raw/proces-verbaux-<ville>/cas/<sha>.pdf',
    'graph/<ville>/latest.json', 'api.geo.sent-tech.ca', 'Côté geo, rien ne change', '**Tableau des écarts.**', '| Stockage physique | Propriétaire du schéma / code | Exécuté par |', 'radar-refresh-pv', '@sentropic/graphify', 'clé \x60(city_slug, id)\x60 décidée pour #812'])
    assert.ok(s60.includes(text), text);
  for (const kind of ['Signal', 'Ville', 'PV, document', 'Zone', 'Lot']) assert.ok(s60.includes(`| ${kind} |`), kind);
  // The proposed state is drawn once, as the modele-donnees scene (§9.2): no duplicate in the text.
  assert.ok(s60.includes('<!-- diagram:etat-actuel -->') && !markdown.includes('<!-- diagram:etat-propose -->'));
  assert.ok(s60.includes('est la scène `modele-donnees` (§8.2)'));
});

test('convergence : « jeu de référence » partout, §8.3, définitions et métriques (annexe B.6), statut exploratoire et confirmatoire', async () => {
  // « oracle » ne reste que dans des chemins ou noms de fichiers réels, et dans le glossaire comme ancien nom.
  const stray = markdown.slice(0, markdown.indexOf('\n### F.5 ')).split('\n').flatMap(line => [...line.matchAll(/(?<![-_/.\w])[Oo]racles?(?![-_/\w]|\.\w)/g)].map(() => line))
    .filter(line => !line.includes('« oracle »'));
  assert.deepEqual(stray, []);
  for (const heading of ['### 8.3 Convergence sentropic + engram', '### 4.5 Étiquetage de référence v0', '### B.6 Unité, agrégation, définitions et métriques', '### B.7 Contrat d\'entrée (D17)'])
    assert.ok(markdown.includes(heading), heading);
  const s54 = between('\n### B.6 ', '\n### B.7 ');
  for (const text of ['enregistrement radar', 'rattache_a', 'Pertinent masqué', 'précision P ∪ S', 'kappa', 'Pertinents perdus', 'passes 1, 2 et 3', 'P > S > N'])
    assert.ok(s54.includes(text), text);
  assert.ok(between('\n### 4.1 ', '\n### 4.2 ').includes('pool-limited-to-shown-items'));
  const s53 = between('\n### B.7 ', '\n### B.8 ');
  for (const text of ['**coupé à la date du signal**', 'les colonnes L à T du classeur (hors P, Q, R)']) assert.ok(s53.includes(text), text);
  // Former exploratory campaign (v1 to v3): measures in annexe A.7, protocol in annexe B.8.
  const s6 = between('\n### A.7 ', '\n## Annexe B') + between('\n### B.8 ', '\n### B.9 ');
  for (const text of ['Tout résultat de ce chapitre est exploratoire', 'aucun résultat n\'est admissible pour D13', '**limites du signal seul**', 'Passe × Classement']) assert.ok(s6.includes(text), text);
  assert.ok(!/plafond du signal seul/i.test(s6));
  const s7 = between('\n### B.5 ', '\n### B.6 ');
  for (const text of ['k_max = 0', 'P(pass) ≈ 0,56 à 29 Pertinent pour X = 10 %', '≈ 0,30 à 59 Pertinent pour X = 5 %', '`pass`', '`fail`', '`indeterminate`', 'au moins 50 cas']) assert.ok(s7.includes(text), text);
  for (const key of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']) assert.ok(between('\n### 9.3 ', '\n### 9.4 ').includes(`#### ${key} — `), key);
  for (const key of ['D1', 'D9', 'D10', 'D13', 'D17']) assert.ok(decisionText.includes(`#### ${key} — `), key);
  const plan = between('\n### 10.2 ', '\n### 10.3 ');
  for (const step of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) assert.ok(plan.includes(`\n| ${step} | `), `étape ${step}`);
  assert.ok(!/honn[êe]te/i.test(markdown + (await readFile('../JOURNAL_CONSOLIDATION.md', 'utf8')) + (await readFile('../SCENES_FOCUS.md', 'utf8'))));
});

test('comptes mesurés : 121 lignes → 162 enregistrements → 80 documents, par verdict', async () => {
  const { CHARTS } = await import('./charts.js');
  const s42 = between('\n### 4.2 ', '\n### 4.3 ');
  const rows = [['Pertinent', 39, 55, 36], ['À surveiller', 29, 38, 26], ['Non pertinent', 53, 69, 39]];
  for (const [verdict, lines, records, documents] of rows) assert.ok(s42.includes(`| ${verdict} | ${lines} | ${records} | ${documents} |`), verdict);
  assert.ok(s42.includes('| **Total** | **121** | **162** | **80** (distincts, pas la somme) |'));
  assert.deepEqual(CHARTS['steve-signaux'].rows.map(row => [row.values.P, row.values.S, row.values.N]), [rows.map(row => row[1]), rows.map(row => row[2])]);
  assert.ok(s42.includes('→ 162 enregistrements distincts du radar'));
  assert.ok(s42.includes('#14 (Saint-Jean-Baptiste') && markdown.includes('#55 (Mont-Saint-Hilaire') && markdown.includes('#58 (Sainte-Cécile-de-Milton'));
});

test('détection exploratoire : chaque point des nuages précision / rappel reprend le tableau de l\'annexe A.7', async () => {
  const { CHARTS } = await import('./charts.js');
  const s64 = between('\n### A.7 ', '\n#### Lecture (JUGEMENT, exploratoire)');
  const num = (text) => Number(text.trim().replace(',', '.'));
  for (const [id, ri, pi] of [['pr-test-steve', 1, 2], ['pr-test-consensus', 4, 5]]) {
    assert.equal(CHARTS[id].kind, 'scatter');
    assert.equal(CHARTS[id].points.length, 12);
    for (const point of CHARTS[id].points) {
      const name = point.label.replace(/ \(.*\)$/, '');
      const line = s64.split('\n').find((row) => row.startsWith(`| ${point.label} |`) || row.startsWith(`| ${name} `));
      assert.ok(line, point.label);
      const cells = line.split('|').slice(2, -1);
      assert.equal(num(cells[ri - 1]), point.recall, `${id} ${point.label} rappel`);
      assert.equal(num(cells[pi - 1]), point.precision, `${id} ${point.label} précision`);
    }
  }
});
