# Analyse des retours d'usage du 21 septembre 2026 : capitalisation des données annotées, vers de nouveaux critères de ciblage

- Source : [DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md](DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md). Consolidation de deux dossiers indépendants ; la convergence point par point est en annexe A.
- Rendu : [decision-focus.html](decision-focus.html), page h2a Focus autonome et hors ligne, construite par `focus/Makefile`.
- Preuves : [preuves/](preuves/) (contrôle Chromium, captures, empreintes).

## Contenu de la page

- Les 12 sections du Markdown (dont, en tête, « Intention du dossier, objectifs de l'owner » et « Ce que veut Steve ») et l'annexe A, découpées sur leurs titres de niveau 2, rendues telles quelles. Les blocs Mermaid du corps sont remplacés par un renvoi aux scènes.
- Cinq scènes SvelteFlow natives, tirées des cinq blocs Mermaid canoniques de l'annexe B : `criteres-steve`, `modele-donnees`, `flux-import-oracle`, `architecture-ui`, `affichage-abc`. Carte unique A' 460 × 200, Dagre LR récursif, routeur orthogonal du kit h2a.
- Les décisions D1 à D16, sélectionnables ; le bouton « Copier mes décisions (YAML) » copie un bloc Markdown ```yaml prêt à coller dans un commentaire de la PR #794, filtré par « Je suis » (Farid ou Fabien : ses propres décisions, ou toutes) et affiché aussi dans une zone en lecture seule si le presse-papiers est refusé. Le JSON reste interne, réservé à la connexion backend. Brouillon local, rien n'est ratifié.

## Reconstruire

Depuis la racine du worktree :

```sh
make -f docs/architecture/focus/Makefile deps ENV=test-dossier-steve          # une fois : node_modules de la chaîne
make -f docs/spec/reports/dossier-retours-steve/focus/Makefile test ENV=test-dossier-steve
make -f docs/spec/reports/dossier-retours-steve/focus/Makefile build ENV=test-dossier-steve
make -f docs/spec/reports/dossier-retours-steve/focus/Makefile chrome-run ENV=test-dossier-steve   # en arrière-plan, CDP 9243, profil jetable
make -f docs/spec/reports/dossier-retours-steve/focus/Makefile browser ENV=test-dossier-steve
make -f docs/spec/reports/dossier-retours-steve/focus/Makefile proofs ENV=test-dossier-steve
make -f docs/spec/reports/dossier-retours-steve/focus/Makefile chrome-stop ENV=test-dossier-steve
```

La chaîne `docs/architecture/focus` est importée, jamais recopiée ; le kit h2a est monté en lecture seule sur `/kit`. Les traitements tournent dans `node:24-bookworm-slim` sans réseau ; seul le contrôle navigateur joint le Chromium local. Le contrôle ouvre un onglet neuf et le referme.

## Limites

- Aucune migration, aucun import, aucune requête prod ou préprod : les taux de résolution des identifiants restent `non vérifié`.
- Les mesures UI sont textuelles, sur `origin/main` `27891b10`.
- Le dossier COLLAB du 2026-08-16 cité en D4 est lu sur `origin/lane/conductor`, absent de `main`.
