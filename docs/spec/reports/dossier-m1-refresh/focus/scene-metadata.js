// Contenu des cartes du dossier de décision M1 (v3) — refresh PV.
// Le gabarit, la géométrie et le routage viennent de la chaîne existante
// (`docs/architecture/focus`), qui importe elle-même le kit h2a monté en /kit.
// Ici : uniquement le contenu des deux scènes et le contrôle de contrat.
import { roleIsShort } from '../../../../architecture/focus/scene-metadata.js';

const EVIDENCE = new Set(['observed', 'declared', 'historical', 'dormant', 'unknown', 'external']);
const RUNTIME = new Set(['active', 'suspended', 'dormant', 'manual', 'retained', 'unknown', 'not-applicable']);

const IMMO = ['radar-immobilier'];
const A = (repo, kind, evidenceClass, runtimeState, icon, spec) => ({
  card: 'A', kind, repo: [...repo].sort(), evidenceClass, runtimeState, icon,
  code: spec.code ?? '', role: spec.role ?? '', name: spec.name ?? '', detail: spec.detail ?? '',
});
const BOX = (repo, evidenceClass, runtimeState, spec) => ({
  card: 'box', kind: 'cluster', repo: [...repo].sort(), evidenceClass, runtimeState, icon: 'cluster',
  code: spec.code ?? '', role: '', name: spec.name ?? '', detail: '',
});
const e = (evidenceClass, runtimeState) => ({ evidenceClass, runtimeState });

// Scène 1 — une couche de validation = un conteneur ; ses trois cartes disent ce
// qu'on vérifie, le refus réellement observé sur la campagne v100 (classe et
// effectif) et un exemple réel. Tout vient de §3 du dossier et de `v100/report.md`.
const layer = (index, name) => ({ [`L${index}`]: BOX(IMMO, 'observed', 'active', { code: `L${index}`, name }) });
const CHECK = (index, icon, name, detail) => ({
  [`L${index}_CHK`]: A(IMMO, 'gate', 'declared', 'active', icon,
    { code: `V-${index}`, role: 'Vérifié · porte', name, detail }),
});
const REFUSAL = (index, icon, name, detail) => ({
  [`L${index}_REF`]: A(IMMO, 'refusal', 'observed', 'active', icon,
    { code: `R-${index}`, role: 'Refus · v100', name, detail }),
});
const SAMPLE = (index, icon, name, detail) => ({
  [`L${index}_EX`]: A(IMMO, 'sample', 'historical', 'retained', icon,
    { code: `X-${index}`, role: 'Exemple · réel', name, detail }),
});

// Scène 2 — une carte par campagne : contrat, modèle, plafond, acceptés, latence
// et F1 (ou juges) tenus dans le gabarit A'. Sources : §4 du dossier, tableau
// « Toutes les campagnes v4 → v13 », tableau v14/v15/v16/v100 et `v100/report.md`.
const RUN = (id, evidenceClass, runtimeState, icon, spec) => ({ [id]: A(IMMO, 'campaign', evidenceClass, runtimeState, icon, spec) });
const OPTION = (id, icon, spec) => ({ [id]: A(IMMO, 'option', 'declared', 'dormant', icon, spec) });

