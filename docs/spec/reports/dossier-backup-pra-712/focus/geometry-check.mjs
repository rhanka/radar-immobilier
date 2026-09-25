// Contrôles géométriques exigés par l'owner, sur une géométrie absolue
// { boxes: [{ id, x, y, width, height, group, ancestors }], edges: [{ id, source,
// target, points, label }] } — la même fonction sert au test Node (sur la sortie
// d'ELK) et au contrôle Chromium (sur le DOM rendu, ramené à l'échelle 1).
export const TOLERANCE = { border: 3, center: 4, label: 6 };
export const RATIO = { min: 4 / 3, max: 16 / 9 };

const onBorder = (point, box, tol) => {
  const inX = point.x >= box.x - tol && point.x <= box.x + box.width + tol;
  const inY = point.y >= box.y - tol && point.y <= box.y + box.height + tol;
  const side = Math.abs(point.x - box.x) <= tol ? 'left' : Math.abs(point.x - box.x - box.width) <= tol ? 'right'
    : Math.abs(point.y - box.y) <= tol ? 'top' : Math.abs(point.y - box.y - box.height) <= tol ? 'bottom' : null;
  return inX && inY ? side : null;
};
// Intersection segment / intérieur d'un rectangle (découpage de Liang-Barsky) :
// vaut pour les segments droits comme obliques.
const segmentHitsBox = (a, b, box, inset) => {
  const left = box.x + inset, right = box.x + box.width - inset, top = box.y + inset, bottom = box.y + box.height - inset;
  if (right <= left || bottom <= top) return false;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]]) {
    if (Math.abs(p) < 1e-9) { if (q <= 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t1 - t0 > 1e-6;
};
const distanceToSegment = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
// Distance d'un rectangle d'étiquette à la polyligne : 0 si le trait passe dessous.
const labelDistance = (label, points) => {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (segmentHitsBox(a, b, label, 0)) return 0;
    const corners = [[label.x, label.y], [label.x + label.width, label.y], [label.x, label.y + label.height],
      [label.x + label.width, label.y + label.height], [label.x + label.width / 2, label.y + label.height / 2]];
    for (const [x, y] of corners) best = Math.min(best, distanceToSegment({ x, y }, a, b));
  }
  return best;
};

export function checkGeometry({ boxes, edges, canvas }, { orthogonal = true } = {}) {
  const byId = new Map(boxes.map(box => [box.id, box]));
  const degree = new Map();
  for (const edge of edges) for (const end of [edge.source, edge.target]) degree.set(end, (degree.get(end) ?? 0) + 1);
  const faults = [];
  let worstCenter = 0, worstLabel = 0, crossings = 0, offBorder = 0, detached = 0, oblique = 0, labelOnCard = 0;
  for (const edge of edges) {
    const pts = edge.points;
    for (let i = 1; i < pts.length; i++) if (pts[i].x !== pts[i - 1].x && pts[i].y !== pts[i - 1].y
      && Math.abs(pts[i].x - pts[i - 1].x) > .5 && Math.abs(pts[i].y - pts[i - 1].y) > .5) {
      oblique++; if (orthogonal) faults.push(`${edge.id}: segment oblique`);
    }
    for (const [end, point] of [[edge.source, pts[0]], [edge.target, pts.at(-1)]]) {
      const box = byId.get(end);
      const side = onBorder(point, box, TOLERANCE.border);
      if (!side) { offBorder++; faults.push(`${edge.id}: extrémité hors du bord de ${end}`); continue; }
      if (degree.get(end) === 1) {
        const offset = side === 'left' || side === 'right' ? Math.abs(point.y - (box.y + box.height / 2))
          : Math.abs(point.x - (box.x + box.width / 2));
        worstCenter = Math.max(worstCenter, offset);
        if (offset > TOLERANCE.center) faults.push(`${edge.id}: ${end} à liaison unique, extrémité à ${offset.toFixed(1)} px du milieu`);
      }
    }
    // Boîtes concernées : les deux extrémités et leurs conteneurs ancêtres.
    const concerned = new Set([edge.source, edge.target, ...byId.get(edge.source).ancestors, ...byId.get(edge.target).ancestors]);
    for (const box of boxes) {
      if (concerned.has(box.id)) continue;
      for (let i = 1; i < pts.length; i++) if (segmentHitsBox(pts[i - 1], pts[i], box, 1)) {
        crossings++; faults.push(`${edge.id}: traverse ${box.id}`); break;
      }
    }
    // Un tracé ne traverse pas non plus ses propres cartes d'extrémité.
    for (const end of [edge.source, edge.target]) {
      const box = byId.get(end);
      for (let i = 1; i < pts.length; i++) if (segmentHitsBox(pts[i - 1], pts[i], box, 3)) {
        crossings++; faults.push(`${edge.id}: traverse sa carte ${end}`); break;
      }
    }
    if (edge.label) {
      // Une étiquette ne recouvre aucune carte (les conteneurs, eux, peuvent l'accueillir).
      for (const box of boxes) {
        if (box.group) continue;
        const l = edge.label;
        if (l.x < box.x + box.width - 1 && l.x + l.width > box.x + 1 && l.y < box.y + box.height - 1 && l.y + l.height > box.y + 1) {
          labelOnCard++; faults.push(`${edge.id}: étiquette sur la carte ${box.id}`); break;
        }
      }
      const distance = labelDistance(edge.label, pts);
      worstLabel = Math.max(worstLabel, distance);
      if (distance > TOLERANCE.label) { detached++; faults.push(`${edge.id}: étiquette à ${distance.toFixed(1)} px de sa liaison`); }
    }
  }
  let bends = 0, lengthPx = 0;
  for (const edge of edges) for (let i = 1; i < edge.points.length; i++) {
    const [a, b] = [edge.points[i - 1], edge.points[i]];
    lengthPx += Math.hypot(b.x - a.x, b.y - a.y);
    const c = edge.points[i + 1];
    if (c && Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 1) bends++;
  }
  const ratio = canvas.width / canvas.height;
  if (ratio < RATIO.min - 1e-6 || ratio > RATIO.max + 1e-6) faults.push(`rapport ${ratio.toFixed(3)} hors de [4:3 ; 16:9]`);
  return { faults, ratio, bends, lengthPx, labelOnCard, offBorder, crossings, detached, oblique, worstCenterPx: worstCenter, worstLabelPx: worstLabel,
    singleLinkBoxes: [...degree.values()].filter(count => count === 1).length };
}

// ——— Mise en page : un conteneur de cartes ne se range pas sur une colonne ———
//
// Défaut relevé par l'owner sur la scène d'architecture : « chaque tenant (e.g.
// immo preprod) est bcp trop verticalisé ». En placement par couches, un conteneur
// dont les cartes ne sont reliées entre elles par aucune liaison se range sur une
// seule colonne, et sa hauteur finit par fixer celle de tout le schéma. La porte :
// un conteneur d'au moins quatre cartes occupe au moins deux colonnes.
export const GRID = { minCards: 4, minColumns: 2 };
// Colonnes d'un conteneur, telles qu'on les voit : le plus grand nombre de cartes
// **côte à côte sur une même rangée**. Compter les abscisses distinctes dirait le
// contraire du rendu — le moteur décale de quelques dizaines de pixels des cartes
// qui sont bel et bien l'une sous l'autre, pour laisser passer un tracé.
export function columnsOf(boxes, id) {
  const cards = boxes.filter(box => !box.group && box.ancestors[0] === id);
  const sameRow = (a, b) => a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1;
  return cards.reduce((max, card) => Math.max(max, cards.filter(other => sameRow(card, other)).length), 0);
}
// `exempt` : les conteneurs que la mise en page arbitrée range **explicitement**
// sur une colonne (l'owner : « la zone de réplication ovh autre région,
// verticalisée »). La porte ne leur est pas opposable ; la liste est publiée au
// manifeste pour que la dérogation reste visible.
export function checkGrid(boxes, gate = GRID, exempt = new Set()) {
  const faults = [];
  for (const box of boxes.filter(item => item.group)) {
    if (exempt.has(box.id)) continue;
    const cards = boxes.filter(item => !item.group && item.ancestors[0] === box.id);
    if (cards.length < gate.minCards) continue;
    const columns = columnsOf(boxes, box.id);
    if (columns < gate.minColumns) faults.push(`${box.id} : ${cards.length} cartes sur ${columns} colonne(s), porte ${gate.minColumns}`);
  }
  return faults;
}

// ——— Le plan de l'owner, contrôlé sur le rendu et non sur l'intention ———
//
// Trois choses sont vérifiées en coordonnées absolues du schéma : l'utilisateur
// au nord et l'administration au sud de tout le reste ; les colonnes de la bande
// dans l'ordre donné, sans chevauchement ; et, dans chaque conteneur que le plan
// nomme, ses enfants dans l'ordre donné sur l'axe donné. Un manquement arrête le
// build, comme une liaison mal ancrée.
export function checkPlan(boxes, faces, plan = {}) {
  const byId = new Map(boxes.map(box => [box.id, box]));
  const faults = [];
  const right = box => box.x + box.width, bottom = box => box.y + box.height;
  const band = faces.band ?? [];
  const inside = id => boxes.filter(box => box.id === id || box.ancestors.includes(id));
  const outside = id => boxes.filter(box => box.id !== id && !box.ancestors.includes(id));
  const north = byId.get(faces.north), south = byId.get(faces.south);
  if (!north || !south) return [`faces nord ou sud absentes du rendu`];
  if (bottom(north) > Math.min(...outside(faces.north).map(box => box.y)) + 1)
    faults.push(`${faces.north} : pas au nord de tout le reste`);
  if (south.y < Math.max(...outside(faces.south).map(box => bottom(box))) - 1)
    faults.push(`${faces.south} : pas au sud de tout le reste`);
  // Bande : chaque colonne entièrement à l'ouest de la suivante, contenu compris.
  for (let index = 1; index < band.length; index++) {
    const west = Math.max(...inside(band[index - 1]).map(right));
    const east = Math.min(...inside(band[index]).map(box => box.x));
    if (west > east + 1) faults.push(`colonne ${band[index - 1]} pas à l'ouest de ${band[index]}`);
  }
  for (const [id, sheet] of Object.entries(plan)) {
    // « 100 % verticale » se contrôle sur le rendu : dans un conteneur que le plan
    // empile, jamais deux cartes côte à côte (et l'inverse pour une rangée).
    const cards = boxes.filter(box => !box.group && box.ancestors[0] === id);
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const [a, b] = [cards[i], cards[j]];
      const side = sheet.axis === 'col'
        ? a.y < bottom(b) - 1 && bottom(a) > b.y + 1
        : a.x < right(b) - 1 && right(a) > b.x + 1;
      if (side) faults.push(`${id} : ${a.id} et ${b.id} ${sheet.axis === 'col' ? 'côte à côte' : "l'un sous l'autre"}`);
    }
    // « Sur toute la largeur » : aussi large que le plus large de ses frères.
    for (const childId of sheet.stretch ?? []) {
      const child = byId.get(childId);
      const widest = Math.max(...sheet.order.filter(other => other !== childId).map(other => byId.get(other)?.width ?? 0), 0);
      if (child && widest && child.width < widest - 2)
        faults.push(`${id} : ${childId} large de ${Math.round(child.width)} px contre ${Math.round(widest)} px`);
    }
    for (let index = 1; index < sheet.order.length; index++) {
      const before = byId.get(sheet.order[index - 1]), after = byId.get(sheet.order[index]);
      if (!before || !after) { faults.push(`${id} : ${sheet.order[index - 1]} ou ${sheet.order[index]} absent du rendu`); continue; }
      if (sheet.axis === 'col' && bottom(before) > after.y + 1)
        faults.push(`${id} : ${sheet.order[index - 1]} pas au nord de ${sheet.order[index]}`);
      if (sheet.axis === 'row' && right(before) > after.x + 1)
        faults.push(`${id} : ${sheet.order[index - 1]} pas à l'ouest de ${sheet.order[index]}`);
    }
  }
  return faults;
}

