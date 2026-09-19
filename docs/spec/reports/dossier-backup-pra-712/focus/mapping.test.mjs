import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CARD, sceneFor } from '../../../../architecture/focus/scenes.js';
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';
import { questions } from './choices.js';

const { graphs, decisionSections, annexes, manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));

const REMOTE_SHA = {
  // Empreintes SHA-256 (fin de fichier ignorée) des textes déposés dans .remote/.
  'Revue A1 — Fable 5.1': '10f06102c268296123e1b76a8566bbb8329872dc23b3a77cbda25ac80e52beb2',
  'Revue A2 — Gemini 3.8 high': '3fea2e42800e38d3759bd5279d60dffd0ea98a3effd5d9189eff137259c508c3',
  'Agrément B1 — lane k8s, clés comprises': '8e60e39eec825c62b15559319609811e76fad99e71f999d039e6718ec671df69',
  'Agrément B2 — co-validation de sécurité i-infra': 'c36251d8180b406eced67164442520b1356b856e14a7d87cb574fff4d8ebc6a5',
  'Revue C1 — Astra high (2026-09-17, première version)': '580ea1cb4845fc4967ff4afa6ba413d98ae44bf64b26270f81ccc39ae972ef55',
  'Revue C2 — Gemini 3.8 high (2026-09-17, première version)': 'eed656c086f67c18b3c34b4532ef88b8d4779bd7433bad64c3e8cda5f09d1290',
};
const sha = value => createHash('sha256').update(value.trimEnd()).digest('hex');
const byId = (graph, id) => graph.nodes.find(node => node.id === id);

test('trois scènes canoniques, dans l’ordre', () => {
  assert.deepEqual(graphs.map(graph => graph.id), ['architecture-sauvegardes', 'sequence-bout-en-bout', 'mise-en-service']);
  assert.equal(manifest.graphs.length, 3);
});

test('les douze sections, l’état réel en tête, et les annexes A à C verbatim', () => {
  assert.equal(decisionSections.length, 12);
  assert.deepEqual(decisionSections.map(section => Number(section.heading.split('.')[0])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const first = decisionSections[0].markdown;
  for (const fact of ['**gelé**', '**pas faite**', '**pas faites**', '**aucune**', 'corriger avant fusion', 'non fusionnable en l\'état'])
    assert.ok(first.includes(fact), `état réel sans « ${fact} »`);
  assert.deepEqual(annexes.map(section => section.heading.slice(0, 8)), ['Annexe A', 'Annexe B', 'Annexe C']);
  // Chaque texte déposé est repris octet pour octet, sous un sous-titre qui le nomme.
  const all = annexes.map(section => `## ${section.heading}\n\n${section.markdown}`).join('\n\n');
  const heads = Object.keys(REMOTE_SHA);
  for (const [index, head] of heads.entries()) {
    const marker = `### ${head}\n\n`;
    assert.ok(all.includes(marker), `sous-titre absent : ${head}`);
    let text = all.split(marker)[1];
    const next = heads.slice(index + 1).map(other => `\n### ${other}\n\n`).find(other => text.includes(other));
    if (next) text = text.split(next)[0];
    text = text.split(/\n## Annexe [A-Z] — /)[0];
    assert.equal(sha(text), REMOTE_SHA[head], `${head} n’est pas verbatim`);
  }
});

test('les défauts bloquants des revues et les réserves k8s sont présentés un par un, avec leur état', () => {
  const section4 = decisionSections[3].markdown;
  for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'G2', 'G3', 'G4', 'G5', 'G13'])
    assert.match(section4, new RegExp(`\\| ${id} \\|[^\\n]*\\*\\*(ouvert|contesté|corrigé)`), `${id} sans état`);
  const section5 = decisionSections[4].markdown;
  for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'])
    assert.match(section5, new RegExp(`\\| ${id} \\|[^\\n]*\\*\\*(ouverte|levée|transformée)`), `${id} sans état`);
  assert.match(decisionSections[5].markdown, /Auto-invalidée/);
});

test('scène 1 : immo et geo, buckets, identités, restauration éphémère, surveillance, états visibles', () => {
  const arch = graphs.find(graph => graph.id === 'architecture-sauvegardes');
  assert.deepEqual(arch.groups.map(group => group.id), ['IMMO_PP', 'IMMO_PR', 'S3_IMMO', 'IDS', 'SURV', 'GEO']);
  for (const [ids, parent] of [[['PG_PP', 'CJ_PP', 'EPH_PP'], 'IMMO_PP'], [['PG_PR', 'CJ_PR', 'QUOTA'], 'IMMO_PR'],
    [['B_PP', 'B_PR', 'PFX', 'LOCK', 'LC'], 'S3_IMMO'], [['ID_W', 'ID_R', 'ID_P', 'ID_ADM'], 'IDS'],
    [['FRESH', 'ACL', 'ALERT'], 'SURV'], [['GEO_SRC', 'GEO_IRR', 'GEO_COPY', 'GEO_DST'], 'GEO']])
    for (const id of ids) assert.equal(byId(arch, id).parent, parent, id);
  const state = id => byId(arch, id).metadata.runtimeState;
  // Existant, livré, gelé, inexistant, hors cluster : les états sont portés par les cartes.
  assert.equal(state('PG_PR'), 'active');
  assert.equal(state('CJ_PP'), 'dormant');
  assert.equal(state('B_PP'), 'suspended');
  assert.equal(state('GEO_DST'), 'not-applicable');
  assert.equal(state('GEO_COPY'), 'not-applicable');
  assert.equal(state('ID_ADM'), 'manual');
  const meta = id => byId(arch, id).metadata;
  assert.match(meta('PG_PP').detail, /950 MiB/);
  assert.match(meta('PG_PR').name, /1 002 MiB/);
  assert.match(meta('ID_W').name, /dépôt seul/);
  assert.match(meta('ID_R').name, /lecture seule/);
  assert.match(meta('ID_P').name, /seul à supprimer/);
  assert.match(meta('GEO_DST').name, /sentropic-geo-pra/);
  assert.ok(arch.edges.some(edge => edge.source === 'B_PP' && edge.target === 'EPH_PP' && edge.label));
});

test('scène 2 : sauvegarde puis restauration, qui et preuve à chaque étape, S-3 seule livrée', () => {
  const seq = graphs.find(graph => graph.id === 'sequence-bout-en-bout');
  const order = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
  assert.deepEqual(seq.nodes.map(node => node.id), order);
  for (const [index, id] of order.entries()) {
    const node = byId(seq, id);
    assert.equal(node.parent, index < 7 ? 'SAVE' : 'REST');
    assert.match(node.metadata.detail, /^preuve : /);
    if (index) assert.ok(seq.edges.some(edge => edge.source === order[index - 1] && edge.target === id && edge.label));
  }
  assert.match(byId(seq, 'C2').metadata.name, /immo seul/);
  assert.match(byId(seq, 'C5').metadata.name, /sans gel/);
  assert.deepEqual(seq.nodes.filter(node => node.metadata.runtimeState === 'dormant').map(node => node.id), ['C3']);
});

test('scène 3 : preuve avant fusion, activation simultanée, acteur et garde-fou par étape', () => {
  const path = graphs.find(graph => graph.id === 'mise-en-service');
  assert.deepEqual(path.groups.map(group => group.id), ['AVANT', 'FUSION', 'APRES']);
  const order = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'F1', 'F2', 'A1', 'A2', 'A3'];
  assert.deepEqual(path.nodes.map(node => node.id), order);
  for (const [index, id] of order.entries()) {
    if (index) assert.ok(path.edges.some(edge => edge.source === order[index - 1] && edge.target === id && edge.label), id);
    if (id !== 'A3') assert.match(byId(path, id).metadata.detail, /^garde : /);
  }
  // La restauration de preuve (M-5) précède la fusion (F-1) ; l'acte de production est un GO owner.
  assert.ok(order.indexOf('M5') < order.indexOf('F1'));
  assert.match(byId(path, 'M8').metadata.role, /Owner · GO/);
  assert.match(byId(path, 'F2').metadata.name, /préprod \+ prod/);
});

