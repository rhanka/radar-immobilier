// Charts placed in the dossier text by `<!-- chart:<id> -->` markers. Every figure is a
// copy of a table of the same section (mapping.test.mjs compares them to the Markdown).
//   stacked  one bar per row, split by classement (Pertinent / À surveiller / Non pertinent)
//   grouped  two bars per row (passe 1, 124 lignes)
//   percent  one bar per row, a percentage
export const SERIES = {
  P: { label: 'Pertinent', token: 'p' },
  S: { label: 'À surveiller', token: 's' },
  N: { label: 'Non pertinent', token: 'n' },
};

export const CHARTS = {
  'sens-classement': {
    kind: 'stacked',
    title: 'Sens de la modification × classement de Steve (124 lignes)',
    note: 'Entre parenthèses : lignes de la passe 1 (vue de travail, 73 signaux). 23 assouplissements sont Non pertinent, surtout des autorisations au cas par cas : le sens seul ne suffit pas (§5.3).',
    source: '§2.2 et §5.3, feuille Triage (CALCUL)',
    rows: [
      { label: 'Assouplissement', values: { P: 27, S: 5, N: 23 }, extra: 35 },
      { label: 'Indéterminé', values: { P: 7, S: 21, N: 10 }, extra: 21 },
      { label: 'Neutre', values: { P: 1, S: 0, N: 13 }, extra: 6 },
      { label: 'Restriction', values: { P: 0, S: 3, N: 7 }, extra: 6 },
      { label: 'Mixte', values: { P: 5, S: 0, N: 2 }, extra: 5 },
    ],
  },
  'bruit-familles': {
    kind: 'grouped',
    title: 'Les Non pertinent par motif : passe 1 (24 sur 73) et ensemble du relevé (55 sur 124)',
    note: 'Chaque famille correspond à un critère ou une exclusion de Steve. La première barre est le bruit de sa vue de travail ; la seconde, le même motif sur les 124 lignes.',
    source: '§2.2, motifs de la feuille Triage (CALCUL, recompté par motif)',
    series: ['Passe 1', '124 lignes'],
    rows: [
      { label: 'Hors résidentiel ou hors urbanisme', detail: 'N-NON-RES, N-FAUX-POSITIF', values: [3, 10] },
      { label: 'Resserrement', detail: 'N-RESTRICTIF', values: [4, 7] },
      { label: 'Sans effet sur la capacité', detail: 'N-ADMIN, N-FORME, N-UNIFAM, N-ACCESSOIRE', values: [6, 13] },
      { label: 'Autorisation individuelle', detail: 'V2-PRECEDENT', values: [8, 21] },
      { label: 'Point d’ordre du jour', detail: 'N-ODJ-SEUL', values: [3, 4] },
    ],
  },
  'steve-signaux': {
    kind: 'stacked',
    title: 'Lignes de Steve et signaux distincts du radar, par verdict (121 lignes retenues)',
    note: 'Une ligne peut viser plusieurs signaux : 121 lignes → 162 signaux distincts. Les documents (80 distincts) ne s’additionnent pas par verdict : un même PV peut porter des signaux de verdicts différents.',
    source: 'items.json, nodes.json du premier jet (recompté)',
    rows: [
      { label: 'Lignes de Steve', values: { P: 39, S: 29, N: 53 } },
      { label: 'Signaux distincts', values: { P: 55, S: 38, N: 69 } },
    ],
  },
  'classement-passes': {
    kind: 'stacked',
    title: 'Classement de Steve par passe (124 lignes)',
    note: 'Passe 1 : ses cinq filtres cochés ; passe 2 : sans le filtre Précoce ; passe 3 : aucun filtre. 34 des 40 Pertinent sont en passe 1, 38 en passe 1 ou 2.',
    source: '§5.2, feuille Triage (CALCUL)',
    rows: [
      { label: '1 — 5 filtres', values: { P: 34, S: 15, N: 24 } },
      { label: '2 — sans Précoce', values: { P: 4, S: 11, N: 18 } },
      { label: '3 — reste', values: { P: 2, S: 3, N: 12 } },
      { label: 'Hors radar', values: { P: 0, S: 0, N: 1 } },
    ],
  },
  'base-b': {
    kind: 'percent',
    title: 'Base B mesurée sur la vue de travail de Steve (passe 1, 73 signaux)',
    note: 'Point de départ de la comparaison B → C (D13). Le bruit est la part des signaux affichés que Steve juge Non pertinent.',
    source: '§9.3 (CALCUL)',
    rows: [
      { label: 'Bruit (Non pertinent)', value: 32.9, ratio: '24/73', tone: 'n' },
      { label: 'Précision P ∪ S', value: 67.1, ratio: '49/73' },
      { label: 'Précision P', value: 46.6, ratio: '34/73' },
      { label: 'Précision « trois critères »', value: 30.1, ratio: '22/73' },
      { label: 'Part des P en passe 1', value: 85, ratio: '34/40' },
      { label: 'Part des P en passe 1 ou 2', value: 95, ratio: '38/40' },
    ],
  },
};

export const CHART_MARKER = /<!-- chart:([\w-]+) -->/;
