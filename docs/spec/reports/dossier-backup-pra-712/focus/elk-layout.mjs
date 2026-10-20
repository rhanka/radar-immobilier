// Placement des scènes par ELK (Eclipse Layout Kernel, algorithme « layered »),
// calculé une fois au build : positions des cartes et des conteneurs, tracés
// orthogonaux des liaisons, position des étiquettes. Aucun placement maison :
// ce module traduit la description unique des scènes vers le graphe ELK, puis
// relit le résultat d'ELK en coordonnées absolues.
//
// Trois modes ELK, choisis par scène :
// - `include` : hiérarchie incluse (INCLUDE_CHILDREN), un seul passage ELK sur
//   tout le graphe, liaisons entre conteneurs routées par ELK ;
// - `frame` : les quatre faces (nord, sud, est, ouest) tenues par un cadre fixe,
//   un placement ELK par bloc racine et par conteneur, les tronçons de niveau
//   cadre tracés dans les couloirs entre les blocs (voir frameLayout, plus bas) ;
// - `ports` : chaque conteneur est placé par ELK séparément, avec le repliement
//   de graphe d'ELK (graph wrapping) pour qu'une longue séquence se replie en
//   rangées ; une liaison entre deux conteneurs passe par des ports
//   hiérarchiques déclarés sur leurs bords, et chacun de ses tronçons est routé
//   par ELK à son niveau (conteneur source, racine, conteneur cible).
import ELK from 'elkjs/lib/elk.bundled.js';

export const CARD = { width: 460, height: 200 };
export const HEADER = 96;
// Étiquettes en 24 px dans le gabarit : largeur estimée par caractère, marge comprise.
export const labelSize = text => ({ width: Math.ceil(text.length * 13.5 + 24), height: 34 });

const elk = new ELK();

// Réglages natifs d'ELK que le balayage de lisibilité fait varier
// (sweep-legibility.mjs), avec leur nom ELK. Rien d'autre n'est réglé.
export const ELK_KNOBS = {
  direction: 'elk.direction',
  inner: 'elk.direction (dans les conteneurs, mode ports)',
  layerGap: 'elk.layered.spacing.nodeNodeBetweenLayers',
  rootLayerGap: 'elk.layered.spacing.nodeNodeBetweenLayers (racine, mode ports)',
  edgeLayerGap: 'elk.layered.spacing.edgeNodeBetweenLayers',
  nodeGap: 'elk.spacing.nodeNode',
  edgeNodeGap: 'elk.spacing.edgeNode',
  edgeGap: 'elk.spacing.edgeEdge',
  componentGap: 'elk.spacing.componentComponent',
  placement: 'elk.layered.nodePlacement.strategy',
  compaction: 'elk.layered.compaction.postCompaction.strategy',
  labelLayer: 'elk.layered.edgeLabels.centerLabelPlacementStrategy',
  layering: 'elk.layered.layering.strategy',
  layerBound: 'elk.layered.layering.coffmanGraham.layerBound',
  inline: 'elk.edgeLabels.inline (posé sur chaque étiquette)',
  aspectRatio: 'elk.aspectRatio',
  innerRatio: 'elk.aspectRatio (repliement dans un conteneur)',
  packRatio: 'elk.aspectRatio (composantes d’un conteneur, mode ports)',
  portRatio: 'elk.portConstraints FIXED_RATIO (true) ou FIXED_SIDE (false)',
  wrap: 'elk.layered.wrapping.strategy',
  rootPadding: 'elk.padding (racine)',
  // Mode `frame` : un placement ELK par conteneur, d'où des réglages par niveau.
  groupDirection: 'elk.direction (conteneurs intermédiaires, mode frame)',
  leafDirection: 'elk.direction (conteneurs de feuilles, mode frame)',
  leafRatio: 'elk.aspectRatio (conteneurs de feuilles, mode frame)',
  groupRatio: 'elk.aspectRatio (conteneurs intermédiaires, mode frame)',
  portSide: 'elk.portConstraints des conteneurs internes : FIXED_SIDE (fixed) ou FREE (free)',
  split: 'niveau de découpage par ports : chaque conteneur (all) ou frontières seules (leaf)',
  frameMargin: 'marge des couloirs du cadre autour des étiquettes',
  ratioHigh: 'rapport largeur / hauteur visé au plus haut par le cadre (porte 16:9)',
};
// Valeurs par défaut : celles du placement d'avant le balayage de lisibilité.
export const ELK_DEFAULTS = {
  layerGap: 90, rootLayerGap: 90, edgeLayerGap: 30, nodeGap: 48, edgeNodeGap: 30, edgeGap: 20, componentGap: 60,
  placement: 'NETWORK_SIMPLEX', compaction: 'NONE', labelLayer: 'MEDIAN_LAYER', layering: 'NETWORK_SIMPLEX', layerBound: null,
  inline: false, rootPadding: 40, leafRatio: 1.6,
};

// Réglages par scène, retenus par le balayage de lisibilité (sweep-legibility.mjs,
// tableau dans preuves/balayage-lisibilite.md) : parmi les placements qui passent
// toutes les portes géométriques, celui dont le plus petit texte est le plus grand
// une fois la scène ajustée à la vue.
// Avant ce balayage : architecture layerGap 220, séquence 350, mise en service 300,
// marge racine 40 — des écarts qui ne servaient qu'à tenir le rapport 4:3–16:9.
// Mise en page **imposée** par l'owner (DOSSIER_PRA_V3_LAYOUT_SPEC, 2026-09-20) :
// l'utilisateur au nord, l'administration et le coffre au sud, et entre les deux
// une **bande de cinq colonnes**, de l'ouest vers l'est — GitHub seul, hors
// GitHub, le cluster k8s, les buckets OVH, la réplication en autre région.
// `anchor` : la colonne sur laquelle le nord et le sud sont centrés.
export const FRAME_FACES = {
  'architecture-sauvegardes': { north: 'USER', south: 'SUD_ADMIN', anchor: 'OVH_CLUSTER',
    band: ['Z_GHX', 'OVH_CLUSTER', 'BUCKETS_OVH', 'EXT_REGION'] },
};

