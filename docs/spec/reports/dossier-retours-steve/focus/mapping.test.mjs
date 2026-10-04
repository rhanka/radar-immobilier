import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARD } from '../../../../architecture/focus/scenes.js';
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';
import { questions } from './choices.js';

const { graphs, decisionSections, annexes, manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));

test('cinq scènes canoniques, dans l’ordre', () => {
  assert.deepEqual(graphs.map(graph => graph.id), ['criteres-steve', 'modele-donnees', 'flux-import-oracle', 'architecture-ui', 'affichage-abc']);
  assert.equal(manifest.graphs.length, 5);
});

test('les douze sections et l’annexe de convergence sont présentes ; l’annexe B ne passe pas en prose', () => {
  assert.equal(decisionSections.length, 12);
  assert.match(decisionSections[0].heading, /^1\. Intention du dossier, objectifs de l'owner/);
  assert.match(decisionSections[1].heading, /^2\. Ce que veut Steve/);
  assert.deepEqual(annexes.map(section => section.heading), ['Annexe A — Convergence entre les deux auteurs']);
  for (const section of [...decisionSections, ...annexes]) assert.ok(!section.markdown.includes('```mermaid'), section.heading);
});

test('chaque carte respecte le gabarit A’ et ses champs', () => {
  assert.deepEqual(CARD.A, { width: 460, height: 200 });
  assert.deepEqual(graphs.map(graph => graph.kind), ['matrix', 'er', 'lanes', 'flow', 'lanes']);
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

test('le modèle de données est un diagramme entité-relation : tables, colonnes clés, cardinalités', () => {
  const model = graphs.find(graph => graph.id === 'modele-donnees');
  assert.equal(model.kind, 'er');
  const names = model.entities.map(entity => entity.id);
  for (const name of ['annotation_sources', 'annotation_raw_rows', 'annotation_codes', 'annotation_rules', 'annotation_findings', 'annotation_assessments',
    'annotation_anchors', 'oracle_releases', 'comment_projection', 'graph_nodes', 'prospect_notes']) assert.ok(names.includes(name), name);
  // Seules graph_nodes et prospect_notes existent déjà : toute autre table est une proposition.
  assert.deepEqual(model.entities.filter(entity => entity.existing).map(entity => entity.id), ['graph_nodes', 'prospect_notes']);
  for (const entity of model.entities) assert.ok(entity.attributes.some(attribute => attribute.keys.includes('PK')), `${entity.id} sans clé primaire`);
  const relation = (source, label) => model.relations.find(item => item.source === source && item.label === label);
  assert.deepEqual([relation('annotation_sources', 'contient').sourceCardinality, relation('annotation_sources', 'contient').targetCardinality], ['one', 'zero-or-many']);
  assert.equal(relation('annotation_anchors', 'cle_texte_sans_fk').identifying, false);
  assert.equal(relation('annotation_assessments', 'supersedes').target, 'annotation_assessments');
  assert.equal(model.layout.layers.length, 5);
  assertGeometry(model, model.relations.filter(item => item.source !== item.target));
});

test('architecture en couloirs : utilisateurs, UI, backend, données S3 et PostgreSQL ; oracle en bande basse', () => {
  const lanes = graphs.find(graph => graph.id === 'flux-import-oracle');
  assert.equal(lanes.kind, 'lanes');
  assert.deepEqual(lanes.layout.lanes.map(lane => lane.kind), ['user', 'ui', 'backend', 'data']);
  for (const [index, lane] of lanes.layout.lanes.entries()) if (index) assert.ok(lane.x >= lanes.layout.lanes[index - 1].x + lanes.layout.lanes[index - 1].width);
  const bottom = Math.max(...lanes.layout.lanes.map(lane => lane.y + lane.height));
  assert.ok(lanes.layout.band.y > bottom, 'oracle sous les couloirs');
  assert.ok(lanes.layout.band.width >= lanes.layout.lanes.reduce((sum, lane) => sum + lane.width, 0) * 0.95, 'oracle transversal');
  const laneOf = id => lanes.nodes.find(node => node.id === id).lane;
  assert.deepEqual(['STV', 'MAP', 'COL', 'DET', 'IMP', 'RAT', 'GSA', 'ANA', 'DOCS', 'GRA', 'ADJ', 'OE'].map(laneOf), ['L1', 'L2', 'L3', 'L3', 'L3', 'L3', 'L3', 'L3', 'L4', 'L4', 'OR', 'OR']);
  assert.deepEqual(lanes.groups.filter(group => group.parent === 'L4').map(group => group.label), ['S3 · stockage objet', 'PostgreSQL']);
  assert.ok(lanes.edges.some(edge => edge.source === 'ANN' && edge.target === 'ADJ'), 'oracle alimenté par les annotations en base');
  for (const node of lanes.nodes) {
    assert.ok(['observed', 'declared', 'historical'].includes(node.evidence), node.id);
    assert.ok(node.label.length <= 26 && node.detail.length <= 32, `${node.id} texte trop long`);
  }
  assertGeometry(lanes, lanes.edges);
});

test('les chiffres des cartes sont ceux du dossier', () => {
  const card = (sceneId, id) => graphs.find(graph => graph.id === sceneId).nodes.find(node => node.id === id).metadata;
  assert.match(graphs.find(graph => graph.id === 'flux-import-oracle').nodes.find(node => node.id === 'STV').detail, /7 feuilles/);
  assert.match(card('architecture-ui', 'GCB').detail, /2 761 lignes/);
  assert.match(card('architecture-ui', 'DS').detail, /39 sur 69/);
  assert.match(card('architecture-ui', 'COL').detail, /0 sur 3/);
  assert.equal(graphs.find(graph => graph.id === 'modele-donnees').entities.find(entity => entity.id === 'annotation_codes').attributes[0].comment, '28 codes');
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

test('seize décisions D1 à D16, recommandation connue sauf le point ouvert D9', () => {
  // Ordre de décision : le bloc de Fabien d'abord, puis celui de Farid.
  assert.deepEqual(questions.map(question => question.key), ['D2', 'D3', 'D4', 'D9', 'D10', 'D11', 'D1', 'D5', 'D6', 'D7', 'D8', 'D12', 'D13', 'D14', 'D15', 'D16']);
  assert.deepEqual(questions.map(question => question.step), [...Array(6).fill(1), ...Array(10).fill(2)]);
  assert.ok(questions.every(question => (question.step === 1) === (question.decides === 'Fabien')));
  for (const question of questions) {
    if (question.key === 'D9') { assert.equal(question.recommended, null); continue; }
    assert.ok(question.options.some(option => option.key === question.recommended), question.key);
  }
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

test('chaque décision : introduction, dépendances antérieures, avantages et inconvénients par option, recommandation motivée', async () => {
  const order = questions.map(question => question.key);
  const markdown = await readFile('../DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md', 'utf8');
  const section10 = markdown.split('\n## 10. Options et recommandation')[1].split('\n## 11. ')[0];
  assert.match(section10, /Fabien décide d’abord ses six décisions/);
  for (const question of questions) {
    const sentences = question.intro.split(/(?<=[.?!»)])\s+(?=[A-ZÀ-Ý«])/).length;
    assert.ok(sentences >= 3 && sentences <= 6 && question.intro.length <= 900, `${question.key} : introduction de ${sentences} phrases`);
    assert.match(question.intro, /§\d|scène/, `${question.key} : renvoi au dossier`);
    // Une décision ne dépend que de décisions prises avant elle.
    for (const key of question.dependsOn) assert.ok(order.indexOf(key) < order.indexOf(question.key), `${question.key} dépend de ${key}, décidée après`);
    for (const option of question.options) {
      assert.ok(option.pros.length >= 2 && option.pros.length <= 4, `${question.key}/${option.key} avantages`);
      assert.ok(option.cons.length >= 2 && option.cons.length <= 4, `${question.key}/${option.key} inconvénients`);
      for (const item of [...option.pros, ...option.cons]) assert.ok(section10.includes(item), `${question.key}/${option.key} absent du §10 : ${item}`);
    }
    assert.ok(question.recommendation.length > 40, question.key);
    assert.ok(section10.includes(`#### ${question.question}`) && section10.includes(question.intro), `${question.key} : §10 désaligné`);
  }
  assert.ok(!/honn[êe]te/i.test(markdown + JSON.stringify(questions)));
});

test('graphiques : chaque valeur reprend un tableau du dossier, repères présents dans le Markdown', async () => {
  const { CHARTS } = await import('./charts.js');
  const markdown = await readFile('../DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md', 'utf8');
  const markers = [...markdown.matchAll(/<!-- chart:([\w-]+) -->/g)].map(match => match[1]);
  assert.deepEqual(markers.sort(), Object.keys(CHARTS).sort());
  // Row of a table, looked up inside the section that carries the chart.
  const section = (from, to) => markdown.split(from)[1].split(to)[0];
  const rowIn = (text, start) => text.split('\n').find(line => line.startsWith(`| ${start} |`))?.split('|').slice(1, -1).map(cell => cell.trim().replaceAll('*', ''));
  const s53 = section('\n### 5.3 ', '\n### 5.4 '), s52 = section('\n### 5.2 ', '\n### 5.3 '), s93 = section('\n### 9.3 ', '\n### 9.4 ');
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
  const markdown = await readFile('../DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md', 'utf8');
  const section10 = markdown.split('\n## 10. Options et recommandation')[1].split('\n## 11. ')[0];
  for (const question of questions) for (const option of question.options) {
    assert.ok(option.description.length >= 80, `${question.key}/${option.key} description trop courte`);
    assert.ok(section10.includes(option.description), `${question.key}/${option.key} description absente du §10`);
  }
  const withDiagram = questions.flatMap(question => question.options.filter(option => option.diagram).map(option => `${question.key}/${option.key}`));
  assert.deepEqual(withDiagram, ['D2/M1', 'D2/M2', 'D2/M3', 'D2/M4', 'D3/a', 'D3/b', 'D3/c']);
  for (const question of questions) for (const option of question.options.filter(item => item.diagram)) {
    const model = parseEr(option.diagram.er, option.key);
    const layout = erLayout(model, option.diagram);
    assert.ok(section10.includes(option.diagram.er), `${question.key}/${option.key} schéma absent du §10`);
    assertGeometry({ id: `${question.key}/${option.key}`, layout }, model.relations);
  }
});