// ——— Lisibilité : taille effective du texte une fois la scène ajustée à la vue ———
//
// Portes ratifiées par le Design System : à 1440 × 900, scène ajustée à la vue,
// aucun texte sous **12 px** (plancher, plus 11) ; en A4 paysage, plancher
// intérimaire de **8 pt pour le texte de lecture** (repère, titre, détail, dépôt,
// en-tête de conteneur) et **7 pt pour l'annotation secondaire** (étiquette de
// liaison). Le format 1920 × 1080 est mesuré et publié, sans porte.
// Le taux de remplissage n'est plus un critère contractuel : il reste publié comme
// indicateur. La règle ratifiée est qu'un libellé ne s'affiche que s'il tient sans
// troncature à la taille minimale.
export const LEGIBILITY = { minPx: 12, minPt: 8, minPtAnnotation: 7, annotationRoles: ['liaison'] };
export const PT_PER_PX = 0.75;
// Zones d'affichage (panneau `.flow` du schéma), relevées dans Chromium et
// recontrôlées par browser-check.mjs : à l'écran, la colonne de la page et
// min(900 px, 100vh − 180 px) de haut ; à l'impression, 26 × 17,5 cm sur A4 paysage.
export const FORMATS = {
  '1440x900': { medium: 'screen', viewport: { width: 1440, height: 900 }, panel: { width: 1345, height: 720 }, gate: true },
  '1920x1080': { medium: 'screen', viewport: { width: 1920, height: 1080 }, panel: { width: 1800, height: 900 }, gate: false },
  'A4-paysage': { medium: 'print', panel: { width: 26 / 2.54 * 96, height: 17.5 / 2.54 * 96 }, gate: true },
};
// Taille des textes par rôle, en px du schéma à l'échelle 1 : gabarit A’ pour
// ELK (ServiceNode, Subflow, étiquette de liaison). `detail` couvre les deux
// lignes de détail (nom et détail), `depot` les étiquettes « repo: », `code` le
// repère de carte (PG-PP…). Le rôle `liaison` est l'annotation secondaire, seule
// admise à 7 pt en impression. (Le jeu de rôles Graphviz a été retiré avec le
// rendu dot, ARCH-7.)
export const TEXT_ROLES = {
  elk: { code: 22, titre: 32, detail: 24, depot: 24, liaison: 24, conteneur: 32 },
};