// Le plan, conteneur par conteneur. **Ce n'est plus une mise en page à découvrir :
// le moteur ne choisit plus l'emplacement de ces blocs**, il ne place plus qu'à
// l'intérieur des conteneurs que le plan ne nomme pas (les feuilles non citées).
// `axis: 'col'` = empilés du nord au sud dans l'ordre donné ; `axis: 'row'` =
// rangés de l'ouest vers l'est. L'ordre est tenu par le placement semi-interactif
// d'ELK (layering, crossing minimization et cycle breaking INTERACTIVE, placement
// SIMPLE) : ELK garde la main sur le routage, le plan garde la main sur l'ordre.
export const FRAME_PLAN = {
  'architecture-sauvegardes': {
    // 1. Colonne de pilotage : hors GitHub AU-DESSUS, GitHub EN DESSOUS (owner :
    //    « place gh en dessous de hors gh »). Les deux zones empilées en une colonne.
    Z_GHX: { axis: 'col', order: ['HORS_GH', 'GH_PILOTAGE'] },
    // GitHub, verticale à 100 % — workflows et alertes émises par GitHub.
    GH_PILOTAGE: { axis: 'col', order: ['GHA', 'GHA_CD', 'ALT_GH'] },
    // Hors GitHub, verticale — courriel Scaleway TEM, DNS Cloudflare.
    HORS_GH: { axis: 'col', order: ['ALT_TEM', 'CF_LE'] },
    // 3. Cluster k8s : immo au nord, geo au centre, plateforme partagée au sud ;
    //    dans chaque tenant, la préproduction à l'ouest et la production à l'est.
    // `stretch` : l'enfant que le plan veut « sur toute la largeur » reçoit la
    // largeur utile de son parent comme taille minimale, en second passage.
    OVH_CLUSTER: { axis: 'col', order: ['immo_tenant', 'geo_tenant', 'PLATEFORME'], stretch: ['PLATEFORME'] },
    immo_tenant: { axis: 'row', order: ['immo_pp', 'immo_pr'] },
    geo_tenant: { axis: 'row', order: ['geo_pp', 'geo_pr'] },
    // La plateforme partagée n'est pas dans le plan : l'owner en fixe la place (au
    // sud du cluster, sur toute la largeur), pas l'ordre de ses trois cartes. Elle
    // reste donc rangée par le moteur, comme les autres conteneurs de feuilles.
    // 4. Buckets OVH : immo au nord (préprod nord-nord, prod nord-sud), geo au
    //    centre (préprod centre-nord, prod centre-sud), clés tout au sud.
    BUCKETS_OVH: { axis: 'col', order: ['S3_IMMO', 'S3_GEO', 'CLES_S3'] },
    S3_IMMO: { axis: 'col', order: ['S3_IMMO_PP', 'S3_IMMO_PR'] },
    S3_GEO: { axis: 'col', order: ['S3_GEO_PP', 'S3_GEO_PR'] },
    // 5. Réplication en autre région OVH, verticale.
    EXT_REGION: { axis: 'col', order: ['R6_PP', 'R6_PR', 'GR_PP', 'GR_PR', 'OPT_HORS'] },
    // Administration et coffre, au sud, « 100 % horizontalisée » (owner) : le
    // pendant sud de la case utilisateur, une seule rangée. Sans le plan, le
    // moteur la range en L (deux cartes empilées à gauche, deux à droite).
    SUD_ADMIN: { axis: 'row', order: ['OWNER', 'ADMIN', 'K_VAULT', 'K_OVH'] },
  },
};
// Conteneurs que le plan de l'owner range explicitement sur une colonne : la porte
// de grille (geometry-check.mjs) ne leur est pas opposable, puisque c'est lui qui
// l'a demandé (« la zone de réplication ovh autre région, verticalisée »).
export const gridExempt = sceneId => new Set(Object.entries(FRAME_PLAN[sceneId] ?? {})
  .filter(([, plan]) => plan.axis === 'col').map(([id]) => id));

export const SCENE_OPTIONS = {
  // Scène 1 remise en page (nord / sud / latéral, cluster > tenant > environnement) :
  // réglages re-balayés sur la nouvelle structure, les précédents ne tenaient plus le
  // rapport 4:3–16:9 (1,266 mesuré).
  // Scène 1 : mode « frame ». Les quatre faces sont tenues par un cadre fixe
  // (voir frameLayout) ; réglages retenus par le balayage, étape « frame ».
  // Réglages re-balayés sur le plan imposé, colonne de pilotage empilée comprise
  // (232 candidats, `make sweep`). Le sens et le rapport d'aspect des conteneurs de
  // feuilles n'y sont plus : le cadre les balaie lui-même, conteneur par conteneur
  // (voir « mélanges », plus bas). Placement BRANDES_KOEPF + compaction EDGE_LENGTH
  // retenus par le balayage sur la nouvelle structure (plus petit texte 3,35 → 3,53
  // px à 1 440 × 900) ; ils ne portent que sur les feuilles libres (les conteneurs
  // du plan forcent SIMPLE / NONE).
  'architecture-sauvegardes': { mode: 'frame', direction: 'RIGHT', inner: 'RIGHT', split: 'all', portSide: 'free',
    layerGap: 30, nodeGap: 24, placement: 'BRANDES_KOEPF', compaction: 'EDGE_LENGTH',
    frameMargin: 16, ratioHigh: 1.7478, rootPadding: 12,
    edgeLayerGap: 15, edgeNodeGap: 15, edgeGap: 10, componentGap: 24,
    frame: FRAME_FACES['architecture-sauvegardes'], plan: FRAME_PLAN['architecture-sauvegardes'] },
  'sequence-bout-en-bout': { mode: 'ports', direction: 'DOWN', inner: 'DOWN', wrap: 'MULTI_EDGE', innerRatio: 3, layerGap: 30,
    nodeGap: 24, rootPadding: 12, inline: true, edgeLayerGap: 15, edgeNodeGap: 15, edgeGap: 10, componentGap: 24 },
  'mise-en-service': { mode: 'ports', direction: 'DOWN', inner: 'RIGHT', wrap: 'MULTI_EDGE', innerRatio: 4.5, layerGap: 30,
    rootLayerGap: 30, placement: 'BRANDES_KOEPF', rootPadding: 12, edgeLayerGap: 15, edgeNodeGap: 15, edgeGap: 10, componentGap: 24 },
};

const baseOptions = (direction, layerGap, o) => ({
  'elk.algorithm': 'layered',
  'elk.direction': direction,
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': String(layerGap),
  'elk.layered.spacing.edgeNodeBetweenLayers': String(o.edgeLayerGap),
  'elk.spacing.nodeNode': String(o.nodeGap),
  'elk.spacing.edgeNode': String(o.edgeNodeGap),
  'elk.spacing.edgeEdge': String(o.edgeGap),
  'elk.spacing.edgeLabel': '2',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.layered.edgeLabels.centerLabelPlacementStrategy': o.labelLayer,
  'elk.spacing.componentComponent': String(o.componentGap),
  'elk.layered.nodePlacement.strategy': o.placement,
  'elk.layered.compaction.postCompaction.strategy': o.compaction,
  'elk.layered.layering.strategy': o.layering,
  ...(o.layerBound ? { 'elk.layered.layering.coffmanGraham.layerBound': String(o.layerBound) } : {}),
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.portAlignment.default': 'CENTER',
});
// Marge latérale d'un conteneur : la largeur utile d'un conteneur est sa largeur
// moins deux fois cette marge (voir `stretch`, mode frame).
export const CONTAINER_SIDE = 24;
const containerPadding = `[top=${HEADER + 16},left=${CONTAINER_SIDE},bottom=${CONTAINER_SIDE},right=${CONTAINER_SIDE}]`;
// Un conteneur de feuilles ne contient que des cartes (aucun sous-conteneur).
const isLeafGroup = (id, byParent, groupIds) =>
  groupIds.has(id) && !(byParent.get(id) ?? []).some(child => groupIds.has(child.id));
// ELK accepte un algorithme par nœud, mais pas pour ce besoin : `rectpacking` et
// `box` rangent bien les cartes d'un conteneur de feuilles en grille et **ne
// routent aucune liaison** (mesuré : 0 tronçon sur 3), et sous `INCLUDE_CHILDREN`
// ils cassent en plus la résolution des liaisons entre conteneurs. Le levier
// retenu est `elk.aspectRatio` sur un conteneur placé à part (mode `frame`), qui
// reste en `layered` et route.
const minimumWidth = item => item.label.length * 17 + 150;
const SIDES = { DOWN: ['SOUTH', 'NORTH'], RIGHT: ['EAST', 'WEST'] };
// Position initiale des ports sur un conteneur de 100 × 100, conservée en rapport.
const PORT_AT = { SOUTH: { x: 50, y: 100 }, NORTH: { x: 50, y: -1 }, EAST: { x: 100, y: 50 }, WEST: { x: -1, y: 50 } };

