// Balayage de lisibilité : pour chaque scène, un jeu borné de réglages natifs
// d'ELK. Chaque candidat est placé par le moteur, passé aux portes géométriques
// de geometry-check.mjs, puis mesuré : taille effective du plus petit texte une
// fois la scène ajustée à la vue, aux formats 1440 × 900, 1920 × 1080 et A4
// paysage (mêmes fonctions que le build et que le contrôle Chromium).
//
// Règle de choix, écrite une fois ici : parmi les candidats qui passent toutes les
// portes géométriques, on retient celui dont la marge la plus faible aux portes de
// lisibilité ratifiées est la plus grande, soit
//   score = min(texte min à 1440 × 900 / 12 px ; min sur les rôles de A4 (pt / porte du rôle)),
// la porte d'impression valant 8 pt pour le texte de lecture et 7 pt pour
// l'annotation secondaire (étiquette de liaison).
// Égalité : texte min à 1920 × 1080, puis moins de coudes, puis liaisons plus
// courtes, puis ordre du balayage. Aucun réglage n'est choisi à la main.
//
// ELK, deux passes bornées : (1) la structure — mode, direction, stratégie de
// couches, écarts entre couches et entre nœuds, placement des nœuds, repliement ;
// (2) autour des trois meilleurs de (1), les réglages fins — étiquettes en ligne,
// couche des étiquettes, compaction après placement, espacements des liaisons et
// des composantes, rapport d'aspect cible.
// Le moteur Graphviz dot a été retiré du balayage avec le rendu (ARCH-7).
//
// Exclu : la stratégie de couches STRETCH_WIDTH d'ELK, qui ne termine pas sur la
// scène d'architecture (constaté : plus de 20 s sans résultat sur un seul placement).
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseMermaid } from '../../../../architecture/focus/parse-mermaid.mjs';
import { decorateGraph, sceneIds } from './scene-metadata.js';
import { elkLayout, ELK_DEFAULTS, ELK_KNOBS, FRAME_FACES, FRAME_PLAN, gridExempt } from './elk-layout.mjs';
import { checkGeometry, checkGrid, checkPlan, geometryFrom, legibilityFrom, LEGIBILITY, GRID, PT_PER_PX, printGateFor } from './geometry-check.mjs';