// Échelle « ajuster à la vue » d'un cadre (unités du schéma) dans la zone d'affichage :
// - ELK à l'écran : Viewport.svelte appelle fitBounds de xyflow avec une marge de
//   0,08, que xyflow convertit en pixels entiers de chaque côté, floor((V − V / 1,08) / 2) ;
// - ELK à l'impression : la feuille print applique min(panneau / cadre), sans marge ;
// (Le second moteur, retiré avec ARCH-7, ajustait son SVG au panneau moins 8 px ;
//   la branche correspondante est conservée pour un `frame` déjà calculé.)
export function fitScale(frame, format, engine) {
  const { width, height } = FORMATS[format].panel;
  if (engine === 'elk' && FORMATS[format].medium === 'screen') {
    const pad = value => Math.floor((value - value / 1.08) * 0.5);
    return Math.min((width - 2 * pad(width)) / frame.width, (height - 2 * pad(height)) / frame.height);
  }
  if (engine === 'elk') return Math.min(width / frame.width, height / frame.height);
  return Math.min((width - 16) / frame.width, (height - 16) / frame.height);
}

// Taille effective par rôle : taille du texte × échelle réellement appliquée.
// `sizes` : { rôle: [taille en unités du schéma, …] } (DOM) ou { rôle: taille } (gabarit).
export function effectiveText(sizes, scale, format) {
  const byRolePx = {};
  for (const [role, value] of Object.entries(sizes)) {
    const list = Array.isArray(value) ? value : [value];
    if (list.length) byRolePx[role] = Math.min(...list) * scale;
  }
  const [minRole, minPx] = Object.entries(byRolePx).reduce((low, entry) => entry[1] < low[1] ? entry : low, ['', Infinity]);
  const print = FORMATS[format].medium === 'print';
  return { format, scale, minPx, minRole, minPt: print ? minPx * PT_PER_PX : null, byRolePx };
}