// `base` : réglages de la scène (SCENE_OPTIONS) ; le balayage passe `{}` pour que
// chaque candidat soit exactement ses propres réglages sur les valeurs par défaut.
export async function elkLayout(graph, overrides = {}, { base = SCENE_OPTIONS[graph.id] } = {}) {
  const options = { ...ELK_DEFAULTS, ...base, ...overrides };
  if (options.mode === 'frame') return frameLayout(graph, options);
  // Étiquette « en ligne » : ELK lit cette option sur l'étiquette elle-même.
  const label = edge => edge.label ? [{ id: `${edge.id}__label`, text: edge.label, ...labelSize(edge.label),
    ...(options.inline ? { layoutOptions: { 'elk.edgeLabels.inline': 'true' } } : {}) }] : [];
  const rootPadding = `[top=${options.rootPadding},left=${options.rootPadding},bottom=${options.rootPadding},right=${options.rootPadding}]`;
  const byParent = new Map();
  for (const item of [...graph.groups, ...graph.nodes]) {
    const key = item.parent ?? '__root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(item);
  }
  const groupIds = new Set(graph.groups.map(group => group.id));
  let root;
  if (options.mode === 'include') {
    const build = item => groupIds.has(item.id)
      ? { id: item.id, layoutOptions: { 'elk.padding': containerPadding,
          'elk.nodeSize.constraints': 'MINIMUM_SIZE', 'elk.nodeSize.minimum': `(${minimumWidth(item)}, 120)` },
        children: (byParent.get(item.id) ?? []).map(build) }
      : { id: item.id, width: CARD.width, height: CARD.height };
    root = { id: '__root',
      layoutOptions: { ...baseOptions(options.direction, options.layerGap, options), 'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.padding': rootPadding,
        ...(options.aspectRatio ? { 'elk.aspectRatio': String(options.aspectRatio) } : {}) },
      children: (byParent.get('__root') ?? []).map(build),
      edges: graph.edges.map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target], labels: label(edge) })) };
  } else {
    // Un seul niveau de conteneurs : toutes les cartes sont dans un conteneur racine.
    const [outSide, inSide] = SIDES[options.direction];
    const ports = new Map(graph.groups.map(group => [group.id, []]));
    const inner = new Map(graph.groups.map(group => [group.id, []]));
    const rootEdges = [];
    for (const edge of graph.edges) {
      const from = graph.nodes.find(node => node.id === edge.source)?.parent;
      const to = graph.nodes.find(node => node.id === edge.target)?.parent;
      if (!from || !to || !ports.has(from) || !ports.has(to)) throw Error(`${graph.id}: mode ports, carte hors conteneur`);
      if (from === to) { inner.get(from).push({ id: edge.id, sources: [edge.source], targets: [edge.target], labels: label(edge) }); continue; }
      const outPort = `${edge.id}__out`, inPort = `${edge.id}__in`;
      // Ports au milieu du bord (rapport fixe d'ELK) : les conteneurs s'alignent sur la liaison.
      ports.get(from).push({ id: outPort, width: 1, height: 1, ...PORT_AT[outSide], layoutOptions: { 'elk.port.side': outSide } });
      ports.get(to).push({ id: inPort, width: 1, height: 1, ...PORT_AT[inSide], layoutOptions: { 'elk.port.side': inSide } });
      inner.get(from).push({ id: `${edge.id}__a`, sources: [edge.source], targets: [outPort], labels: [] });
      rootEdges.push({ id: `${edge.id}__b`, sources: [outPort], targets: [inPort], labels: label(edge) });
      inner.get(to).push({ id: `${edge.id}__c`, sources: [inPort], targets: [edge.target], labels: [] });
    }
    root = { id: '__root',
      layoutOptions: { ...baseOptions(options.direction, options.rootLayerGap, options), 'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
        'elk.padding': rootPadding,
        ...(options.aspectRatio ? { 'elk.aspectRatio': String(options.aspectRatio) } : {}) },
      children: graph.groups.map(group => ({ id: group.id, width: 100, height: 100,
        layoutOptions: { ...baseOptions(options.inner, options.layerGap, options), 'elk.padding': containerPadding,
          'elk.portConstraints': options.portRatio === false ? 'FIXED_SIDE' : 'FIXED_RATIO',
          'elk.nodeSize.constraints': 'MINIMUM_SIZE', 'elk.nodeSize.minimum': `(${minimumWidth(group)}, 120)`,
          // Cartes sans liaison dans un conteneur : ELK les range en composantes,
          // empilées selon ce rapport largeur / hauteur.
          ...(options.packRatio ? { 'elk.aspectRatio': String(options.packRatio) } : {}),
          // Le repliement ne sert qu'aux longues séquences : un conteneur de quatre
          // cartes ou moins reste sur une rangée.
          ...(options.wrap && options.wrap !== 'OFF' && (byParent.get(group.id) ?? []).length > 4 ? { 'elk.layered.wrapping.strategy': options.wrap, 'elk.aspectRatio': String(options.innerRatio),
            'elk.layered.wrapping.additionalEdgeSpacing': '40' } : {}) },
        ports: ports.get(group.id),
        children: (byParent.get(group.id) ?? []).map(node => ({ id: node.id, width: CARD.width, height: CARD.height })),
        edges: inner.get(group.id) })),
      edges: rootEdges };
  }
  const out = await elk.layout(root);

  // Relecture : coordonnées ELK relatives au parent → absolues.
  const absolute = new Map([['__root', { x: 0, y: 0 }]]), relative = new Map(), size = new Map();
  const walk = (node, origin) => {
    for (const child of node.children ?? []) {
      const at = { x: origin.x + child.x, y: origin.y + child.y };
      absolute.set(child.id, at);
      relative.set(child.id, { x: child.x, y: child.y });
      size.set(child.id, { width: child.width, height: child.height });
      walk(child, at);
    }
  };
  walk(out, { x: 0, y: 0 });
  const pieces = new Map();
  const collect = (node, origin) => {
    for (const edge of node.edges ?? []) {
      const base = edge.container ? absolute.get(edge.container) : origin;
      const section = edge.sections?.[0];
      if (!section) throw Error(`${graph.id}: ELK n'a pas routé ${edge.id}`);
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
        .map(point => ({ x: base.x + point.x, y: base.y + point.y }));
      const text = edge.labels?.[0];
      pieces.set(edge.id, { points,
        label: text ? { x: base.x + text.x, y: base.y + text.y, width: text.width, height: text.height } : null });
    }
    for (const child of node.children ?? []) collect(child, absolute.get(child.id));
  };
  collect(out, { x: 0, y: 0 });
  const edges = graph.edges.map(edge => {
    if (pieces.has(edge.id)) return { id: edge.id, ...pieces.get(edge.id) };
    const [a, b, c] = ['a', 'b', 'c'].map(part => pieces.get(`${edge.id}__${part}`));
    // Les trois tronçons ELK se rejoignent sur les ports ; on retire les doublons.
    const points = [...a.points, ...b.points, ...c.points].filter((point, index, all) =>
      !index || Math.abs(point.x - all[index - 1].x) > .5 || Math.abs(point.y - all[index - 1].y) > .5);
    return { id: edge.id, points, label: b.label };
  });
  // ELK peut laisser un écart sous le pixel entre deux points d'un même segment
  // droit : on l'aligne pour garder un tracé strictement orthogonal.
  for (const edge of edges) for (let i = 1; i < edge.points.length; i++) {
    const p = edge.points[i - 1], q = edge.points[i];
    if (Math.abs(p.x - q.x) < 1) q.x = p.x;
    if (Math.abs(p.y - q.y) < 1) q.y = p.y;
  }
  return { canvas: { width: out.width, height: out.height }, absolute, relative, size, edges };
}

