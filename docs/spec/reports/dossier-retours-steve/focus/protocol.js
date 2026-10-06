// Steve's survey protocol (21 September 2026), shown in the page masthead and in §2.1
// of the Markdown (mapping.test.mjs compares both).
export const PROTOCOL = {
  title: 'Le relevé de Steve du 21 septembre 2026 : trois passes (règle R-26, période de 6 mois)',
  passes: [
    { pass: 'Passe 1', filters: 'Les cinq filtres cochés (Précoce, Résidentiel, Zonage, Exclure PIIA, Exclure dérogation) : la vue de travail par défaut', signals: 73, aim: 'Juger ce que l’outil montre normalement' },
    { pass: 'Passe 2', filters: 'Les mêmes, sans le filtre Précoce', signals: 33, aim: 'Voir ce que le filtre Précoce masquait' },
    { pass: 'Passe 3', filters: 'Aucun filtre', signals: 17, aim: 'Repérer les faux négatifs et les faux positifs' },
  ],
  summary: 'Passe 1 → 34 Pertinent, 15 À surveiller, 24 Non pertinent (bruit 24/73 = 32,9 %). Les 124 lignes = total des lignes de triage sur les trois passes (73 + 33 + 17, plus 1 cas hors radar), 51 villes sur 103.',
};

// Counts measured on the retained set (121 of Steve's lines; excluded: #14, node absent from the
// graph; #55 and #58, no radar signal), shown in the masthead and in §4.2: draft work files items.json and nodes.json; documents = distinct
// docSha cited by the nodes. Recounted for this dossier (mapping.test.mjs checks the sums).
export const SIGNAL_COUNTS = {
  title: 'Ce que visent les 121 lignes retenues : signaux et documents distincts du radar',
  total: { lines: 121, signals: 162, documents: 80, cities: 51, single: 81, multi: 40, missing: 9, excluded: 3 },
  rows: [
    { verdict: 'Pertinent', lines: 39, signals: 55, documents: 36, detail: '34 Signal, 21 DesignationEvent' },
    { verdict: 'À surveiller', lines: 29, signals: 38, documents: 26, detail: '25 Signal, 13 DesignationEvent' },
    { verdict: 'Non pertinent', lines: 53, signals: 69, documents: 39, detail: '42 Signal, 27 DesignationEvent' },
  ],
  summary: '121 lignes de Steve (3 exclues : #14, nœud absent du graphe ; #55 et #58, sans signal radar) → 162 signaux distincts du radar (nœuds relus en production le 2026-10-05, en lecture seule) → 80 documents (PV) distincts, 51 villes. 81 lignes visent un seul signal, 40 en regroupent plusieurs ; 9 lignes citent au moins un signal qui n’existe plus. Les signaux à détecter sont ceux que Steve juge Pertinent : 39 lignes → 55 signaux distincts (34 Signal, 21 DesignationEvent) dans 36 documents. Son analyse cite 22 cas réunissant les trois critères : c’est un périmètre plus étroit, la seule passe 1 et le sens Assouplissement (22 des 34 Pertinent de la passe 1).',
};
