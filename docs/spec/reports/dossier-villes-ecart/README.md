# Villes dont la base et le graphe stocké ne concordent plus : corriger le mélange de nœuds entre villes et remettre 226 villes en cohérence

- Source : [DOSSIER_DECISION_VILLES_ECART_2026-10-04.md](DOSSIER_DECISION_VILLES_ECART_2026-10-04.md). Carte [#812](https://github.com/rhanka/radar-immobilier/issues/812).
- Rendu : [decision-focus.html](decision-focus.html), page h2a Focus autonome et hors ligne, thème clair et sombre, construite par `focus/Makefile`.
- Preuves : [preuves/](preuves/) (contrôle Chromium clair et sombre, captures, empreintes) et [preuves/diagnostic/](preuves/diagnostic/) (fichiers du diagnostic en lecture seule du 2026-10-04).

## Contenu de la page

- Les sections 1 (intention), 2 (contexte en clair) et 3 (synthèse) dépliées ; les sections 4, 5, 6, 8, 9 et l'annexe A repliées, rendues telles quelles. Les blocs Mermaid du corps sont remplacés par un renvoi.
- Scène 1 `architecture-ecart` : SvelteFlow natif tiré du bloc Mermaid de l'annexe B, cinq couloirs verticaux de gauche à droite (utilisateurs, écrans, déclencheurs, traitements, données), carte unique A' 460 × 200 pour les seuls composants réels.
- Figure 2 : diagramme des tables `graph_nodes` et `graph_edges` (style entité-relation, sans carte de composant) et de la ligne `bylaw-242` partagée par gore et barkmere ; source lisible équivalente : bloc `erDiagram` du §4.2.
- Tableau 3 : les huit groupes de villes en barres horizontales (couleur et texte : réparable maintenant ou après D2), puis en tableau détaillé ; comptes vérifiés contre `preuves/diagnostic/groups.json` (total 226).
- Décisions D1 à D7, toutes décidées par Fabien (Farid consulté sur D2 et D3) : chaque bloc rend le §7 du Markdown : le problème, puis chaque option sélectionnable avec sa Description (job CD et paramètres, effet dans S3 et PG, ce que voit l’utilisateur, exemple réel), un mini-schéma pour D1, D2, D4, D5 et D7 (barres avant / après pour acton-vale, dixville, victoriaville, brigham ; lignes de `graph_nodes` et leur clé pour `bylaw-242`), ses avantages et inconvénients, enfin la recommandation. Le bouton « Copier mes décisions (YAML) » copie un bloc Markdown ```yaml sans guillemets (émetteur repris du dossier retours Steve) à coller dans un commentaire de la PR #815. Brouillon local, rien n'est ratifié.

## Reconstruire

Depuis la racine du worktree :

```sh
make -f docs/architecture/focus/Makefile deps ENV=test-dossier-villes-ecart          # une fois : node_modules de la chaîne
make -f docs/spec/reports/dossier-villes-ecart/focus/Makefile test ENV=test-dossier-villes-ecart
make -f docs/spec/reports/dossier-villes-ecart/focus/Makefile build ENV=test-dossier-villes-ecart
make -f docs/spec/reports/dossier-villes-ecart/focus/Makefile chrome-run ENV=test-dossier-villes-ecart   # en arrière-plan, CDP 9245, profil jetable
make -f docs/spec/reports/dossier-villes-ecart/focus/Makefile browser ENV=test-dossier-villes-ecart
make -f docs/spec/reports/dossier-villes-ecart/focus/Makefile proofs ENV=test-dossier-villes-ecart
make -f docs/spec/reports/dossier-villes-ecart/focus/Makefile chrome-stop ENV=test-dossier-villes-ecart
```

La chaîne `docs/architecture/focus` est importée, jamais recopiée ; le kit h2a est monté en lecture seule sur `/kit` ; les lecteurs YAML des tests (`yaml`, `js-yaml`) viennent du `node_modules` racine, monté en lecture seule. Les traitements tournent dans `node:24-bookworm-slim` sans réseau ; seul le contrôle navigateur joint le Chromium local. Le contrôle passe la page en thème clair puis sombre.

## Limites

- Aucune réparation, aucun job, aucune écriture dans un cluster, un bucket ou une base : le dossier repose sur le diagnostic en lecture seule du 2026-10-04.
- `non vérifié` : périmètre exact de l'affichage des preuves étrangères, montant du coût caché, contenu de la sauvegarde PG quotidienne, nombre de nœuds sans ville.