// ——————————————————————————————————————————————————————————————————————————
// Mode « frame » : les quatre faces tenues par un cadre fixe, plusieurs placements
//
// ELK `layered` place par le flux, pas par les points cardinaux : lui demander
// « l'utilisateur au nord, l'administration au sud » en un seul passage ne marche
// pas (mesuré : `elk.position` en semi-interactif sans effet, crossingMinimization
// INTERACTIVE en échec avec INCLUDE_CHILDREN, contrainte de couche qui ne connaît
// que FIRST et LAST, c'est-à-dire l'ouest et l'est). Ce mode ne le lui demande
// donc pas. Il pose les blocs racine à des coordonnées **calculées à partir des
// tailles que les sous-placements renvoient** — nord, sud, ouest, est autour du
// bloc central — et fait tourner ELK **à l'intérieur de chacun**, y compris dans
// le cluster. Chaque contenu reste placé par le moteur ; seul le cadre est fixe,
// et les tronçons de niveau cadre sont tracés dans les couloirs entre les blocs.
//
// Corollaire recherché : chaque conteneur étant un graphe ELK à part entière
// (SEPARATE_CHILDREN partout, liaisons découpées par des ports hiérarchiques),
// `elk.aspectRatio` y reprend son effet — ELK range les cartes non reliées entre
// elles en composantes sur plusieurs colonnes au lieu d'une seule. C'est le
// levier natif qui dé-verticalise les tenants.

// Bord de sortie et bord d'entrée d'une liaison de niveau cadre, déduits des deux
// faces qu'elle relie. **Une colonne de la bande n'est abordée que par son flanc** :
// c'est une contrainte du moteur autant que du dessin — un port posé au nord ou au
// sud d'un conteneur en placement descendant l'oblige à rejoindre la première ou la
// dernière couche, ce qui écrase l'ordre que le plan impose (mesuré : deux cartes
// de rangs différents ramenées sur la même rangée). Le nord et le sud, eux,
// **abordent toujours la bande par leur bord tourné vers elle** (le sud par le
// haut, le nord par le bas), qu'ils visent la colonne d'ancrage ou une autre : un
// port de flanc y ferait la même casse (l'administration au sud, ses quatre cartes
// ramenées en L au lieu d'une rangée) ; ils rejoignent l'abscisse de la colonne
// visée dans le couloir horizontal, jamais en traversant une colonne.
const sidesBetween = (a, b) => {
  if (a.kind === 'band' && b.kind === 'band') return a.index < b.index ? ['EAST', 'WEST'] : ['WEST', 'EAST'];
  if (a.kind !== 'band') {
    const away = a.kind === 'north' ? 'SOUTH' : 'NORTH';
    const into = a.kind === 'north' ? 'NORTH' : 'SOUTH';
    return [away, into];
  }
  const away = b.kind === 'north' ? 'NORTH' : 'SOUTH';
  const into = b.kind === 'north' ? 'SOUTH' : 'NORTH';
  return [away, into];
};
// Trajet d'une liaison de niveau cadre dans les couloirs. Couloirs : `V<i>` entre
// les colonnes i et i+1, `HN` au-dessus de la bande, `HS` en dessous. Deux
// colonnes voisines se joignent dans le couloir qui les sépare ; deux colonnes
// séparées par une troisième **ne se voient pas** : la liaison monte par le
// couloir qui la borde, survole toute la bande par `HN`, et redescend par le
// couloir qui borde l'arrivée — elle ne traverse donc aucune colonne intercalée.
// `region` est le couloir qui porte l'étiquette ; `lanes`, tous ceux où le tracé
// prend une voie.
const routeBetween = (a, b) => {
  if (a.kind === 'band' && b.kind === 'band') {
    const [i, j] = [a.index, b.index];
    if (Math.abs(i - j) === 1) return { kind: 'voisines', region: `V${Math.min(i, j)}`, lanes: [`V${Math.min(i, j)}`] };
    const [out, into] = i < j ? [`V${i}`, `V${j - 1}`] : [`V${i - 1}`, `V${j}`];
    return { kind: 'survol', region: 'HN', lanes: [out, 'HN', into] };
  }
  // Nord ou sud vers une colonne (ancrage ou non) : par le couloir horizontal qui
  // borde la face, jusqu'à l'abscisse de la colonne, puis à la verticale dans la
  // colonne. Une seule règle, l'aplomb — le flanc n'existe plus (il rabattait les
  // cartes de la face en L ; voir sidesBetween).
  const region = a.kind === 'south' || b.kind === 'south' ? 'HS' : 'HN';
  return { kind: 'aplomb', region, lanes: [region] };
};
// Porte dure du rapport (geometry-check.mjs) et cible visée par le cadre, prise
// un peu en dedans pour que la mesure Chromium reste du bon côté.
const RATIO = { min: 4 / 3, max: 16 / 9 };
const RATIO_TARGET = { low: 4 / 3 + 0.06, high: 16 / 9 - 0.06 };

// Rapports largeur / hauteur essayés sur chaque bloc racine : ELK empile les
// composantes d'un conteneur selon `elk.aspectRatio`, mais la forme atteignable
// est quantifiée par la taille des cartes. Le cadre essaie donc la grille, mesure
// ce que le moteur renvoie, et choisit la combinaison — rien n'est deviné.
const BLOCK_RATIOS = [0.35, 0.5, 0.7, 0.9, 1.2, 1.6, 2.1, 2.8, 3.6, 5, 7];