// Porte de lisibilité : un format à porte ne laisse aucun texte sous le seuil.
// À l'écran, un seuil unique (12 px) pour tous les rôles. À l'impression, deux
// planchers : 8 pt pour le texte de lecture, 7 pt pour l'annotation secondaire
// (étiquette de liaison). Le contrôle est fait rôle par rôle, pas sur le seul
// minimum, sinon un rôle de lecture sous 8 pt passerait inaperçu dès qu'une
// annotation est plus petite que lui.
export const printGateFor = role => LEGIBILITY.annotationRoles.includes(role) ? LEGIBILITY.minPtAnnotation : LEGIBILITY.minPt;
export function checkLegibility(measure) {
  const format = FORMATS[measure.format];
  if (!format.gate) return [];
  if (format.medium === 'screen') {
    return measure.minPx < LEGIBILITY.minPx - 1e-9
      ? [`${measure.format} : texte le plus petit (${measure.minRole}) à ${measure.minPx.toFixed(2)} px, porte ${LEGIBILITY.minPx} px`]
      : [];
  }
  const faults = [];
  for (const [role, px] of Object.entries(measure.byRolePx)) {
    const gate = printGateFor(role);
    const pt = px * PT_PER_PX;
    if (pt < gate - 1e-9) faults.push(`${measure.format} : ${role} à ${pt.toFixed(2)} pt, porte ${gate} pt`);
  }
  return faults;
}

