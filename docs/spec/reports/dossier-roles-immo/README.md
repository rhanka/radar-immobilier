# Rôles et droits de décision dans radar-immobilier : application du modèle de rôles humains issu du quorum h2a

- Source : [DOSSIER_DECISION_ROLES_IMMO_2026-10-03.md](DOSSIER_DECISION_ROLES_IMMO_2026-10-03.md), révision r1. Proposition rédigée par Fable 5.1, relue contradictoirement par Astra (gpt-6-astra, xhigh) : 15 constats factuels corrigés, Fable rallié à Astra sur D7 et D8 ; le tableau de consensus est en annexe A.
- Rendu : [decision-focus.html](decision-focus.html), page h2a Focus autonome et hors ligne, construite par `focus/Makefile`.
- Preuves : [preuves/](preuves/) (contrôle Chromium, captures, empreintes).
- Destinataires : Farid (Product Owner, 7 décisions) et Fabien (AI Builder, owner, 11 décisions). Chaque décision porte « Décide : … · Consulté : … » et, s'il y a lieu, la validation croisée (Validation PO, Validation AI Builder).

## Contenu de la page

- Les 12 sections du Markdown (en tête : intention et cadre owner, destinataires et rôles, synthèse avec les deux tableaux « Décisions de Farid » et « Décisions de Fabien ») et l'annexe A, découpées sur leurs titres de niveau 2, rendues telles quelles. Les blocs Mermaid du corps sont remplacés par un renvoi aux scènes.
- Cinq scènes SvelteFlow natives, tirées des cinq blocs Mermaid canoniques de l'annexe B : `roles-perimetres`, `matrice-decide-valide`, `circuit-validation`, `deux-branches-d10`, `immo-vs-geo`. Carte unique A' 460 × 200, Dagre LR récursif, routeur orthogonal du kit h2a.
- Les décisions D1 à D18, sélectionnables ; le bouton « Copier mes décisions (YAML) » copie un bloc Markdown ```yaml prêt à coller dans un commentaire de la PR #795, filtré par « Je suis » (Farid ou Fabien : les décisions qu'il prend et celles où il porte une validation nommée, ou toutes) et affiché aussi dans une zone en lecture seule si le presse-papiers est refusé. Le JSON reste interne, réservé à la connexion backend. Brouillon local, rien n'est ratifié.

## Reconstruire

Depuis la racine du worktree :

```sh
make -f docs/architecture/focus/Makefile deps ENV=test-dossier-roles          # une fois : node_modules de la chaîne
make -f docs/spec/reports/dossier-roles-immo/focus/Makefile test ENV=test-dossier-roles
make -f docs/spec/reports/dossier-roles-immo/focus/Makefile build ENV=test-dossier-roles
make -f docs/spec/reports/dossier-roles-immo/focus/Makefile chrome-run ENV=test-dossier-roles   # en arrière-plan, CDP 9244, profil jetable
make -f docs/spec/reports/dossier-roles-immo/focus/Makefile browser ENV=test-dossier-roles
make -f docs/spec/reports/dossier-roles-immo/focus/Makefile proofs ENV=test-dossier-roles
make -f docs/spec/reports/dossier-roles-immo/focus/Makefile chrome-stop ENV=test-dossier-roles
```

La chaîne `docs/architecture/focus` est importée, jamais recopiée ; le kit h2a est monté en lecture seule sur `/kit`. Les traitements tournent dans `node:24-bookworm-slim` sans réseau ; seul le contrôle navigateur joint le Chromium local. Le contrôle ouvre un onglet neuf et le referme.

## Limites

- Proposition : aucune règle écrite dans `rules/` ni `docs/governance/` ; ce que le dépôt écrira une fois les décisions prises est au §12 du dossier (PR séparée).
- Les faits h2a sont ceux de la réconciliation du quorum (`origin/main` h2a `9a5d7d18`), non re-mesurés ici.
- Droits GitHub réels de Farid, existence d'un CONTRACT h2a geo ↔ immo, responsable légal des données, délégation Steve → Mathieu : `non vérifié` ou `unknown`, portés comme questions (D17, D18).
- La page n'a pas été testée dans Firefox ni Safari, ni avec un lecteur d'écran.
