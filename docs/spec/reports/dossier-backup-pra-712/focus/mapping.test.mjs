import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CARD, FRAME_FACES, FRAME_PLAN, gridExempt } from './elk-layout.mjs';
import { checkGeometry, checkGrid, checkPlan, columnsOf, GRID, RATIO, legibilityFrom, LEGIBILITY, FORMATS, fitScale, printGateFor, PT_PER_PX } from './geometry-check.mjs';
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';
import { questions, decisionRecord, principe, cible, etape1, pretVsConstruire, etape2 } from './choices.js';

const { graphs, decisionSections, annexes, manifest } = JSON.parse(await readFile('.generated/data.json', 'utf8'));

// Empreintes SHA-256 (fin de fichier ignorée) des textes déposés dans .remote/,
// repris octet pour octet en annexe. Une seule dérogation, déclarée : la revue
// Gemini porte dans sa source une espace en fin de ligne 197, que la page ne peut
// pas transporter (`git diff --check` refuse toute fin de ligne blanche). Le
// contrôle compare donc, pour ce seul texte, les lignes sans blanc terminal —
// et le dossier le dit.
const REMOTE_SHA = {
  'Revue A1 — Fable 5.1 (PRA v3)': '2cf21ea7b9b2983963cfb1a4eb2d0d78240a54527147d1bbb0452572f112d108',
  'Revue A2 — Gemini 3.8 high (PRA v3)': 'd3e7dca7b52871d67ce7d85c2b37c6e098134efa3bc52aca0a029a4d348ad6a3',
  'Faits B1 — inventaire k8s et clés de scellement': 'd1a6506932589516f83587377635b3757fa9cf56cf345e457ec39b4ce183e0aa',
  'Faits B2 — rendu archify et bpmn-js': '30b9fe6ff5e706ca426678ec16961b5326834995d15ce48f03a6ac6de1f9acf1',
  'Faits B3 — divergences résiduelles': '3bb8ee5d4ac52c214299465e1853071fc414a0d0ef4059644693837e36251c58',
  'Demande C1 — owner, sections 1 à 5': 'cd47c7ac3c6b28ce223273eafa57160954a61a7364628297451f8c7e81af09c4',
};
const sha = value => createHash('sha256').update(value.trimEnd()).digest('hex');
const byId = (graph, id) => graph.nodes.find(node => node.id === id);
const groupIds = graph => graph.groups.map(group => group.id);

test('trois scènes canoniques, dans l’ordre', () => {
  assert.deepEqual(graphs.map(graph => graph.id), ['architecture-sauvegardes', 'sequence-bout-en-bout', 'mise-en-service']);
  assert.equal(manifest.graphs.length, 3);
});