// Éclatement : surface des cartes et des conteneurs (boîtes de premier niveau,
// qui contiennent les autres) rapportée à la surface du cadre ajusté à la vue ;
// et, à part, la seule surface des cartes.
export function fillRate(boxes, frame) {
  const area = box => box.width * box.height;
  const total = frame.width * frame.height;
  return { blocks: boxes.filter(box => !box.ancestors.length).reduce((sum, box) => sum + area(box), 0) / total,
    cards: boxes.filter(box => !box.group).reduce((sum, box) => sum + area(box), 0) / total };
}

// Mesure complète d'un placement, au build : les trois formats, le remplissage,
// les proportions du cadre face à celles de chaque zone d'affichage.
export function legibilityFrom(geometry, frame, engine) {
  const formats = Object.keys(FORMATS).map(format => {
    const measure = effectiveText(TEXT_ROLES[engine], fitScale(frame, format, engine), format);
    const panel = FORMATS[format].panel;
    return { ...measure, frameRatio: frame.width / frame.height, panelRatio: panel.width / panel.height,
      faults: checkLegibility(measure) };
  });
  return { formats, fill: fillRate(geometry.boxes, frame), faults: formats.flatMap(item => item.faults) };
}

// Géométrie absolue à partir d'une mise en page ELK et du graphe.
export function geometryFrom(graph, layout) {
  const parentOf = new Map([...graph.groups, ...graph.nodes].map(item => [item.id, item.parent]));
  const ancestors = id => { const out = []; let p = parentOf.get(id); while (p) { out.push(p); p = parentOf.get(p); } return out; };
  const boxes = [...graph.groups, ...graph.nodes].map(item => ({ id: item.id, ...layout.absolute.get(item.id),
    ...layout.size.get(item.id), group: graph.groups.includes(item), ancestors: ancestors(item.id) }));
  const edges = graph.edges.map(edge => {
    const routed = layout.edges.find(candidate => candidate.id === edge.id);
    return { id: edge.id, source: edge.source, target: edge.target, points: routed.points, label: routed.label };
  });
  // Cadre du rapport largeur / hauteur, pris comme le contrôle Chromium le prend sur
  // le rendu : un `frame` fourni s'il existe ; sinon, pour ELK, l'emprise des
  // boîtes et des étiquettes (sans la marge racine).
  const all = [...boxes, ...edges.filter(edge => edge.label).map(edge => edge.label)];
  const canvas = layout.frame ?? { width: Math.max(...all.map(box => box.x + box.width)) - Math.min(...all.map(box => box.x)),
    height: Math.max(...all.map(box => box.y + box.height)) - Math.min(...all.map(box => box.y)) };
  return { boxes, edges, canvas };
}