async function frameLayout(graph, options) {
  const faces = options.frame;
  if (!faces) throw Error(`${graph.id} : mode frame sans description des faces`);
  const plan = options.plan ?? {};
  const band = faces.band ?? [];
  const anchor = band.indexOf(faces.anchor ?? band[Math.floor(band.length / 2)]);
  if (anchor < 0) throw Error(`${graph.id} : colonne d'ancrage hors de la bande`);
  const faceOf = new Map([[faces.north, { kind: 'north' }], [faces.south, { kind: 'south' }],
    ...band.map((id, index) => [id, { kind: 'band', index, anchor, flank: index < anchor ? 'WEST' : 'EAST' }])]);
  const items = new Map([...graph.groups, ...graph.nodes].map(item => [item.id, item]));
  const groupIds = new Set(graph.groups.map(group => group.id));
  const byParent = new Map();
  for (const item of [...graph.groups, ...graph.nodes]) {
    const key = item.parent ?? '__root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(item);
  }
  const parentOf = new Map([...graph.groups, ...graph.nodes].map(item => [item.id, item.parent ?? null]));
  const chainUp = id => { const out = []; let p = parentOf.get(id); while (p) { out.push(p); p = parentOf.get(p); } return out; };
  const blockOf = id => { let cur = id; while (parentOf.get(cur)) cur = parentOf.get(cur); return cur; };
  const rootIds = (byParent.get('__root') ?? []).map(item => item.id);
  for (const id of rootIds) if (!faceOf.has(id)) throw Error(`${graph.id} : bloc racine ${id} sans face`);

  // ——— 1. Découpage des liaisons en tronçons, un par niveau de conteneur ———
  // Une liaison qui traverse un bord de conteneur est coupée à ce bord par un port
  // hiérarchique ; chaque tronçon est routé par ELK dans le graphe où il est
  // déclaré. Seuls les tronçons de niveau cadre (d'un bloc racine à un autre)
  // restent à tracer, et ils le sont dans les couloirs, hors de toute boîte.
  const portsOf = new Map();
  const innerEdges = new Map();
  const frameEdges = [];
  const put = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  const [innerOut, innerIn] = SIDES[options.inner ?? options.direction];
  // Frontières où une liaison est coupée par un port : les conteneurs que le
  // moteur place à part. En `split: 'leaf'`, ce sont les blocs racine (placés un
  // par un pour tenir le cadre) et les conteneurs de feuilles (placés à part pour
  // que `elk.aspectRatio` y range les cartes en grille) ; les niveaux
  // intermédiaires restent dans le placement du bloc (INCLUDE_CHILDREN), qui route
  // lui-même les liaisons qui les traversent. En `split: 'all'`, chaque conteneur
  // est une frontière.
  const isBoundary = id => options.split === 'all' || !parentOf.get(id) || isLeafGroup(id, byParent, groupIds);
  const boundaries = id => chainUp(id).filter(isBoundary);
  for (const edge of graph.edges) {
    const up = boundaries(edge.source), down = boundaries(edge.target);
    let lca = '__root';
    while (up.length && down.length && up.at(-1) === down.at(-1)) { lca = up.pop(); down.pop(); }
    const faceA = faceOf.get(blockOf(edge.source)), faceB = faceOf.get(blockOf(edge.target));
    const cross = blockOf(edge.source) !== blockOf(edge.target);
    if (cross && (!faceA || !faceB)) throw Error(`${graph.id} : bloc racine sans face (${edge.id})`);
    const [sideOut, sideIn] = cross ? sidesBetween(faceA, faceB) : [innerOut, innerIn];
    const port = (container, id, side) => {
      put(portsOf, container, { id, width: 1, height: 1, layoutOptions: { 'elk.port.side': side } });
      return id;
    };
    let from = edge.source;
    for (const container of up) {
      const target = port(container, `${edge.id}__out__${container}`, sideOut);
      put(innerEdges, container, { id: `${edge.id}__u__${container}`, sources: [from], targets: [target], labels: [] });
      from = target;
    }
    let to = edge.target;
    for (const container of down) {
      const source = port(container, `${edge.id}__in__${container}`, sideIn);
      put(innerEdges, container, { id: `${edge.id}__d__${container}`, sources: [source], targets: [to], labels: [] });
      to = source;
    }
    const labels = edge.label ? [{ id: `${edge.id}__label`, text: edge.label, ...labelSize(edge.label),
      ...(options.inline ? { layoutOptions: { 'elk.edgeLabels.inline': 'true' } } : {}) }] : [];
    const middle = { id: `${edge.id}__m`, sources: [from], targets: [to], labels };
    if (lca === '__root') frameEdges.push({ ...middle, edge, sideOut, sideIn, up, down, ...routeBetween(faceA, faceB) });
    else put(innerEdges, lca, middle);
  }

  // ——— 2. Un placement ELK par bloc racine, à plusieurs formes ———
  // Sens et rapport d'aspect par niveau : dans un conteneur de feuilles, ELK empile
  // les composantes (cartes non reliées) selon `elk.aspectRatio` — c'est ce qui
  // range un tenant en grille ; dans un conteneur dont tous les enfants portent des
  // ports, ELK n'a plus de composantes libres à empiler et c'est `elk.direction`
  // qui décide s'ils se rangent en ligne ou en colonne.
  // Un conteneur nommé par le plan : ELK n'y choisit plus l'ordre ni l'axe. Il le
  // reçoit par la position de départ des enfants (un pas par rang sur l'axe voulu)
  // et par le placement semi-interactif ; il garde le routage, qui est son métier.
  const PLAN_STEP = 100000;
  for (const [id, sheet] of Object.entries(plan)) {
    const children = (byParent.get(id) ?? []).map(child => child.id);
    const missing = children.filter(child => !sheet.order.includes(child));
    const extra = sheet.order.filter(child => !children.includes(child));
    if (missing.length || extra.length) throw Error(`${graph.id} : plan de ${id} et graphe en désaccord (${[...missing, ...extra].join(', ')})`);
  }
  // Largeurs imposées par un étirement du plan (voir `stretch`), remplies entre
  // deux passages d'un même bloc. Les placements sont enchaînés un par un.
  const stretchWidth = new Map();
  const containerOptions = (id, leafRatio, leafDir, choice) => {
    const leaf = isLeafGroup(id, byParent, groupIds), root = !parentOf.get(id);
    const sheet = plan[id];
    const own = leaf ? choice?.get(id) : null;
    if (own) { leafRatio = own.ratio; leafDir = own.direction; }
    const inside = sheet ? (sheet.axis === 'col' ? 'DOWN' : 'RIGHT')
      : leaf ? (leafDir ?? options.leafDirection ?? options.inner ?? options.direction)
        : (options.groupDirection ?? options.inner ?? options.direction);
    const base = baseOptions(inside, options.layerGap, options);
    // Le plan pilote l'ordre : l'ordre du modèle et la post-compaction n'ont plus
    // rien à décider ici, et la seconde refuse les boîtes que le plan a écartées
    // (« Invalid hitboxes for scanline constraint calculation »).
    if (sheet) { delete base['elk.layered.considerModelOrder.strategy']; base['elk.layered.compaction.postCompaction.strategy'] = 'NONE'; }
    return { ...base,
      ...(isBoundary(id) ? { 'elk.hierarchyHandling': root && options.split !== 'all' ? 'INCLUDE_CHILDREN' : 'SEPARATE_CHILDREN' } : {}),
      'elk.padding': containerPadding,
      'elk.nodeSize.constraints': 'MINIMUM_SIZE',
      'elk.nodeSize.minimum': `(${Math.max(minimumWidth(items.get(id)), stretchWidth.get(id) ?? 0)}, 120)`,
      // Un conteneur de feuilles que le plan empile (col ou rangée) garde ses ports
      // sur le côté déclaré : nesté, un port libre ramène ses cartes en colonnes et
      // casse l'axe imposé (mesuré sur GH_PILOTAGE / HORS_GH sous Z_GHX). Un
      // conteneur intermédiaire (tenants) garde des ports libres, sans quoi ELK
      // réordonne ses sous-conteneurs.
      ...(portsOf.has(id) ? { 'elk.portConstraints': root || (sheet && leaf) || options.portSide === 'fixed' ? 'FIXED_SIDE' : 'FREE' } : {}),
      ...(sheet
        ? { 'elk.separateConnectedComponents': 'false',
            'elk.layered.layering.strategy': 'INTERACTIVE',
            'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
            'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
            // Repère du placement semi-interactif : le coin, pas le centre. Avec
            // le centre (valeur par défaut d'ELK), un port de conteneur suffit à
            // ramener deux rangs du plan sur la même rangée (mesuré).
            'elk.layered.interactiveReferencePoint': 'TOP_LEFT',
            'elk.layered.nodePlacement.strategy': 'SIMPLE' }
        : { 'elk.aspectRatio': String(leaf ? leafRatio : (options.groupRatio ?? leafRatio)) }) };
  };
  const buildNode = (id, leafRatio, leafDir, choice, rank = null, axis = null) => {
    const seat = rank === null ? {} : axis === 'col' ? { x: 0, y: rank * PLAN_STEP } : { x: rank * PLAN_STEP, y: 0 };
    if (!groupIds.has(id)) return { id, width: CARD.width, height: CARD.height, ...seat };
    const sheet = plan[id];
    return { id, ...seat, layoutOptions: containerOptions(id, leafRatio, leafDir, choice), ports: portsOf.get(id) ?? [],
      children: (byParent.get(id) ?? []).map(child =>
        buildNode(child.id, leafRatio, leafDir, choice, sheet ? sheet.order.indexOf(child.id) : null, sheet?.axis)),
      edges: innerEdges.get(id) ?? [] };
  };
  // elkjs écrit le résultat dans le graphe qu'on lui passe : chaque essai part
  // d'une copie, sinon les positions de l'essai précédent restent sur les ports.
  // Enfants que le plan veut sur toute la largeur de leur parent, dans ce bloc.
  const stretchPairs = Object.entries(plan).flatMap(([parentId, sheet]) => (sheet.stretch ?? []).map(child => [parentId, child]));
  const layoutOnce = async (id, leafRatio, leafDir, choice) => {
    const node = structuredClone(buildNode(id, leafRatio, leafDir, choice));
    // Un bloc racine que le plan ne nomme pas est lui-même un conteneur de
    // feuilles : la forme essayée est la sienne.
    if (!plan[id]) { node.layoutOptions['elk.aspectRatio'] = String(leafRatio); node.layoutOptions['elk.direction'] = leafDir; }
    const wrapper = { id: '__wrap', layoutOptions: { 'elk.algorithm': 'layered', 'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL', 'elk.padding': '[top=0,left=0,bottom=0,right=0]' }, children: [node], edges: [] };
    const out = (await elk.layout(wrapper)).children[0];
    return { ratio: leafRatio, direction: leafDir, width: out.width, height: out.height, ...readBlock(out, graph.id) };
  };
  const layoutBlock = async (id, leafRatio, leafDir, choice = null) => {
    stretchWidth.clear();
    let shape = await layoutOnce(id, leafRatio, leafDir, choice);
    // Étirement : l'enfant repris à la largeur utile de son parent, puis on rejoue
    // — le parent peut s'élargir en accueillant l'enfant élargi, d'où l'itération.
    for (let pass = 0; pass < 3 && stretchPairs.length; pass++) {
      const size = boxId => shape.boxes.find(box => box.id === boxId);
      let changed = false;
      for (const [parentId, childId] of stretchPairs) {
        const child = size(childId);
        // « Sur toute la largeur » se mesure sur les frères, pas sur le parent :
        // le parent s'élargit avec l'enfant, la cible reculerait à chaque passage.
        const widest = Math.max(...(byParent.get(parentId) ?? []).filter(item => item.id !== childId)
          .map(item => size(item.id)?.width ?? 0), 0);
        if (!child || !widest) continue;
        if (widest > (stretchWidth.get(childId) ?? 0) + 0.5 && child.width < widest - 0.5) { stretchWidth.set(childId, widest); changed = true; }
      }
      if (!changed) break;
      shape = await layoutOnce(id, leafRatio, leafDir, choice);
    }
    stretchWidth.clear();
    return shape;
  };
  // Un bloc entièrement décrit par le plan n'a plus de conteneur de feuilles libre :
  // le moteur n'y place plus rien, une seule forme suffit.
  const hasFreeLeaf = id => (function walk(node) {
    if (!groupIds.has(node)) return false;
    if (isLeafGroup(node, byParent, groupIds)) return !plan[node];
    return (byParent.get(node) ?? []).some(child => walk(child.id));
  })(id);
  const shapesOf = new Map();
  for (const id of rootIds) {
    if (!groupIds.has(id)) { shapesOf.set(id, [{ ratio: null, width: CARD.width, height: CARD.height, boxes: [], pieces: new Map() }]); continue; }
    const shapes = [];
    // Formes essayées : le rapport d'aspect et le sens des conteneurs de feuilles
    // que le plan ne nomme pas — c'est là, et là seulement, que le moteur place
    // encore. Un bloc que le plan décrit entièrement n'a qu'une forme.
    const tries = hasFreeLeaf(id) ? BLOCK_RATIOS : [BLOCK_RATIOS[0]];
    const keep = shape => { if (!shapes.some(kept => kept.width <= shape.width && kept.height <= shape.height)) shapes.push(shape); };
    // Chaque essai relève aussi la forme que **chaque** conteneur de feuilles a
    // prise : un même bloc mélange ainsi les meilleures formes de ses feuilles au
    // lieu de leur imposer un réglage unique.
    const perLeaf = new Map();
    for (const leafDir of ['RIGHT', 'DOWN']) for (const leafRatio of tries) {
      const shape = await layoutBlock(id, leafRatio, leafDir);
      for (const box of shape.boxes) {
        if (!groupIds.has(box.id) || !isLeafGroup(box.id, byParent, groupIds) || plan[box.id]) continue;
        if (!perLeaf.has(box.id)) perLeaf.set(box.id, []);
        perLeaf.get(box.id).push({ ratio: leafRatio, direction: leafDir, width: box.width, height: box.height });
      }
      if (process.env.FRAME_TRACE === id) console.log('   ', leafRatio, leafDir, Math.round(shape.width), 'x', Math.round(shape.height),
        shape.boxes.filter(b => groupIds.has(b.id)).map(b => `${b.id}=${Math.round(b.width)}x${Math.round(b.height)}`).join(' '));
      keep(shape);
    }
    // Mélanges : sous un plafond de largeur, chaque feuille prend la forme la plus
    // plate qui y tient (à défaut la plus étroite). Le plafond balaie les largeurs
    // que les feuilles savent atteindre, ce qui trace la frontière du bloc entre
    // « plat et large » et « étroit et haut ». Le cadre choisit ensuite le mélange
    // qui l'arrange — c'est lui, et lui seul, qui connaît le rapport à tenir.
    const caps = [...new Set([...perLeaf.values()].flat().map(shape => shape.width))].sort((a, b) => a - b);
    for (const cap of caps) {
      const under = list => list.filter(shape => shape.width <= cap);
      const flattest = list => (under(list).length ? under(list) : list)
        .reduce((a, b) => b.height < a.height || (b.height === a.height && b.width < a.width) ? b : a);
      const choice = new Map([...perLeaf].map(([leafId, list]) => [leafId, flattest(list)]));
      if (!choice.size) break;
      const shape = await layoutBlock(id, BLOCK_RATIOS[0], 'RIGHT', choice);
      if (process.env.FRAME_TRACE === id) console.log('    mélange ≤' + cap, Math.round(shape.width), 'x', Math.round(shape.height),
        shape.boxes.filter(b => groupIds.has(b.id)).map(b => `${b.id}=${Math.round(b.width)}x${Math.round(b.height)}`).join(' '));
      keep({ ...shape, choice });
    }
    shapesOf.set(id, shapes.filter((shape, index) =>
      !shapes.some((other, j) => j !== index && other.width <= shape.width && other.height <= shape.height)));
    if (process.env.FRAME_TRACE) console.log('  formes', id, shapesOf.get(id).map(sh => `${sh.ratio}${sh.direction ? '/' + sh.direction[0] : ''}:${Math.round(sh.width)}x${Math.round(sh.height)}`).join('  '));
  }

  // ——— 3. Le cadre : la bande de colonnes, entre le nord et le sud ———
  // Couloirs dimensionnés sur ce qu'ils portent, jamais devinés : la plus large
  // étiquette du couloir plus deux marges, et une voie de 40 px par tronçon.
  // Voies d'un couloir : tous les tronçons qui y passent, étiquetés ou non.
  const usersOf = corridor => frameEdges.filter(piece => piece.lanes.includes(corridor));
  const labelledIn = region => frameEdges.filter(piece => piece.region === region);
  const tallest = frameEdges.reduce((max, piece) => Math.max(max, piece.labels[0]?.height ?? 0), 0);
  const marge = options.frameMargin ?? 56;
  const widthFor = corridor => {
    const widest = labelledIn(corridor).reduce((max, piece) => Math.max(max, piece.labels[0]?.width ?? 0), 0);
    return Math.max(2 * marge, widest ? widest + 2 * marge : 0, 40 * (usersOf(corridor).length + 1));
  };
  const heightFor = corridor => Math.max(2 * marge,
    labelledIn(corridor).length ? tallest + 2 * marge : 0, 40 * (usersOf(corridor).length + 1));
  const chMin = band.slice(0, -1).map((_, index) => widthFor(`V${index}`));
  const gapNmin = heightFor('HN'), gapSmin = heightFor('HS');
  // Les colonnes sont **alignées par le haut** : rien ne flotte au milieu d'une
  // bande, et le vide sous une colonne courte est le seul que le plan impose.
  const arrange = (pick, ch, gapN, gapS) => {
    const north = pick[faces.north], south = pick[faces.south];
    const bandHeight = Math.max(...band.map(id => pick[id].height));
    const bandTop = north.height + gapN;
    const at = {};
    let x = 0;
    band.forEach((id, index) => { at[id] = { x, y: bandTop }; x += pick[id].width + (ch[index] ?? 0); });
    const anchorBox = { ...at[band[anchor]], width: pick[band[anchor]].width };
    at[faces.north] = { x: anchorBox.x + (anchorBox.width - north.width) / 2, y: 0 };
    at[faces.south] = { x: anchorBox.x + (anchorBox.width - south.width) / 2, y: bandTop + bandHeight + gapS };
    const left = Math.min(...rootIds.map(id => at[id].x));
    const right = Math.max(...rootIds.map(id => at[id].x + pick[id].width));
    return { at, ch, gapN, gapS, bandTop, bandHeight, width: right - left, height: bandTop + bandHeight + gapS + south.height };
  };
  // Le rapport reste une porte dure : la largeur des couloirs, qui ne coûte pas de
  // hauteur, ramène un cadre trop étroit ; un cadre trop large paie en hauteur sur
  // les couloirs nord et sud. La combinaison retenue est celle dont la hauteur
  // finale est la plus faible — c'est elle qui fixe la taille du texte, la scène
  // étant ajustée à une vue plus large qu'elle (1 440 × 900, panneau 1,87).
  const target = { low: RATIO_TARGET.low, high: options.ratioHigh ?? RATIO_TARGET.high };
  const fit = (pick) => {
    let ch = [...chMin], gapN = gapNmin, gapS = gapSmin, frame = arrange(pick, ch, gapN, gapS);
    for (let pass = 0; pass < 6; pass++) {
      const ratio = frame.width / frame.height;
      if (ratio < target.low - 1e-9) {
        const add = (target.low * frame.height - frame.width) / Math.max(1, ch.length);
        ch = ch.map(gap => gap + add);
      } else if (ratio > target.high + 1e-9) {
        const add = (frame.width / target.high - frame.height) / 2;
        gapN += add; gapS += add;
      } else break;
      frame = arrange(pick, ch, gapN, gapS);
    }
    return frame;
  };
  let best = null;
  const combine = (ids, pick) => {
    if (!ids.length) {
      const frame = fit(pick);
      const ratio = frame.width / frame.height;
      if (ratio < RATIO.min || ratio > RATIO.max) return;
      if (!best || frame.height < best.frame.height - 1e-6
        || (Math.abs(frame.height - best.frame.height) <= 1e-6 && frame.width < best.frame.width)) best = { frame, pick: { ...pick } };
      return;
    }
    const [id, ...rest] = ids;
    for (const shape of shapesOf.get(id)) combine(rest, { ...pick, [id]: shape });
  };
  combine(rootIds, {});
  if (!best) throw Error(`${graph.id} : aucune combinaison de formes ne tient le rapport 4:3 – 16:9`);
  const { frame, pick } = best;

  // ——— 4. Relecture : coordonnées absolues, tronçons de couloir ———
  const absolute = new Map(), relative = new Map(), sizes = new Map(), pieces = new Map();
  for (const id of rootIds) {
    const block = pick[id], origin = frame.at[id];
    relative.set(id, { x: origin.x, y: origin.y });
    absolute.set(id, { x: origin.x, y: origin.y });
    sizes.set(id, { width: block.width, height: block.height });
    for (const box of block.boxes) {
      relative.set(box.id, { x: box.rx, y: box.ry });
      absolute.set(box.id, { x: origin.x + box.x, y: origin.y + box.y });
      sizes.set(box.id, { width: box.width, height: box.height });
    }
    for (const [pieceId, piece] of block.pieces) pieces.set(pieceId, {
      points: piece.points.map(point => ({ x: origin.x + point.x, y: origin.y + point.y })),
      label: piece.label ? { ...piece.label, x: origin.x + piece.label.x, y: origin.y + piece.label.y } : null });
  }
  // Accroche d'un tronçon de cadre : l'extrémité que le placement ELK du bloc a
  // posée sur le bord ; pour une carte posée à la racine, une position répartie
  // sur le bord demandé.
  const rootAnchors = new Map();
  for (const piece of frameEdges) for (const [chain, side] of [[piece.up, piece.sideOut], [piece.down, piece.sideIn]]) {
    const id = chain.at(-1) ?? (chain === piece.up ? piece.edge.source : piece.edge.target);
    if (chain.length) continue;
    put(rootAnchors, `${id}|${side}`, piece.edge.id);
  }
  const anchorOn = new Map();
  for (const [key, list] of rootAnchors) {
    const [id, side] = key.split('|');
    const box = { ...absolute.get(id), ...sizes.get(id) };
    list.forEach((edgeId, index) => {
      const share = (index + 1) / (list.length + 1);
      anchorOn.set(`${edgeId}|${id}|${side}`, side === 'NORTH' ? { x: box.x + box.width * share, y: box.y }
        : side === 'SOUTH' ? { x: box.x + box.width * share, y: box.y + box.height }
        : side === 'WEST' ? { x: box.x, y: box.y + box.height * share }
        : { x: box.x + box.width, y: box.y + box.height * share });
    });
  }
  const endpointOf = (piece, way) => {
    const chain = way === 'out' ? piece.up : piece.down;
    const owner = chain.at(-1) ?? (way === 'out' ? piece.edge.source : piece.edge.target);
    if (!chain.length) return anchorOn.get(`${piece.edge.id}|${owner}|${way === 'out' ? piece.sideOut : piece.sideIn}`);
    const routed = pieces.get(`${piece.edge.id}__${way === 'out' ? 'u' : 'd'}__${owner}`);
    if (!routed) throw Error(`${graph.id} : tronçon manquant pour ${piece.edge.id} sur ${owner}`);
    return way === 'out' ? routed.points.at(-1) : routed.points[0];
  };
  // Une voie par tronçon dans chaque couloir : elles ne se superposent pas.
  const span = (from, to, index, total) => from + (to - from) * (index + 1) / (total + 1);
  const northBox = { ...absolute.get(faces.north), ...sizes.get(faces.north) };
  const southBox = { ...absolute.get(faces.south), ...sizes.get(faces.south) };
  const bounds = new Map([['HN', [northBox.y + northBox.height, frame.bandTop]],
    ['HS', [frame.bandTop + frame.bandHeight, southBox.y]],
    ...band.slice(0, -1).map((id, index) => [`V${index}`,
      [frame.at[id].x + pick[id].width, frame.at[band[index + 1]].x]])]);
  // Une voie par tronçon et par couloir, répartie sur la largeur (ou la hauteur)
  // du couloir : deux tracés ne se superposent jamais dans le même couloir.
  const lane = new Map();
  for (const [corridor, [lo, hi]] of bounds) {
    const list = usersOf(corridor);
    list.forEach((piece, index) => lane.set(`${piece.edge.id}|${corridor}`, span(lo, hi, index, list.length)));
  }
  const laneAt = (piece, corridor) => lane.get(`${piece.edge.id}|${corridor}`);
  for (const piece of frameEdges) {
    const a = endpointOf(piece, 'out'), b = endpointOf(piece, 'in');
    let points, main;
    if (piece.kind === 'voisines') {
      const mx = laneAt(piece, piece.lanes[0]);
      points = [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
      main = [{ x: mx, y: a.y }, { x: mx, y: b.y }];
    } else if (piece.kind === 'survol') {
      // Colonnes non voisines : on monte par le couloir qui borde le départ, on
      // survole toute la bande, on redescend par celui qui borde l'arrivée.
      const [out, , into] = piece.lanes;
      const x1 = laneAt(piece, out), x2 = laneAt(piece, into), my = laneAt(piece, 'HN');
      points = [a, { x: x1, y: a.y }, { x: x1, y: my }, { x: x2, y: my }, { x: x2, y: b.y }, b];
      main = [{ x: x1, y: my }, { x: x2, y: my }];
    } else if (piece.kind === 'aplomb') {
      // Nord ou sud face à la colonne d'ancrage : un seul décrochement.
      const my = laneAt(piece, piece.region);
      points = [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
      main = [{ x: a.x, y: my }, { x: b.x, y: my }];
    } else if (piece.sideOut === 'SOUTH' || piece.sideOut === 'NORTH') {
      points = [a, { x: a.x, y: b.y }, b];
      main = [{ x: a.x, y: b.y }, b];
    } else {
      points = [a, { x: b.x, y: a.y }, b];
      main = [a, { x: b.x, y: a.y }];
    }
    const text = piece.labels[0];
    const at = { x: (main[0].x + main[1].x) / 2, y: (main[0].y + main[1].y) / 2 };
    pieces.set(piece.id, { points,
      label: text ? { x: at.x - text.width / 2, y: at.y - text.height / 2, width: text.width, height: text.height } : null });
  }

  // ——— 5. Recollement : une liaison = ses tronçons bout à bout ———
  const edges = graph.edges.map(edge => {
    const order = [...boundaries(edge.source).map(id => `${edge.id}__u__${id}`), `${edge.id}__m`,
      ...boundaries(edge.target).map(id => `${edge.id}__d__${id}`).reverse()];
    const parts = order.map(id => pieces.get(id)).filter(Boolean);
    const points = parts.flatMap(part => part.points).filter((point, index, all) =>
      !index || Math.abs(point.x - all[index - 1].x) > .5 || Math.abs(point.y - all[index - 1].y) > .5);
    return { id: edge.id, points, label: parts.map(part => part.label).find(Boolean) ?? null };
  });
  for (const edge of edges) for (let i = 1; i < edge.points.length; i++) {
    const p = edge.points[i - 1], q = edge.points[i];
    if (Math.abs(p.x - q.x) < 1) q.x = p.x;
    if (Math.abs(p.y - q.y) < 1) q.y = p.y;
  }

  // Cadre publié : l'emprise réelle (boîtes, étiquettes, tracés) plus la marge racine.
  const all = [...[...sizes.keys()].map(id => ({ ...absolute.get(id), ...sizes.get(id) })),
    ...edges.filter(edge => edge.label).map(edge => edge.label),
    ...edges.flatMap(edge => edge.points.map(point => ({ x: point.x, y: point.y, width: 0, height: 0 })))];
  const minX = Math.min(...all.map(box => box.x)), minY = Math.min(...all.map(box => box.y));
  const maxX = Math.max(...all.map(box => box.x + box.width)), maxY = Math.max(...all.map(box => box.y + box.height));
  const dx = options.rootPadding - minX, dy = options.rootPadding - minY;
  for (const id of [...absolute.keys()]) {
    const at = absolute.get(id);
    absolute.set(id, { x: at.x + dx, y: at.y + dy });
    if (rootIds.includes(id)) relative.set(id, { x: at.x + dx, y: at.y + dy });
  }
  for (const edge of edges) {
    edge.points = edge.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
    if (edge.label) edge.label = { ...edge.label, x: edge.label.x + dx, y: edge.label.y + dy };
  }
  return { canvas: { width: maxX - minX + 2 * options.rootPadding, height: maxY - minY + 2 * options.rootPadding },
    absolute, relative, size: sizes, edges };
}

// Relecture d'un placement de bloc : boîtes en coordonnées relatives au parent et
// absolues dans le bloc, tronçons ELK ramenés aux coordonnées du bloc.
function readBlock(node, sceneId) {
  const boxes = [], pieces = new Map(), origins = new Map([[node.id, { x: 0, y: 0 }]]);
  const walk = (parent, origin) => {
    for (const child of parent.children ?? []) {
      const at = { x: origin.x + child.x, y: origin.y + child.y };
      boxes.push({ id: child.id, x: at.x, y: at.y, rx: child.x, ry: child.y, width: child.width, height: child.height });
      origins.set(child.id, at);
      walk(child, at);
    }
  };
  walk(node, { x: 0, y: 0 });
  const collect = (parent, origin) => {
    for (const edge of parent.edges ?? []) {
      const base = edge.container ? origins.get(edge.container) ?? origin : origin;
      const section = edge.sections?.[0];
      if (!section) throw Error(`${sceneId} : ELK n'a pas routé ${edge.id}`);
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
        .map(point => ({ x: base.x + point.x, y: base.y + point.y }));
      const text = edge.labels?.[0];
      pieces.set(edge.id, { points,
        label: text ? { x: base.x + text.x, y: base.y + text.y, width: text.width, height: text.height } : null });
    }
    for (const child of parent.children ?? []) collect(child, origins.get(child.id));
  };
  collect(node, { x: 0, y: 0 });
  return { boxes, pieces };
}