const markdown = await readFile('../DOSSIER_DECISION_BACKUP_PRA_V2_2026-09-18.md', 'utf8');
const graphs = [...markdown.matchAll(/### `([^`]+)` — ([^\n]+)\n\n```mermaid\n([\s\S]*?)```/g)]
  .map(match => decorateGraph(parseMermaid(match[3], match[1], match[2], 'decision', '2026-09-18')));
if (JSON.stringify(graphs.map(graph => graph.id)) !== JSON.stringify(sceneIds)) throw Error('scènes inattendues');
const only = process.env.SWEEP_SCENE;

const product = grid => Object.entries(grid).reduce((all, [key, values]) => all.flatMap(item => values.map(value => ({ ...item, [key]: value }))), [{}]);
const key = options => JSON.stringify(Object.keys(options).sort().map(name => [name, options[name]]));
// `ptMargin` : la plus faible marge d'impression sur l'ensemble des rôles, chaque
// rôle rapporté à sa propre porte (8 pt lecture, 7 pt annotation secondaire).
const score = row => Math.min(row.px1440 / LEGIBILITY.minPx, row.ptMargin);
const better = (a, b) => score(b) - score(a) || b.px1920 - a.px1920 || a.bends - b.bends || a.lengthPx - b.lengthPx || a.order - b.order;

// Espacements des liaisons et des composantes, par paire cohérente.
const SPACING = { standard: { edgeLayerGap: 30, edgeNodeGap: 30, edgeGap: 20, componentGap: 60 },
  serre: { edgeLayerGap: 15, edgeNodeGap: 15, edgeGap: 10, componentGap: 24 } };
const ELK_STAGE1 = [
  ...product({ mode: ['include'], direction: ['DOWN', 'RIGHT'],
    layering: ['NETWORK_SIMPLEX', 'COFFMAN_GRAHAM/3', 'MIN_WIDTH'],
    layerGap: [30, 60, 120, 220], nodeGap: [24, 48], placement: ['NETWORK_SIMPLEX', 'BRANDES_KOEPF', 'LINEAR_SEGMENTS'] }),
  ...product({ mode: ['ports'], direction: ['DOWN', 'RIGHT'], inner: ['DOWN', 'RIGHT'],
    wrap: ['OFF', 'MULTI_EDGE/1', 'MULTI_EDGE/2', 'MULTI_EDGE/3', 'MULTI_EDGE/4.5'],
    layerGap: [30, 60, 120], rootLayerGap: [30, 90], nodeGap: [24, 48] }),
];
const ELK_STAGE2 = product({ placement: ['NETWORK_SIMPLEX', 'BRANDES_KOEPF', 'LINEAR_SEGMENTS'], inline: [false, true],
  labelLayer: ['MEDIAN_LAYER', 'SPACE_EFFICIENT_LAYER'], compaction: ['NONE', 'EDGE_LENGTH'],
  spacing: ['standard', 'serre'], aspectRatio: [null, 1.78] });

// Scène 1 : la mise en page est arbitrée par l'owner — utilisateur au nord,
// administration au sud, pilotage à l'ouest, stockage à l'est. Aucun des deux
// autres modes ne la tient (ELK layered place par le flux, pas par les points
// cardinaux), donc le balayage de cette scène ne porte que sur le mode `frame`,
// qui la tient par construction : il choisit les réglages DANS la mise en page,
// il ne choisit pas la mise en page. Le placement d'avant, en mode `include`,
// reste mesuré ligne « avant », pour que le coût de la mise en page soit publié.
// Depuis le plan imposé (2026-09-20), le sens et le rapport d'aspect des
// conteneurs de feuilles ne sont plus des réglages de scène : le cadre les balaie
// lui-même, conteneur par conteneur, et retient le mélange qui l'arrange
// (elk-layout.mjs, « mélanges »). Le balayage ne porte donc plus que sur ce qui
// reste global : le découpage par ports, les espacements, le placement et le
// rapport visé au plus haut.
const FRAME_STAGE1 = product({ mode: ['frame'], direction: ['RIGHT'], inner: ['RIGHT', 'DOWN'],
  split: ['all'], portSide: ['free', 'fixed'], layerGap: [30, 60], nodeGap: [24, 48] });
const FRAME_STAGE2 = product({ placement: ['NETWORK_SIMPLEX', 'BRANDES_KOEPF', 'LINEAR_SEGMENTS'],
  compaction: ['NONE', 'EDGE_LENGTH'], spacing: ['standard', 'serre'],
  frameMargin: [16, 24, 40], ratioHigh: [1.7478, 1.775] });
const FRAMED = sceneId => Boolean(FRAME_FACES[sceneId]);
const stage1For = sceneId => FRAMED(sceneId) ? FRAME_STAGE1 : ELK_STAGE1;
const stage2For = sceneId => FRAMED(sceneId) ? FRAME_STAGE2 : ELK_STAGE2;
// Candidat écrit en réglages natifs : les valeurs composées sont dépliées.
const elkOptions = (candidate, sceneId) => {
  const out = { ...candidate, rootPadding: 12 };
  // Mode `frame` : les faces viennent de la mise en page arbitrée, pas du balayage ;
  // la marge des couloirs autour des étiquettes est fixe (24 px).
  if (candidate.mode === 'frame' || FRAMED(sceneId)) {
    out.frame = FRAME_FACES[sceneId]; out.plan = FRAME_PLAN[sceneId]; out.frameMargin = candidate.frameMargin ?? 24;
  }
  if (candidate.layering) { const [layering, bound] = candidate.layering.split('/'); out.layering = layering; out.layerBound = bound ? Number(bound) : null; }
  if (candidate.wrap) { const [wrap, ratio] = candidate.wrap.split('/'); out.wrap = wrap; if (ratio) out.innerRatio = Number(ratio); }
  if (candidate.spacing) { Object.assign(out, SPACING[candidate.spacing]); delete out.spacing; }
  return out;
};

async function measure(graph, engine, options, order, stage) {
  const row = { scene: graph.id, engine, stage, order, options };
  try {
    // Réglages exacts du candidat : ceux de la scène ne s'y mêlent pas.
    const layout = await elkLayout(graph, options, { base: {} });
    const geometry = geometryFrom(graph, layout);
    const check = checkGeometry(geometry);
    // Mise en page arbitrée : sur une scène à cadre, un conteneur de quatre cartes
    // ou plus rangé sur une seule colonne est refusé comme une faute géométrique.
    if (FRAMED(graph.id)) check.faults.push(...checkGrid(geometry.boxes, GRID, gridExempt(graph.id)),
      ...checkPlan(geometry.boxes, FRAME_FACES[graph.id], FRAME_PLAN[graph.id]));
    const frame = layout.canvas;
    const legibility = legibilityFrom(geometry, frame, engine);
    const at = format => legibility.formats.find(item => item.format === format);
    const a4 = at('A4-paysage');
    const ptMargin = Math.min(...Object.entries(a4.byRolePx).map(([role, px]) => px * PT_PER_PX / printGateFor(role)));
    Object.assign(row, { faults: check.faults.length, fault: check.faults[0] ?? null,
      px1440: at('1440x900').minPx, detail1440: at('1440x900').byRolePx.detail, px1920: at('1920x1080').minPx,
      ptA4: a4.minPx * PT_PER_PX, ptMargin, fillBlocks: legibility.fill.blocks, fillCards: legibility.fill.cards,
      frame: { width: frame.width, height: frame.height }, ratio: check.ratio, bends: check.bends, lengthPx: check.lengthPx });
  } catch (error) {
    Object.assign(row, { faults: 1, fault: `moteur : ${String(error.message ?? error).split('\n')[0].slice(0, 120)}`,
      px1440: 0, detail1440: 0, px1920: 0, ptA4: 0, ptMargin: 0, fillBlocks: 0, fillCards: 0, frame: null, ratio: 0, bends: 0, lengthPx: 0 });
  }
  row.score = score(row);
  return row;
}

// Réglages d'avant ce balayage (lane précédente), mesurés de la même façon, pour référence.
const PREVIOUS = {
  elk: {
    // Repère « avant » : la scène 1 laissée au moteur seul (hiérarchie incluse,
    // aucune face, aucun plan), sur la même description. C'est le coût de la mise
    // en page imposée qui se lit dans l'écart avec la ligne retenue.
    'architecture-sauvegardes': { mode: 'include', direction: 'RIGHT', layerGap: 120, placement: 'LINEAR_SEGMENTS',
      rootPadding: 12, edgeLayerGap: 15, edgeNodeGap: 15, edgeGap: 10, componentGap: 24 },
    'sequence-bout-en-bout': { mode: 'ports', direction: 'DOWN', inner: 'RIGHT', wrap: 'MULTI_EDGE', innerRatio: 4.5, layerGap: 350 },
    'mise-en-service': { mode: 'ports', direction: 'DOWN', inner: 'RIGHT', wrap: 'MULTI_EDGE', innerRatio: 3, layerGap: 300 },
  },
};
const rows = [], retained = {}, before = {};
let order = 0;
for (const graph of graphs.filter(item => !only || item.id === only)) {
  const started = Date.now();
  before[graph.id] = { elk: await measure(graph, 'elk', { ...ELK_DEFAULTS, ...PREVIOUS.elk[graph.id] }, -1, 'avant') };
  const seen = new Set();
  const elkRows = [];
  for (const candidate of stage1For(graph.id)) {
    const options = elkOptions(candidate, graph.id);
    if (seen.has(key(options))) continue; seen.add(key(options));
    elkRows.push(await measure(graph, 'elk', options, order++, 1));
  }
  const seeds = elkRows.filter(row => !row.faults).sort(better).slice(0, 3);
  for (const seed of seeds) for (const fine of stage2For(graph.id)) {
    const options = { ...seed.options, ...elkOptions(fine, graph.id) };
    if (seen.has(key(options))) continue; seen.add(key(options));
    elkRows.push(await measure(graph, 'elk', options, order++, 2));
  }
  retained[graph.id] = {};
  for (const [engine, list] of [['elk', elkRows]]) {
    const ranked = list.filter(row => !row.faults).sort(better);
    ranked.forEach((row, index) => { row.rank = index + 1; });
    retained[graph.id][engine] = ranked[0] ?? null;
    rows.push(...list);
  }
  console.error(`${graph.id} : ${elkRows.length} candidats ELK, ${Date.now() - started} ms`);
}

// Réglages retenus, sans les valeurs par défaut, tels qu'ils vont dans SCENE_OPTIONS / GV_OPTIONS.
const strip = (options, defaults) => Object.fromEntries(Object.entries(options).filter(([name, value]) => defaults[name] !== value && value !== null));
const winners = Object.fromEntries(Object.entries(retained).map(([id, engines]) => [id, {
  elk: engines.elk && strip(engines.elk.options, ELK_DEFAULTS) }]));
const round = value => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
const compact = row => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, name === 'options' ? value : round(value)]));
await mkdir('.generated', { recursive: true });
await writeFile('.generated/balayage-lisibilite.json', `${JSON.stringify({
  rule: 'score = min(texte min 1440x900 / 12 px ; min sur les rôles A4 de pt / porte du rôle, 8 pt lecture et 7 pt annotation secondaire), candidats aux portes géométriques vertes ; égalité : 1920x1080, coudes, longueur, ordre',
  gate: LEGIBILITY,
  knobs: ELK_KNOBS, spacingBundles: SPACING, excluded: ['elk.layered.layering.strategy = STRETCH_WIDTH : ne termine pas (architecture)',
    'Graphviz dot : rendu supprimé du dossier (ARCH-7), retiré du balayage'],
  winners, before: Object.fromEntries(Object.entries(before).map(([id, engines]) => [id, { elk: compact(engines.elk) }])),
  retained: Object.fromEntries(Object.entries(retained).map(([id, engines]) => [id, { elk: engines.elk && compact(engines.elk) }])),
  counts: Object.fromEntries(graphs.filter(item => !only || item.id === only).map(graph => [graph.id, Object.fromEntries(['elk'].map(engine => {
    const list = rows.filter(row => row.scene === graph.id && row.engine === engine);
    return [engine, { candidates: list.length, passGeometry: list.filter(row => !row.faults).length,
      passLegibility: list.filter(row => !row.faults && row.px1440 >= LEGIBILITY.minPx && row.ptMargin >= 1).length,
      bestIgnoringGeometry: round(Math.max(...list.map(row => row.px1440))) }];
  }))])),
  top: Object.fromEntries(Object.keys(retained).map(id => [id, Object.fromEntries(['elk'].map(engine => [engine,
    rows.filter(row => row.scene === id && row.engine === engine && !row.faults).sort(better).slice(0, 20).map(compact)]))])),
}, null, 1)}\n`);

