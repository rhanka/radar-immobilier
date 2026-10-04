import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARD, sceneFor } from '../../../../architecture/focus/scenes.js';
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';
import { questions } from './choices.js';
import { groups, totals } from './groups.js';

const { graphs, sections, intention, context, synthesis, body, decisionDetails, annexes, manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));
const markdown = await readFile('../DOSSIER_DECISION_VILLES_ECART_2026-10-04.md', 'utf8');
const evidence = JSON.parse(await readFile('../preuves/diagnostic/groups.json', 'utf8'));
const figure = await readFile('TableDiagram.svelte', 'utf8');

test('une scène canonique d’architecture, cinq couloirs', () => {
  assert.deepEqual(graphs.map(graph => graph.id), ['architecture-ecart']);
  assert.equal(manifest.graphs.length, 1);
  assert.deepEqual(graphs[0].groups.map(group => group.id), ['L1', 'L2', 'BE', 'L3', 'L4', 'L5']);
  assert.deepEqual(graphs[0].groups.filter(group => group.parent === 'BE').map(group => group.id), ['L3', 'L4']);
});

test('couloirs verticaux de gauche à droite : un couloir = une colonne de cartes', () => {
  const scene = sceneFor(graphs[0]);
  const byId = Object.fromEntries(scene.absoluteNodes.map(node => [node.id, node]));
  const lanes = ['L1', 'L2', 'L3', 'L4', 'L5'].map(id => byId[id]);
  for (let index = 1; index < lanes.length; index++)
    assert.ok(lanes[index].position.x >= lanes[index - 1].position.x + lanes[index - 1].width, `${lanes[index].id} à droite de ${lanes[index - 1].id}`);
  for (const lane of lanes) {
    const cards = scene.absoluteNodes.filter(node => node.parentId === lane.id).sort((a, b) => a.position.y - b.position.y);
    assert.ok(cards.length >= 1, lane.id);
    assert.equal(new Set(cards.map(card => card.position.x)).size, 1, `${lane.id} : cartes empilées sur une seule colonne`);
    for (let index = 1; index < cards.length; index++) assert.ok(cards[index].position.y >= cards[index - 1].position.y + cards[index - 1].height, lane.id);
  }
});

test('composants réels : écrans, jobs, traitements, S3 et tables PG', () => {
  const names = graphs[0].nodes.map(node => node.metadata.name);
  for (const name of ['SignauxMapView', 'SignalPdfOverlay', 'radar-refresh', 'projection', 'document-date-recovery', 'runExploitation',
    'radar-api', 'upsertGraphAtomic', 'upsertGraph', 'graph/ville/latest.json', 'graph_nodes', 'graph_edges']) assert.ok(names.includes(name), name);
  const labels = graphs[0].edges.map(edge => edge.label);
  assert.ok(labels.includes('ON CONFLICT id · collision'));
  assert.ok(labels.includes('lit seulement PG'));
  assert.ok(labels.includes('G1 · nœuds vides'));
});

test('chaque carte respecte le gabarit A’ et ses champs', () => {
  assert.deepEqual(CARD.A, { width: 460, height: 200 });
  for (const graph of graphs) for (const node of graph.nodes) {
    const meta = node.metadata;
    assert.equal(meta.card, 'A', `${graph.id}/${node.id}`);
    assert.ok(meta.code && meta.role && meta.name && meta.detail, `${graph.id}/${node.id}`);
    assert.ok(roleIsShort(meta.role), `${graph.id}/${node.id} rôle trop long`);
    assert.ok(meta.name.length <= 28 && meta.detail.length <= 30, `${graph.id}/${node.id} texte trop long`);
  }
});

test('neuf sections numérotées, contexte avant la synthèse, annexe A ; l’annexe B ne passe pas en prose', () => {
  assert.equal(sections.filter(section => /^[1-9]\./.test(section.heading)).length, 9);
  assert.match(intention.heading, /^1\. Intention du dossier/);
  assert.match(context.heading, /^2\. Le contexte, en clair/);
  assert.match(synthesis.heading, /^3\. Synthèse et décisions demandées/);
  assert.deepEqual(body.map(section => section.heading.split('.')[0]), ['4', '5', '6', '8', '9']);
  assert.deepEqual(annexes.map(section => section.heading), ['Annexe A — Listes des villes par groupe']);
  for (const section of [intention, context, synthesis, ...body, ...annexes]) assert.ok(!section.markdown.includes('```mermaid'), section.heading);
  for (const term of ['latest.json', 'projection', '--heal', 'upsertGraphAtomic', 'runExploitation', 'garde-fou']) assert.ok(context.markdown.includes(term), term);
});

test('sept décisions, toutes décidées par Fabien, Farid consulté sur D2 et D3', () => {
  assert.deepEqual(questions.map(question => question.key), ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']);
  for (const question of questions) {
    assert.equal(question.decides, 'Fabien', question.key);
    assert.ok(question.options.some(option => option.key === question.recommended), question.key);
    assert.ok(question.options.length >= 2, question.key);
  }
  assert.deepEqual(questions.filter(question => question.consulted === 'Farid').map(question => question.key), ['D2', 'D3']);
});

test('chaque décision du §7 : introduction, Avantages / Inconvénients, recommandation, options du formulaire', () => {
  assert.deepEqual(Object.keys(decisionDetails), questions.map(question => question.key));
  for (const question of questions) {
    const detail = decisionDetails[question.key].markdown;
    const intro = detail.split('\n\n')[0];
    assert.ok(!detail.startsWith('**Décide'), `${question.key} : ligne décideur portée par les badges`);
    assert.ok(intro && intro.split(/(?<=\.) /).length >= 3, `${question.key} : introduction de plusieurs phrases`);
    assert.match(detail, /\| Option \| Avantages \| Inconvénients \|/);
    const rows = detail.split('\n').filter(line => /^\| (\*\*)?[(A-C]/.test(line));
    assert.equal(rows.length, question.options.length, `${question.key} : une ligne par option`);
    const recommended = rows.filter(line => line.startsWith('| **'));
    assert.equal(recommended.length, 1, `${question.key} : une seule option recommandée en gras`);
    const key = recommended[0].match(/^\| \*\*\(?([a-zA-Z])/)[1];
    assert.equal(key, question.recommended, `${question.key} : recommandation du tableau = formulaire`);
    assert.match(detail, new RegExp(`Recommandation \\*\\*\\(?${question.recommended}\\)?\\*\\*`), question.key);
  }
});

test('Tableau 3 : comptes = groups.json des preuves, total 226', () => {
  for (const group of groups) assert.equal(evidence[group.key].length, group.cities, group.id);
  assert.equal(groups.reduce((sum, group) => sum + group.cities, 0), totals.cities);
  assert.equal(totals.halted + totals.aborted, totals.cities);
  assert.equal(Object.keys(evidence).length, groups.length);
  for (const group of groups) assert.ok(markdown.includes(`| ${group.id} `), `${group.id} présent au §5.1`);
});

test('Figure 2 : tables, ligne partagée et chiffres repris du dossier', () => {
  for (const text of ['graph_nodes', 'graph_edges', 'bylaw-242', 'city_slug', 'ON CONFLICT (id)', '164 nœuds dans 109 villes', 'G3 · 49 villes', 'G2 · 81 villes'])
    assert.ok(figure.includes(text), text);
  for (const text of ['bylaw-242', '164 nœuds dans 109 villes', 'erDiagram', 'PK "seule clé, commune à toutes les villes"']) assert.ok(markdown.includes(text), text);
});
