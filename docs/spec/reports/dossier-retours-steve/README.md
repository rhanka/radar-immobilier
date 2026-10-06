# Analyse des retours d'usage du 21 septembre 2026 : capitalisation des données annotées, vers de nouveaux critères de ciblage

- Source : [DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md](DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md), rapport unique restructuré le 2026-10-05 (chapitres 0 à 12, annexes I à IV ; correspondance des anciens numéros en annexe I.6).
- Hors du rapport : [JOURNAL_CONSOLIDATION.md](JOURNAL_CONSOLIDATION.md) (convergence entre les deux auteurs, ancienne annexe A) et [SCENES_FOCUS.md](SCENES_FOCUS.md) (sources canoniques des cinq scènes, ancienne annexe B).
- Rendu : [decision-focus.html](decision-focus.html), page h2a Focus autonome et hors ligne, construite par `focus/Makefile`.
- Preuves : [preuves/](preuves/) (contrôle Chromium, captures, empreintes).

## Contenu de la page

- L'en-tête (0), le glossaire et statuts, les 12 chapitres et les annexes I à IV du Markdown, découpés sur leurs titres de niveau 2, rendus tels quels. Les blocs Mermaid suivis d'un repère sont rendus nativement ; les autres (schémas des options de D2 et D3, annexe III.5) sont remplacés par un renvoi, car ils sont rendus dans les décisions. Les sections en cours de rédaction portent un repère `<!-- A_INTEGRER: <id> -->`.
- Cinq scènes tirées de `SCENES_FOCUS.md`, rendues dans le chapitre qui porte leur repère `<!-- scene:<id> -->` (§2.6, §8.1, §9.2, §9.6, §9.7, montées à l'ouverture du chapitre), chacune dans la forme de son contenu : `criteres-steve` en matrice (tableau Markdown), `modele-donnees` en diagramme entité-relation (`erDiagram` : tables, colonnes clés, cardinalités), `flux-import-oracle` en architecture à couloirs verticaux (utilisateurs, écrans UI, fonctions backend, données S3 et PostgreSQL ; jeu de référence en bande transversale en bas), `affichage-abc` en deux zones (application en couloirs, évaluation hors ligne en bande basse), `architecture-ui` en composants SvelteFlow natifs (carte A' 460 × 200, Dagre LR récursif, routeur orthogonal du kit h2a). Thèmes clair et sombre (préférence système, ou `data-theme` sur `html`).
- Les décisions G1 à G8 et D1 à D17 (D1 et D17 actées par l'owner, D9 proposée close), sélectionnables ; le bouton « Copier mes décisions (YAML) » copie un bloc Markdown ```yaml prêt à coller dans un commentaire de la PR #794, filtré par « Je suis » (Farid ou Fabien : ses propres décisions, ou toutes) et affiché aussi dans une zone en lecture seule si le presse-papiers est refusé. Le JSON reste interne, réservé à la connexion backend. Brouillon local, rien n'est ratifié.

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