// Tableau publié : une ligne par candidat (CSV), et un résumé lisible (Markdown).
const optionValue = value => Array.isArray(value) ? value.join('+') || '∅'
  : value && typeof value === 'object' ? Object.entries(value).map(([name, item]) => `${name}:${item}`).join('/') : value;
const optionText = options => Object.entries(options).filter(([, value]) => value !== null && value !== undefined)
  .map(([name, value]) => `${name}=${optionValue(value)}`).join(' ');
const csv = ['scene,moteur,passe,rang,score,texte_min_1440x900_px,detail_1440x900_px,texte_min_1920x1080_px,texte_min_A4_pt,remplissage_blocs,remplissage_cartes,rapport_cadre,coudes,portes_geometriques,reglages',
  ...[...Object.values(before).map(engines => engines.elk), ...rows].map(row => [row.scene, row.engine, row.stage, row.rank ?? '', row.score.toFixed(3),
    row.px1440.toFixed(2), row.detail1440.toFixed(2), row.px1920.toFixed(2), row.ptA4.toFixed(2), row.fillBlocks.toFixed(3), row.fillCards.toFixed(3),
    row.ratio.toFixed(3), row.bends, row.faults ? `"${String(row.fault).replaceAll('"', "'")}"` : 'vertes', `"${optionText(row.options)}"`].join(','))].join('\n');
