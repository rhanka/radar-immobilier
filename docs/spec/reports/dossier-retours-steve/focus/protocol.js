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