test('les choix de §12 : D1 à D5, corriger avant fusion en premier', () => {
  assert.deepEqual(questions.map(question => question.key), ['D1', 'D2', 'D3', 'D4', 'D5']);
  assert.ok(questions.every(question => question.mode === 'single'));
  assert.deepEqual(questions.map(question => question.options.map(option => option.key)),
    [['A', 'B', 'C', 'D'], ['CONDUCTEUR', 'FABLE', 'GEMINI', 'AUTRE'], ['CONFIRME', 'ACTIVER', 'MESURER'],
      ['VALIDE', 'AUTRE_REGION', 'AUTRE_NOM'], ['BUCKET', 'OBJETS']]);
  assert.match(questions[0].options[0].title, /^A — corriger avant fusion.*recommandé/);
});

test('gabarit unique A’ 460 x 200 et rôles « deux par deux »', () => {
  assert.deepEqual(CARD.A, { width: 460, height: 200 });
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      assert.equal(node.metadata.card, 'A');
      assert.ok(roleIsShort(node.metadata.role), `${graph.id}/${node.id}: ${node.metadata.role}`);
      assert.ok(node.metadata.code && node.metadata.name && node.metadata.detail);
      assert.ok(!node.metadata.name.includes(node.metadata.code));
    }
    for (const group of graph.groups) assert.equal(group.metadata.card, 'box');
  }
});

test('la géométrie Dagre LR place tout sans chevauchement de cartes', () => {
  for (const graph of graphs) {
    const scene = sceneFor(graph);
    assert.ok(scene.canvas.width > 0 && scene.canvas.height > 0);
    const leaves = scene.absoluteNodes.filter(node => !node.data.group);
    assert.equal(leaves.length, graph.nodes.length);
    for (let left = 0; left < leaves.length; left++) for (let right = left + 1; right < leaves.length; right++) {
      const a = leaves[left], b = leaves[right];
      const overlap = a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x
        && a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y;
      assert.ok(!overlap, `${graph.id}: ${a.id} et ${b.id} se chevauchent`);
    }
    for (const edge of scene.edges) if (edge.label) assert.ok(edge.data.labelPoint, `${graph.id}: ${edge.id} sans libellé placé`);
  }
});