await writeFile('.generated/balayage-lisibilite.csv', `${csv}\n`);
const fmt = (value, digits = 2) => value.toFixed(digits).replace('.', ',');
const line = row => `| ${row.rank ?? row.stage} | ${fmt(row.score, 3)} | ${fmt(row.px1440)} | ${fmt(row.detail1440)} | ${fmt(row.px1920)} | ${fmt(row.ptA4)} | ${fmt(row.fillBlocks * 100, 0)} % | ${fmt(row.fillCards * 100, 0)} % | ${fmt(row.ratio)} | ${row.bends} | ${row.faults ? row.fault : 'vertes'} | \`${optionText(row.options)}\` |`;
const head = '| rang | score | min 1440×900 (px) | détail 1440×900 (px) | min 1920×1080 (px) | min A4 (pt) | remplissage blocs | remplissage cartes | rapport | coudes | portes géométriques | réglages |\n|---|---|---|---|---|---|---|---|---|---|---|---|';
const md = ['# Balayage de lisibilité — tableau', '',
  `Règle : ${'parmi les candidats aux portes géométriques vertes, score = min(texte min à 1440×900 / 12 px ; min sur les rôles A4 de pt / porte du rôle — 8 pt lecture, 7 pt annotation secondaire), le plus grand retenu'}.`,
  'Moteur unique : ELK. Le rendu Graphviz dot a été supprimé du dossier (ARCH-7) et retiré du balayage.',
  'Tableau complet, une ligne par candidat : `balayage-lisibilite.csv`. Ici, par scène : le placement d’avant, les 12 meilleurs, et les 3 meilleurs refusés par une porte géométrique.', ''];