const scenes = {
  'chaine-de-mesure': {
    nodes: {
      ...layer(1, '1 · Transport'),
      ...CHECK(1, 'network', 'Le fournisseur a-t-il répondu', 'HTTP, route, identifiant'),
      ...REFUSAL(1, 'check', 'Aucun refus sur 100 PV', '100 HTTP 200 · 0 relance'),
      ...SAMPLE(1, 'api', 'v4 · HTTP 404 NOT_FOUND', 'identifiant absent chez Google'),

      ...layer(2, '2 · JSON normalisé'),
      ...CHECK(2, 'document', 'Le texte est-il du JSON', 'un seul bloc Markdown toléré'),
      ...REFUSAL(2, 'check', 'Aucun refus sur 100 PV', 'brut 2/100 · normalisé 100/100'),
      ...SAMPLE(2, 'document', 'Bloc ouvrant sans fermant', 'v5 · parse refusé à l’offset 0'),

      ...layer(3, '3 · Structure'),
      ...CHECK(3, 'graph', 'Le graphe est-il bien formé', 'nœuds, arêtes, pas d’orpheline'),
      ...REFUSAL(3, 'check', 'Aucun refus sur 100 PV', 'extraction 100/100'),
      ...SAMPLE(3, 'graph', 'Une arête orpheline', 'sonde v5 · plafond 65 536'),

      ...layer(4, '4 · Profil'),
      ...CHECK(4, 'identity', 'Types et renvois conformes', 'statuts, preuves, relations'),
      ...REFUSAL(4, 'unknown', '7 refus · 93 PV sur 100', 'evidence_ref 5 · INFERRED 2'),
      ...SAMPLE(4, 'document', 'Un nœud sur 22 sans preuve', 'Richelieu · 1 fautif sur 22'),

      ...layer(5, '5 · Provenance'),
      ...CHECK(5, 'map', 'L’extrait est-il sur la page', 'sous-chaîne normalisée exacte'),
      ...REFUSAL(5, 'unknown', '6 refus · 87 PV sur 93', 'ungrounded 6 PV · 32 refusés'),
      ...SAMPLE(5, 'document', 'Un « 9. » intercalé page 3', 'Coteau-du-Lac · 18 sur 91'),

      ...layer(6, '6 · Accepté'),
      ...CHECK(6, 'check', 'Les cinq portes sont passées', 'sinon le PV reste muet'),
      ...REFUSAL(6, 'unknown', '13 PV sur 100 refusés', '9 pour un seul enregistrement'),
      ...SAMPLE(6, 'check', '87 acceptés · IC95 79 à 92 %', '2 087 citations sur 2 119'),
    },
    edges: {
      'L1_CHK|L2_CHK|HTTP 200 · 100/100': e('observed', 'active'),
      'L2_CHK|L3_CHK|bloc retiré · 100/100': e('observed', 'active'),
      'L3_CHK|L4_CHK|graphe formé · 100/100': e('observed', 'active'),
      'L4_CHK|L5_CHK|profil valide · 93/100': e('observed', 'active'),
      'L5_CHK|L6_CHK|ancrage vérifié · 87/93': e('observed', 'active'),
    },
  },

  'resultats-v4-v100': {
    nodes: {
      E1: BOX(IMMO, 'historical', 'retained', { code: 'E1', name: 'v4 → v6 · transport' }),
      ...RUN('v4', 'historical', 'retained', 'llm', { code: 'v4', role: 'Gemini · LOW', name: '0/5 acceptés · F1 N-A', detail: 'contrat v3 · 16 384 · 31,4 s' }),
      ...RUN('v5', 'historical', 'retained', 'llm', { code: 'v5', role: 'Gemini · LOW', name: '0/1 contrôle · F1 N-A', detail: 'contrat v4 · 16 384 · 56,2 s' }),
      ...RUN('v6', 'historical', 'retained', 'llm', { code: 'v6', role: 'Gemini · LOW', name: '1/5 accepté · F1 0,400', detail: 'contrat v5 · 16 384 · 21/55 s' }),

      E2: BOX(IMMO, 'historical', 'retained', { code: 'E2', name: 'v7 → v11 · plafond' }),
      ...RUN('v7', 'historical', 'retained', 'llm', { code: 'v7', role: 'Gemini · LOW', name: '3/5 acceptés · F1 0,436', detail: 'contrat v5 · 65 536 · 25,7 s' }),
      ...RUN('v8', 'historical', 'retained', 'llm', { code: 'v8', role: 'Gemini · HIGH', name: '3/5 acceptés · F1 0,200', detail: 'contrat v5 · 65 536 · 81,8 s' }),
      ...RUN('v9', 'historical', 'retained', 'llm', { code: 'v9', role: 'Gemini · LOW', name: '3/5 acceptés · F1 0,558', detail: 'rejeu de v7 · 65 536 · 30,7 s' }),
      ...RUN('v10', 'historical', 'retained', 'llm', { code: 'v10', role: 'Gemini · LOW', name: '1/5 accepté · F1 0,909', detail: 'contrat v6 · 65 536 · 34,1 s' }),
      ...RUN('v11', 'historical', 'retained', 'llm', { code: 'v11', role: 'Gemini · LOW', name: '1/5 accepté · F1 0,909', detail: 'contrat v7 · 65 536 · 30,4 s' }),

      E3: BOX(IMMO, 'historical', 'retained', { code: 'E3', name: 'v12 → v13 · Sonnet' }),
      ...RUN('v12A', 'historical', 'retained', 'llm', { code: 'v12-a', role: 'Sonnet · direct', name: '0/5 acceptés · F1 N-A', detail: 'contrat v5 · 65 536 · 137 s' }),
      ...RUN('v12B', 'historical', 'retained', 'llm', { code: 'v12-b', role: 'Sonnet · Cloud', name: '0/5 acceptés · F1 N-A', detail: 'contrat v5 · 64 000 · 130 s' }),
      ...RUN('v13A', 'historical', 'retained', 'llm', { code: 'v13-a', role: 'Gemini · LOW', name: '4/5 acceptés · F1 0,133', detail: 'contrat v8 · 64 000 · 30,5 s' }),
      ...RUN('v13B', 'historical', 'retained', 'llm', { code: 'v13-b', role: 'Sonnet · Cloud', name: '4/5 acceptés · F1 0,222', detail: 'contrat v8 · 64 000 · 122 s' }),

      E4: BOX(IMMO, 'observed', 'retained', { code: 'E4', name: 'v14 → v16 · contrat' }),
      ...RUN('v14', 'observed', 'retained', 'llm', { code: 'v14', role: 'Gemini · LOW', name: '5/5 acceptés · 103 ancrées', detail: 'contrat d93f5c93 · 27,0 s' }),
      ...RUN('v15', 'observed', 'retained', 'llm', { code: 'v15', role: 'Gemini · LOW', name: '5/5 acceptés · 94 ancrées', detail: 'contrat d93f5c93 · 25,5 s' }),
      ...RUN('v16', 'observed', 'retained', 'llm', { code: 'v16', role: 'Gemini · LOW', name: '3/5 acceptés · 132 ancrées', detail: 'contrat 93994e45 · 40,8 s' }),

      E5: BOX(IMMO, 'observed', 'active', { code: 'E5', name: 'v100 · 100 villes' }),
      ...RUN('v100', 'observed', 'active', 'llm', { code: 'v100', role: 'Gemini · LOW', name: '87/100 · IC95 79 à 92 %', detail: '93994e45 · 64 000 · 19,2 s' }),
      ...RUN('J100', 'observed', 'active', 'identity', { code: 'J100', role: 'Juges · aveugles', name: '2,96 et 3,60 sur 5', detail: '21/25 à ±1 pt · κ −0,018' }),

      E6: BOX(IMMO, 'declared', 'dormant', { code: 'E6', name: '§ 6 · les options' }),
      ...OPTION('OPTA', 'release', { code: 'OPT-A', role: 'Option · A', name: 'Promouvoir tel quel', detail: 'plafond mesuré 87 %' }),
      ...OPTION('OPTB', 'map', { code: 'OPT-B', role: 'Option · B′', name: 'Corriger l’ancrage d’abord', detail: 'plafond mesuré 87 → 93 %' }),
      ...OPTION('OPTC', 'check', { code: 'OPT-C', role: 'Option · C′', name: 'Écarter l’enregistrement', detail: 'plafond mesuré 87 → 96 %' }),
      ...OPTION('OPTD', 'cronjob', { code: 'OPT-D', role: 'Option · D′', name: 'Rejouer la campagne', detail: 'variance · plafond 87 %' }),
    },
    edges: {
      'v6|v7|plafond 16 384 saturé': e('historical', 'retained'),
      'v11|v12A|extraits trop longs': e('historical', 'retained'),
      "v13A|v14|contrat v9 d'après-revue": e('observed', 'retained'),
      'v16|v100|corpus 5 → 100 PV': e('observed', 'active'),
      'v100|OPTA|87 % · 13 refus': e('declared', 'dormant'),
    },
  },
};