test('les treize sections, l’état réel en tête, et les annexes A à C verbatim', () => {
  assert.equal(decisionSections.length, 13);
  assert.deepEqual(decisionSections.map(section => Number(section.heading.split('.')[0])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  const first = decisionSections[0].markdown;
  // L'état réel est en tête, et il dit ce qui ne va pas avant ce qui va.
  for (const fact of ['**corrigée et réconciliée**', '**aucune**', '**non acquis**', '**ouverts**', '**périmé**'])
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

test('les deux revues du double challenge sont bien celles que l’owner a nommées', () => {
  const annexeA = annexes[0];
  assert.match(annexeA.heading, /Revues contradictoires de la spec PRA v3/);
  // Fable 5.1 et Gemini 3.8 high : Astra était injoignable, et c'est l'owner qui
  // l'a remplacée — la page doit le dire, pas le taire.
  assert.ok(annexeA.markdown.includes('### Revue A1 — Fable 5.1 (PRA v3)'));
  assert.ok(annexeA.markdown.includes('### Revue A2 — Gemini 3.8 high (PRA v3)'));
  assert.match(decisionSections[1].markdown, /Astra étant injoignable[^.]*\*\*tu as décidé\*\*/);
});

test('couverture : les 44 fragments du verbatim, et les quatre passages jamais complétés', () => {
  const section3 = decisionSections[2].markdown;
  for (let n = 1; n <= 44; n++) assert.match(section3, new RegExp(`\\| V${n} \\|`), `fragment V${n} absent`);
  // Les quatre passages inachevés restent ouverts, et le disent.
  for (const [fragment, question] of [['V19', 'Q2'], ['V30', 'Q3'], ['V40', 'Q4']])
    assert.match(section3, new RegExp(`\\| ${fragment} \\|[^\\n]*inachevé[^\\n]*${question}`), `${fragment} sans renvoi à ${question}`);
  assert.match(section3, /\| V14 \|[^\n]*ambigu[^\n]*Q1/);
  // Rien n'est ajouté au nom de l'owner : les deux élargissements relevés sont marqués.
  assert.match(section3, /\| V10 \|[^\n]*décision spec \(F13\), pas ta demande/);
  assert.match(section3, /\| V13 \|[^\n]*plus faible que ton texte/);
});

test('scène 1 : utilisateur et administration en vis-à-vis, quatre colonnes entre les deux, cluster > tenant > environnement', () => {
  const arch = graphs.find(graph => graph.id === 'architecture-sauvegardes');
  assert.deepEqual(groupIds(arch), ['Z_GHX', 'HORS_GH', 'GH_PILOTAGE', 'OVH_CLUSTER', 'immo_tenant', 'immo_pp', 'immo_pr',
    'geo_tenant', 'geo_pp', 'geo_pr', 'PLATEFORME', 'BUCKETS_OVH', 'S3_IMMO', 'S3_IMMO_PP', 'S3_IMMO_PR',
    'S3_GEO', 'S3_GEO_PP', 'S3_GEO_PR', 'CLES_S3', 'EXT_REGION', 'SUD_ADMIN']);
  // La bande de quatre colonnes du plan de l'owner, dans son ordre. La colonne de
  // pilotage (Z_GHX) empile hors GitHub au-dessus de GitHub (owner : « place gh en
  // dessous de hors gh ») — elle remplace les deux colonnes séparées d'avant.
  assert.deepEqual(FRAME_FACES[arch.id].band, ['Z_GHX', 'OVH_CLUSTER', 'BUCKETS_OVH', 'EXT_REGION']);
  assert.equal(FRAME_FACES[arch.id].north, 'USER');
  assert.equal(FRAME_FACES[arch.id].south, 'SUD_ADMIN');
  assert.equal(FRAME_FACES[arch.id].anchor, 'OVH_CLUSTER');
  // La case utilisateur est hors de tout conteneur, même convention que le dossier
  // d'architecture d'ensemble (`A_USER`). Les quatre faces sont tenues par le cadre
  // du mode `frame` ; le contrôle de position est le test suivant.
  assert.equal(byId(arch, 'USER').parent, null);
  assert.equal(byId(arch, 'USER').metadata.role, 'Navigateur');
  assert.equal(byId(arch, 'USER').metadata.detail, 'accès web · hors cluster');
  // Trois niveaux dans le cluster : cluster > tenant > environnement, convention
  // reprise telle quelle de docs/architecture/focus (OVH_CLUSTER > immo_tenant > immo_pp / immo_pr).
  const parentOfGroup = id => arch.groups.find(group => group.id === id).parent;
  for (const [child, parent] of [['HORS_GH', 'Z_GHX'], ['GH_PILOTAGE', 'Z_GHX'],
    ['immo_tenant', 'OVH_CLUSTER'], ['geo_tenant', 'OVH_CLUSTER'],
    ['PLATEFORME', 'OVH_CLUSTER'], ['immo_pp', 'immo_tenant'], ['immo_pr', 'immo_tenant'],
    ['geo_pp', 'geo_tenant'], ['geo_pr', 'geo_tenant'],
    ['S3_IMMO', 'BUCKETS_OVH'], ['S3_GEO', 'BUCKETS_OVH'], ['CLES_S3', 'BUCKETS_OVH'],
    ['S3_IMMO_PP', 'S3_IMMO'], ['S3_IMMO_PR', 'S3_IMMO'], ['S3_GEO_PP', 'S3_GEO'],
    ['S3_GEO_PR', 'S3_GEO']]) assert.equal(parentOfGroup(child), parent, child);
  // La colonne de pilotage, le cluster, les buckets et la réplication sont des blocs
  // racine ; hors GitHub et GitHub sont deux zones empilées DANS la colonne de
  // pilotage (owner : « place gh en dessous de hors gh », zones « séparées bien »).
  for (const id of ['Z_GHX', 'OVH_CLUSTER', 'BUCKETS_OVH', 'EXT_REGION', 'SUD_ADMIN'])
    assert.equal(parentOfGroup(id), null, id);
  // Chaque carte est dans la face et l'environnement que la mise en page impose.
  for (const [ids, box] of [
    [['GHA', 'GHA_CD', 'ALT_GH'], 'GH_PILOTAGE'],
    [['ALT_TEM', 'CF_LE'], 'HORS_GH'],
    [['PG_PP', 'CJ_PP', 'FH_PP', 'CL_PP', 'KR_PP'], 'immo_pp'],
    [['PG_PR', 'CJ_PR', 'FH_PR', 'CL_PR', 'KR_PR'], 'immo_pr'],
    [['GA_PP', 'GP_PP', 'GS_PP'], 'geo_pp'],
    [['GA_PR', 'GP_PR', 'GC_PR'], 'geo_pr'],
    [['PF', 'IDP', 'K_SEAL'], 'PLATEFORME'],
    [['OBJ_PP', 'BK_PP', 'PRE_PP'], 'S3_IMMO_PP'],
    [['OBJ_PR', 'BK_PR', 'PRE_PR'], 'S3_IMMO_PR'],
    [['GB_PP', 'GI_PP', 'G5_PP'], 'S3_GEO_PP'],
    [['GB_PR', 'GI_PR', 'GD_PR', 'GS_PR'], 'S3_GEO_PR'],
    [['R6_PP', 'R6_PR', 'GR_PP', 'GR_PR', 'OPT_HORS'], 'EXT_REGION'],
    [['K_S3'], 'CLES_S3'],
    [['OWNER', 'ADMIN', 'K_VAULT', 'K_OVH'], 'SUD_ADMIN'],
  ]) for (const id of ids) assert.equal(byId(arch, id).parent, box, id);
  // Colonne 1 : ce que GitHub exécute et émet, et rien d'autre. Colonne 2 : les
  // fournisseurs tiers. Colonne 4 : les buckets. Colonne 5 : la réplication.
  const ancestorsOf = id => { const map = new Map([...arch.groups, ...arch.nodes].map(item => [item.id, item.parent]));
    const out = []; let p = map.get(id); while (p) { out.push(p); p = map.get(p); } return out; };
  for (const id of ['GHA', 'GHA_CD', 'ALT_GH']) assert.ok(ancestorsOf(id).includes('GH_PILOTAGE'), id);
  for (const id of ['ALT_TEM', 'CF_LE']) assert.ok(ancestorsOf(id).includes('HORS_GH'), id);
  for (const id of ['GHA', 'GHA_CD', 'ALT_GH']) assert.ok(!ancestorsOf(id).includes('HORS_GH'), id);
  for (const id of ['OBJ_PR', 'BK_PR', 'GB_PR', 'K_S3']) assert.ok(ancestorsOf(id).includes('BUCKETS_OVH'), id);
  for (const id of ['R6_PR', 'OPT_HORS', 'GR_PR']) assert.ok(ancestorsOf(id).includes('EXT_REGION'), id);
  for (const id of ['R6_PR', 'OPT_HORS']) assert.ok(!ancestorsOf(id).includes('BUCKETS_OVH'), id);
  for (const id of ['PG_PP', 'PG_PR', 'GA_PP', 'GA_PR', 'PF']) assert.ok(ancestorsOf(id).includes('OVH_CLUSTER'), id);
  // La plateforme partagée reste dans le cluster, sous les tenants.
  assert.ok(ancestorsOf('PF').includes('OVH_CLUSTER') && !ancestorsOf('PF').includes('immo_tenant'));

  // Symétrie ARCH-1 : chaque rangée a sa paire préprod / prod, aux mêmes rangs.
  const code = id => byId(arch, id).metadata.code;
  for (const [pp, pr] of [['PG_PP', 'PG_PR'], ['CJ_PP', 'CJ_PR'], ['OBJ_PP', 'OBJ_PR'], ['BK_PP', 'BK_PR'],
    ['GI_PP', 'GI_PR'], ['R6_PP', 'R6_PR'], ['GA_PP', 'GA_PR']]) {
    assert.match(code(pp), /-PP$/, pp);
    assert.match(code(pr), /-PR$/, pr);
    assert.equal(code(pp).replace(/-PP$/, ''), code(pr).replace(/-PR$/, ''), `${pp} et ${pr} hors rangée commune`);
  }
  // ARCH-5 : toute case « absent » est une carte motivée, jamais un trou.
  const state = id => byId(arch, id).metadata.runtimeState;
  for (const id of ['GI_PP', 'GP_PP', 'R6_PP', 'GR_PP', 'G5_PP']) {
    assert.equal(state(id), 'not-applicable', id);
    assert.ok(byId(arch, id).metadata.detail.length > 0, `${id} absent sans motif`);
  }
  // ARCH-3 : les clés vivent dans leur zone, et ouvrent quelque chose.
  for (const key of ['K_SEAL', 'K_S3', 'K_VAULT', 'K_OVH'])
    assert.ok(arch.edges.some(edge => edge.source === key), `${key} n’ouvre rien`);
  // ARCH-6 : GitHub Actions est là, déclencheur et exécutant.
  assert.ok(arch.edges.some(edge => edge.source === 'OWNER' && edge.target === 'GHA'));
  assert.ok(arch.edges.some(edge => edge.source === 'GHA'));
  // Le nord entre dans le cluster (Traefik, puis l'IdP) ; le sud agit sur le cluster.
  assert.ok(arch.edges.some(edge => edge.source === 'USER' && edge.target === 'PF'));
  assert.ok(arch.edges.some(edge => edge.source === 'USER' && edge.target === 'IDP'));
  assert.ok(arch.edges.some(edge => edge.source === 'ADMIN' && edge.target === 'PF'));
  // Le « Coordinateur immo » a disparu de toutes les scènes (PROC-1).
  for (const graph of graphs) for (const node of graph.nodes)
    assert.ok(!/coordinateur/i.test(`${node.metadata.role} ${node.metadata.name}`), `${graph.id}/${node.id}`);
});

test('scène 2 : les quatre déclencheurs, chacun avec son exécutant réel', () => {
  const seq = graphs.find(graph => graph.id === 'sequence-bout-en-bout');
  assert.deepEqual(groupIds(seq), ['DECL', 'PASSAGE', 'SINISTRE', 'REPRISE']);
  // Le plan précède les trois chemins : aucun n'est atteint sans garde-fou.
  for (const first of ['A_STOP', 'B_TFU', 'R_SCOPE'])
    assert.ok(seq.edges.some(edge => edge.source === 'D_PLAN' && edge.target === first), first);
  // P-bi : les étapes de reprise sont enchaînées, cluster neuf d'abord.
  const chain = ['B_TFU', 'B_PLAT', 'B_TEN', 'B_DNS', 'B_DATA', 'B_APP'];
  for (let i = 1; i < chain.length; i++)
    assert.ok(seq.edges.some(edge => edge.source === chain[i - 1] && edge.target === chain[i] && edge.label), chain[i]);
  // P-bii : geo avant immo (immo dépend de exports/immo/, geo ne dépend pas d'immo).
  assert.ok(seq.edges.some(edge => edge.source === 'R_GEO' && edge.target === 'R_IMMO'));
  // Chaque carte nomme un exécutant réel, jamais un rôle flou.
  for (const node of seq.nodes) assert.ok(roleIsShort(node.metadata.role) && node.metadata.role.length > 0, node.id);
});

test('scène 3 : lot 0 avant tout, puis les lots, puis les neuf exercices', () => {
  const path = graphs.find(graph => graph.id === 'mise-en-service');
  assert.deepEqual(groupIds(path), ['URGENCE', 'LOTS', 'PREUVES']);
  // A1 est une action datée, et elle vient avant Q0 : la rotation n'attend pas.
  assert.ok(path.edges.some(edge => edge.source === 'A1_KEYS' && edge.target === 'Q0_GO'));
  assert.match(byId(path, 'A1_KEYS').metadata.name + byId(path, 'A1_KEYS').metadata.detail, /rotation|22\/09/);
  // Les six lots sont là, dans l'ordre.
  const lots = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
  for (let i = 1; i < lots.length; i++)
    assert.ok(path.edges.some(edge => edge.source === lots[i - 1] && edge.target === lots[i]), lots[i]);
  // Les neuf exercices E1 à E9 sont tous présents.
  for (let n = 1; n <= 9; n++) assert.ok(byId(path, `E${n}`), `E${n} absent`);
});

test('gabarit unique A’ 460 x 200 et rôles « deux par deux »', () => {
  assert.deepEqual(CARD, { width: 460, height: 200 });
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

// ARCH-7 : la suppression de Graphviz est une exigence de l'owner, donc un contrôle,
// pas une intention. Aucun fichier de la chaîne ne doit plus le mentionner.
test('ARCH-7 : plus aucune trace du rendu Graphviz dans la chaîne', async () => {
  // Ce fichier-ci est exclu du balayage : il nomme forcément ce qu'il interdit.
  const files = (await readdir('.')).filter(name => /\.(mjs|js|svelte|json)$/.test(name)
    && !['package-lock.json', 'mapping.test.mjs'].includes(name));
  for (const name of files) {
    const source = await readFile(name, 'utf8');
    for (const [line, text] of source.split('\n').entries()) {
      if (!/graphviz|gvLayout|hpcc|\bdot\b/i.test(text)) continue;
      // Seules les mentions qui disent la suppression sont admises.
      assert.match(text, /supprimé|retiré|ARCH-7/, `${name}:${line + 1} mentionne encore Graphviz : ${text.trim().slice(0, 100)}`);
    }
  }
  assert.equal(manifest.graphvizVersion, undefined, 'le manifeste porte encore une version Graphviz');
  assert.deepEqual(Object.keys(manifest.layoutOptions), ['elk']);
  for (const graph of graphs) assert.equal(graph.graphviz, undefined, `${graph.id} porte encore un rendu Graphviz`);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['elkjs']);
});

// Les placements stockés dans data.json sont re-contrôlés ici, sur la géométrie
// exacte que la page affiche : extrémités sur le bord, milieu du bord pour une
// carte à liaison unique, aucun croisement de boîte non concernée, étiquettes sur
// leur trait, rapport largeur / hauteur entre 4:3 et 16:9.
const parentOf = graph => new Map([...graph.groups, ...graph.nodes].map(item => [item.id, item.parent]));
const ancestors = (graph, id) => { const map = parentOf(graph), out = []; let p = map.get(id); while (p) { out.push(p); p = map.get(p); } return out; };
const boxesOf = graph => graph.elk.boxes.map(box => ({ id: box.id, ...box.absolute, width: box.width, height: box.height,
  ancestors: ancestors(graph, box.id), group: graph.groups.some(group => group.id === box.id) }));

test('placement ELK : contrôles de l’owner sur les trois scènes', () => {
  for (const graph of graphs) {
    const boxes = boxesOf(graph);
    const edges = graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, ...graph.elk.edges.find(route => route.id === edge.id) }));
    // Rapport pris sur l'emprise des boîtes et des étiquettes, comme dans Chromium.
    const all = [...boxes, ...edges.filter(edge => edge.label).map(edge => edge.label)];
    const canvas = { width: Math.max(...all.map(box => box.x + box.width)) - Math.min(...all.map(box => box.x)),
      height: Math.max(...all.map(box => box.y + box.height)) - Math.min(...all.map(box => box.y)) };
    const result = checkGeometry({ boxes, edges, canvas });
    assert.deepEqual(result.faults, [], `${graph.id} : ${result.faults.join(' ; ')}`);
    assert.ok(result.ratio >= RATIO.min && result.ratio <= RATIO.max);
    // Aucune carte ne chevauche une autre.
    const cards = boxes.filter(box => graph.nodes.some(node => node.id === box.id));
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      assert.ok(!(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y), `${a.id}/${b.id}`);
    }
  }
});

// Le plan que l'owner a lui-même donné, bloc par bloc (DOSSIER_PRA_V3_LAYOUT_SPEC,
// 2026-09-20), contrôlé **sur le rendu** et non sur l'intention : utilisateur au
// nord, administration au sud, quatre colonnes entre les deux, et dans chaque
// conteneur nommé l'ordre qu'il a donné. S'y ajoute la porte de grille de la
// version précédente — aucun conteneur de quatre cartes ou plus sur une seule
// colonne, sauf ceux que le plan range lui-même à la verticale.
test('scène 1 : le plan de l’owner tenu sur le rendu, bloc par bloc', () => {
  const arch = graphs.find(graph => graph.id === 'architecture-sauvegardes');
  const boxes = boxesOf(arch);
  const box = id => boxes.find(item => item.id === id);
  // Contrôle d'ensemble : nord, sud, ordre des colonnes, ordre dans chaque feuille.
  assert.deepEqual(checkPlan(boxes, FRAME_FACES[arch.id], FRAME_PLAN[arch.id]), [], 'plan non tenu');
  const [user, admin] = ['USER', 'SUD_ADMIN'].map(box);
  const outside = face => boxes.filter(item => item.id !== face.id && !item.ancestors.includes(face.id));
  assert.ok(user.y + user.height <= Math.min(...outside(user).map(item => item.y)) + 1, 'utilisateur pas au nord');
  assert.ok(admin.y >= Math.max(...outside(admin).map(item => item.y + item.height)) - 1, 'administration pas au sud');
  // Les quatre colonnes, chacune entièrement à l'ouest de la suivante, contenu compris.
  const band = FRAME_FACES[arch.id].band;
  const inside = id => boxes.filter(item => item.id === id || item.ancestors.includes(id));
  for (let index = 1; index < band.length; index++)
    assert.ok(Math.max(...inside(band[index - 1]).map(item => item.x + item.width))
      <= Math.min(...inside(band[index]).map(item => item.x)) + 1, `${band[index - 1]} pas à l’ouest de ${band[index]}`);
  // §2 du plan : dans chaque tenant, la préproduction à l'ouest et la production à l'est.
  for (const [pp, pr] of [['immo_pp', 'immo_pr'], ['geo_pp', 'geo_pr']])
    assert.ok(box(pp).x + box(pp).width <= box(pr).x + 1, `${pp} pas à l’ouest de ${pr}`);
  // §2 du plan : immo au nord, geo au centre, plateforme partagée au sud.
  for (const [north, south] of [['immo_tenant', 'geo_tenant'], ['geo_tenant', 'PLATEFORME']])
    assert.ok(box(north).y + box(north).height <= box(south).y + 1, `${north} pas au nord de ${south}`);
  // §2 du plan : la plateforme partagée « sur toute la largeur » — aussi large que
  // le plus large des deux tenants qu'elle porte.
  assert.ok(box('PLATEFORME').width >= Math.max(box('immo_tenant').width, box('geo_tenant').width) - 2,
    'plateforme partagée pas sur toute la largeur');
  // §3 du plan : immo au nord (préprod nord-nord, prod nord-sud), geo au centre
  // (préprod centre-nord, prod centre-sud), clés tout au sud.
  for (const [north, south] of [['S3_IMMO', 'S3_GEO'], ['S3_GEO', 'CLES_S3'],
    ['S3_IMMO_PP', 'S3_IMMO_PR'], ['S3_GEO_PP', 'S3_GEO_PR']])
    assert.ok(box(north).y + box(north).height <= box(south).y + 1, `${north} pas au nord de ${south}`);
  // §1 et §4 du plan : GitHub, hors GitHub et la réplication verticales, au sens du
  // rendu — jamais deux cartes côte à côte sur une même rangée.
  for (const id of ['GH_PILOTAGE', 'HORS_GH', 'EXT_REGION'])
    assert.equal(columnsOf(boxes, id), 1, `${id} pas verticale`);
  // Correction de l'owner : « place gh en dessous de hors gh ». Dans la colonne de
  // pilotage, hors GitHub est au-dessus de GitHub, les deux dans la même colonne.
  const [horsGh, ghPil] = ['HORS_GH', 'GH_PILOTAGE'].map(box);
  assert.ok(horsGh.y + horsGh.height <= ghPil.y + 1, 'hors GitHub pas au-dessus de GitHub');
  assert.ok(horsGh.x < ghPil.x + ghPil.width && ghPil.x < horsGh.x + horsGh.width, 'pilotage pas empilé sur une colonne');
  for (const id of ['HORS_GH', 'GH_PILOTAGE']) assert.ok(ancestors(arch, id).includes('Z_GHX'), `${id} hors de la colonne de pilotage`);
  // Dernier ajustement de l'owner : « [Administration et coffre] devrait être
  // 100 % horizontalisée ». Le pendant sud de la case utilisateur — une seule
  // rangée : les quatre cartes alignées en haut (une seule bande y), étalées en x,
  // jamais l'une sous l'autre.
  const adminCards = boxes.filter(box => !box.group && box.ancestors[0] === 'SUD_ADMIN');
  assert.equal(adminCards.length, 4);
  assert.equal(columnsOf(boxes, 'SUD_ADMIN'), 4, 'administration pas sur une seule rangée de quatre');
  const adminYs = adminCards.map(card => card.y);
  assert.ok(Math.max(...adminYs) - Math.min(...adminYs) < 1, 'les cartes d’administration ne sont pas alignées sur une rangée');
  for (let i = 0; i < adminCards.length; i++) for (let j = i + 1; j < adminCards.length; j++) {
    const [x, y] = [adminCards[i], adminCards[j]];
    assert.ok(!(x.x < y.x + y.width - 1 && x.x + x.width > y.x + 1), `SUD_ADMIN : ${x.id} et ${y.id} se chevauchent en x`);
  }
  // La colonne GitHub porte les workflows et l'alerte émise par GitHub, et rien
  // d'autre ; la colonne hors GitHub, le courriel et le DNS — « séparées bien ».
  assert.deepEqual(boxes.filter(box => !box.group && box.ancestors[0] === 'GH_PILOTAGE').map(box => box.id).sort(),
    ['ALT_GH', 'GHA', 'GHA_CD']);
  assert.deepEqual(boxes.filter(box => !box.group && box.ancestors[0] === 'HORS_GH').map(box => box.id).sort(),
    ['ALT_TEM', 'CF_LE']);
  // Porte de grille, moins les conteneurs que le plan verticalise lui-même.
  assert.deepEqual(checkGrid(boxes, GRID, gridExempt(arch.id)), [], 'conteneur rangé sur une colonne');
  assert.deepEqual(GRID, { minCards: 4, minColumns: 2 });
  assert.ok(gridExempt(arch.id).has('EXT_REGION'), 'la dérogation de grille n’est pas déclarée');
  // Les deux environnements du tenant immo, nommément visés par l'owner en v2.
  assert.ok(columnsOf(boxes, 'immo_pp') >= 2, 'préproduction immo sur une colonne');
  assert.ok(columnsOf(boxes, 'immo_pr') >= 2, 'production immo sur une colonne');
  // La mesure publiée au manifeste est celle du rendu.
  const recorded = manifest.layoutMetrics[arch.id].elk;
  assert.deepEqual(recorded.grid.faults, []);
  assert.deepEqual(recorded.plan.faults, []);
  assert.deepEqual(recorded.plan.faces, FRAME_FACES[arch.id]);
  for (const [id, columns] of Object.entries(recorded.grid.columns))
    assert.equal(columns, columnsOf(boxes, id), id);
});

test('une seule description : le rendu porte exactement les cartes, conteneurs et liaisons du graphe', () => {
  for (const graph of graphs) {
    const ids = [...graph.groups, ...graph.nodes].map(item => item.id).sort();
    assert.deepEqual(graph.elk.boxes.map(box => box.id).sort(), ids);
    assert.deepEqual(graph.elk.edges.map(edge => edge.id).sort(), graph.edges.map(edge => edge.id).sort());
  }
});

// Lisibilité : la mesure du build est recalculée ici sur la géométrie exacte que la
// page affiche ; une scène sous la porte n'est admise que par dérogation explicite.
test('lisibilité : portes ratifiées 12 px, 8 pt lecture et 7 pt annotation secondaire', () => {
  assert.deepEqual(LEGIBILITY, { minPx: 12, minPt: 8, minPtAnnotation: 7, annotationRoles: ['liaison'] });
  assert.deepEqual(Object.keys(FORMATS), ['1440x900', '1920x1080', 'A4-paysage']);
  assert.equal(printGateFor('liaison'), 7);
  assert.equal(printGateFor('detail'), 8);
  // Modèle d'ajustement de xyflow : marge de 0,08 convertie en pixels entiers.
  assert.equal(fitScale({ width: 1247, height: 668 }, '1440x900', 'elk'), 1);
  const faults = [];
  for (const graph of graphs) {
    const elk = legibilityFrom({ boxes: boxesOf(graph) }, graph.elk.canvas, 'elk');
    const recorded = manifest.layoutMetrics[graph.id];
    for (const measure of elk.formats) {
      const stored = recorded.elk.legibility.formats.find(item => item.format === measure.format);
      assert.ok(Math.abs(stored.minPx - measure.minPx) < 1e-9, `${graph.id} ${measure.format}`);
    }
    for (const measure of recorded.elk.legibility.formats) {
      const format = FORMATS[measure.format];
      const expected = format.gate && (format.medium === 'screen'
        ? measure.minPx < LEGIBILITY.minPx
        : Object.entries(measure.byRolePx).some(([role, px]) => px * PT_PER_PX < printGateFor(role)));
      assert.equal(measure.faults.length > 0, expected, `${graph.id}/${measure.format}`);
      faults.push(...measure.faults);
    }
  }
  assert.equal(manifest.legibility.faults.length, faults.length);
  if (faults.length) assert.ok(manifest.legibility.derogation?.length > 10, 'porte de lisibilité non tenue sans dérogation motivée');
});

test('réglages retenus : ceux que le balayage de lisibilité a choisis', async () => {
  const sweep = JSON.parse(await readFile('../preuves/balayage-lisibilite.json', 'utf8'));
  for (const graph of graphs) {
    assert.deepEqual(manifest.layoutOptions.elk[graph.id], sweep.winners[graph.id].elk, `${graph.id} ELK`);
    assert.equal(sweep.winners[graph.id].graphviz, undefined, `${graph.id} : le balayage porte encore Graphviz`);
    // Chaque placement retenu est mesuré au build comme dans le balayage.
    const px = manifest.layoutMetrics[graph.id].elk.legibility.formats.find(item => item.format === '1440x900').minPx;
    assert.ok(Math.abs(px - sweep.retained[graph.id].elk.px1440) < 0.001, `${graph.id} : ${px}`);
  }
});

test('étape 1 : ZÉRO question, le design est statué et les deux étapes sont nettes', () => {
  // Règle dure du dossier étape 1 : aucune question. Le design est tranché.
  assert.deepEqual(questions, [], 'le dossier étape 1 pose encore une question');
  // Le principe porte la première vague : on sauvegarde la prod seule, la préprod
  // se reconstruit depuis la prod (iso-prod).
  assert.match(principe.body, /production seule/i);
  assert.match(principe.body, /reconstruite depuis la prod|iso-prod/i);
  // La cible de la semaine : prod → préprod en place, et restore prod → prod borné.
  assert.equal(cible.items.length, 2);
  assert.match(cible.items[0], /prod\s*→\s*préprod/i);
  assert.match(cible.items[1], /restore prod\s*→\s*prod/i);
  assert.match(cible.items[1], /RTO|< ?2 ?h/i);
  // Étape 1 « ce qu'on fait maintenant » : les décisions statuées, dont le flip du
  // repoint à 0, la bascule prod → préprod et le RTO borné, et les creds par la lane.
  assert.match(etape1.title, /maintenant/i);
  const d1 = etape1.decisions.map(decision => `${decision.title} ${decision.detail}`).join(' ');
  assert.match(d1, /GEO_DOCUMENTS_REPOINT=0/);
  assert.match(d1, /1\s*→\s*0/);
  assert.match(d1, /lane k8s/i);
  assert.match(d1, /feat\/backup-pra-698/);
  // Propriété clé du design : scripts natifs immo, en CI, rejouables sans IA (OPS-3).
  assert.match(d1, /natif/i);
  assert.match(d1, /sans IA|OPS-3/i);
  assert.match(d1, /CI immo|en CI/i);
  // Aucune décision de l'étape 1 n'est présentée comme une question ni comme un choix
  // « recommandé » : ce sont des faits statués.
  for (const decision of etape1.decisions) {
    assert.ok(decision.key && decision.title && decision.detail, 'décision incomplète');
    assert.ok(!/\?$/.test(decision.title.trim()), `${decision.key} : une décision est formulée en question`);
    assert.ok(!/recommandé/i.test(decision.title), `${decision.key} : une décision est présentée comme « recommandée »`);
  }
  // Prêt vs à construire : factuel, sans question.
  assert.ok(pretVsConstruire.pret.length >= 3 && pretVsConstruire.aConstruire.length >= 2);
  assert.match(pretVsConstruire.aConstruire.join(' '), /radar-backup/);
  // Étape 2 « ce qu'il faudra faire après » : le PRA conforme, listé, jamais posé.
  assert.match(etape2.title, /après/i);
  const later = etape2.items.join(' ');
  for (const topic of [/Object Lock|verrou d.objet/i, /RPO 24 ?h/i, /hors-région|externalisation/i, /PRA complet/i])
    assert.match(later, topic);
  for (const item of etape2.items) assert.ok(!/\?$/.test(item.trim()), 'un point de l’étape 2 est posé en question');
});

test('l’enregistrement exporté est un design statué, relu par l’owner avant commit, sans aucune question', () => {
  const record = decisionRecord(manifest, null);
  assert.equal(record.schema, 'immo-712-backup-pra-etape1-decisions/v1');
  assert.match(record.status, /statué/i);
  assert.deepEqual(record.questions, []);
  assert.ok(record.principe && record.cible && record.etape1 && record.etape2 && record.pretVsConstruire);
  // Aucune action au chargement : l'enregistrement le dit.
  assert.match(record.authority, /aucune fusion|aucun déploiement|aucun événement track/i);
});
