// Tableau 3 — les huit groupes de villes, chiffrés (§5.1 du dossier), en prod ; `preprod` = §2.0.
// `key` = clé du groupe dans preuves/diagnostic/groups.json ; `cities` est vérifié
// contre ce fichier par mapping.test.mjs. Les autres chiffres sont repris du §5.1.
export const groups = [
  { id: 'G1', preprod: 81, key: 'G1-PG-ontology', cities: 71, label: 'PG en avance, nœuds vides',
    gap: '3 535 nœuds seulement dans PG', cause: 'ancien flux d’exploitation (2026-09-10/11)', remedy: 'projection S3 → PG, puis reprise sans --heal', decision: 'D1', shared: false },
  { id: 'G2', preprod: 68, key: 'G2-S3-collision-refused', cities: 81, label: 'S3 en avance, projection refusée',
    gap: '1 834 nœuds seulement dans S3', cause: 'collision : refus de provenance (59) ou de propriété (22)', remedy: 'après correction : projection depuis S3', decision: 'D2 · D3', shared: true },
  { id: 'G3', preprod: 63, key: 'G3-S3-collision-only', cities: 49, label: 'S3 en avance, collision seule',
    gap: '159 identifiants sous une autre ville', cause: 'collision, projections acceptées', remedy: 'après correction : projection depuis S3', decision: 'D2', shared: true },
  { id: 'G4', preprod: null, key: 'G4-abort-collision', cities: 18, label: 'Reprise avortée, collision',
    gap: '16 nœuds seulement dans S3', cause: 'collision : provenance (11), propriété (7)', remedy: 'après correction : projection', decision: 'D2', shared: true },
  { id: 'G5a', preprod: 0, key: 'G5a-abort-completeness', cities: 3, label: 'Reprise avortée, PG plus riche',
    gap: 'signaux complets 25 PG / 13 S3', cause: 'refs S3 sans extrait ni page', remedy: 'reprise avec --heal', decision: 'D4', shared: false },
  { id: 'G5b', preprod: 1, key: 'G5b-halt-completeness', cities: 1, label: 'victoriaville',
    gap: 'signaux complets 15 PG / 0 S3', cause: 'refs republiées sans extrait (2026-09-29)', remedy: '--heal, ou attendre', decision: 'D5', shared: false },
  { id: 'G5c', preprod: 2, key: 'G5c-local-ref-loss', cities: 2, label: 'Perte de refs',
    gap: 'complétude 38 → 21 (sainte-clotilde)', cause: 'bug du producteur + collision', remedy: 'rien ; analyse du bug', decision: 'D6', shared: true },
  { id: 'G6', preprod: 1, key: 'G6-brigham', cities: 1, label: 'brigham',
    gap: '35 nœuds seulement S3, 21 seulement PG', cause: 'ré-extraction du 2026-07-04 jamais projetée', remedy: 'opération ponctuelle, ou laisser', decision: 'D7', shared: false },
];

// Préprod (preuves/diagnostic/preprod-2026-10-04.json) : G2 et G4 ne sont pas séparés
// (pas de reprise en apply en préprod), G4 vaut donc null et G2 porte les deux.
export const totals = { cities: 226, halted: 205, aborted: 21, preprod: 216 };