for (const [id, engines] of Object.entries(retained)) for (const engine of ['elk']) {
  const list = rows.filter(row => row.scene === id && row.engine === engine);
  md.push(`## ${id} · ${engine}`, '', `${list.length} candidats · ${list.filter(row => !row.faults).length} aux portes géométriques vertes · ${list.filter(row => !row.faults && row.px1440 >= LEGIBILITY.minPx && row.ptMargin >= 1).length} aux portes de lisibilité vertes.`, '', head,
    line({ ...before[id][engine], rank: 'avant' }),
    ...list.filter(row => !row.faults).sort(better).slice(0, 12).map(line),
    ...list.filter(row => row.faults).sort(better).slice(0, 3).map(row => line({ ...row, rank: 'refusé' })), '');
}
await writeFile('.generated/balayage-lisibilite.md', `${md.join('\n')}\n`);
console.log(JSON.stringify(winners));
for (const [id, engines] of Object.entries(retained)) for (const engine of ['elk']) {
  const row = engines[engine], old = before[id][engine];
  console.log(`${id}/${engine} : avant ${fmt(old.px1440)} px · ${fmt(old.ptA4)} pt → retenu ${row ? `${fmt(row.px1440)} px · ${fmt(row.ptA4)} pt (score ${fmt(row.score, 3)})` : 'aucun candidat'}`);
}