export const sceneIds = Object.keys(scenes);

// Même contrat que la chaîne d'architecture : aucun nœud ni arête en trop ou
// manquant des deux côtés, états fermés, gabarit unique A' (ou conteneur).
export function metadataFor(graph) {
  const scene = scenes[graph.id];
  if (!scene) throw Error(`missing scene metadata ${graph.id}`);
  const actualNodes = new Set([...graph.groups, ...graph.nodes].map(item => item.id));
  const expectedNodes = new Set(Object.keys(scene.nodes));
  for (const id of actualNodes) if (!expectedNodes.has(id)) throw Error(`${graph.id}: missing node metadata ${id}`);
  for (const id of expectedNodes) if (!actualNodes.has(id)) throw Error(`${graph.id}: extra node metadata ${id}`);
  const groupIds = new Set(graph.groups.map(group => group.id));
  const edges = {};
  for (const edge of graph.edges) {
    const key = `${edge.source}|${edge.target}|${edge.label}`, value = scene.edges[key];
    if (!value) throw Error(`${graph.id}: missing edge metadata ${key}`);
    edges[edge.id] = value;
  }
  if (Object.keys(edges).length !== Object.keys(scene.edges).length) throw Error(`${graph.id}: extra edge metadata`);
  for (const value of [...Object.values(scene.nodes), ...Object.values(edges)]) {
    if (!EVIDENCE.has(value.evidenceClass) || !RUNTIME.has(value.runtimeState)) throw Error(`${graph.id}: invalid closed state`);
  }
  for (const [id, value] of Object.entries(scene.nodes)) {
    const isGroup = groupIds.has(id);
    if (isGroup !== (value.card === 'box')) throw Error(`${graph.id}/${id}: container and template disagree`);
    if (value.card === 'box') {
      if (value.role) throw Error(`${graph.id}/${id}: a container carries no role title`);
      continue;
    }
    if (value.card !== 'A') throw Error(`${graph.id}/${id}: unknown card template ${value.card}`);
    if (!value.code || !value.role || !value.name || !value.detail) throw Error(`${graph.id}/${id}: card needs code, role, name and detail`);
    if (value.name.includes(value.code)) throw Error(`${graph.id}/${id}: code repeated inside the name`);
    if (!roleIsShort(value.role)) throw Error(`${graph.id}/${id}: role title "${value.role}" is not two-by-two short`);
  }
  return { nodes: scene.nodes, edges };
}

export function decorateGraph(graph) {
  const metadata = metadataFor(graph);
  for (const item of [...graph.groups, ...graph.nodes]) item.metadata = metadata.nodes[item.id];
  for (const edge of graph.edges) edge.metadata = metadata.edges[edge.id];
  return graph;
}
