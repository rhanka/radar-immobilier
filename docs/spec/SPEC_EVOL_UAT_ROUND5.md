# SPEC_EVOL — ÉV14 : UAT round 5 (bande latérale uniforme, Automatisation→Sources, vue Backlog)

> **Intention committée** suite au UAT round 5 (retours pendant l'intégration des ÉV9/ÉV11/ÉV12).
> Retours verbatim + design proposé par item. Objectif : itération rapide.

## 1. Retours verbatim (UAT round 5)
- **bande latérale uniforme** : « la taille de ce qui est à gauche doit être partout pareille (même
  taille dans toutes les vues, en scroll-y overflow). » Contenu attendu de la bande gauche par vue :
  1. **Onboarding** = la municipalité à gauche.
  2. **Signaux** = le tri.
  3. **Opportunités** = la liste des dossiers (on ne comprend toujours pas lequel est sélectionné).
  4. **Sources** = la sélection : Qualification / Approfondissement / Contribution / Jobs.
  5. **Grille** = la sélection : A (tri de signal) ou B (score d'opportunité).
- **jobs vs automatisation** : « on ne comprend pas bien la différence entre Jobs et Automatisation ;
  à mon avis Automatisation doit être dans Sources. »
- **accordéons** : « la plupart de mes remarques d'accordéon n'ont pas été prises en compte. »
  (Cause partielle : lot 2 — accordéons Sources/Grilles — n'était pas encore live au moment du retour.
  À revérifier une fois lot 2 + l'uniformisation en place ; réappliquer le motif accordéon là où il manque.)
- **vue Backlog** : « ajouter une vue "Backlog" pour les évolutions en cours. Le chat servira à ajouter
  des demandes et à les traiter ; montrer ce qui est en cours vs le backlog réalisé. »

## 2. Décisions transverses (proposées)
- **D-T5 Bande latérale standardisée** : un seul composant de bande latérale (largeur fixe identique
  partout, ex. `w-72`, `overflow-y-auto`, hauteur pleine). Toutes les vues passent par `ViewLayout`
  avec un slot `controls` rempli ; plus de bande ad hoc par vue.
- **D-T6 Sources = hub de collecte** : la vue Sources (ex-Console) regroupe Qualification,
  Approfondissement, Contribution, **Jobs** ET **Automatisation** (cadences + connecteurs réels ÉV11).
  « Automatisation » disparaît de la nav top en tant que vue séparée ; « Jobs » = exécutions
  unitaires, « Automatisation » = cadences/connecteurs qui *planifient* ces jobs (distinction explicitée).

## 3. Proposition par item
- **Onboarding** : sélecteur de municipalité (+ contexte pilote) dans la bande gauche ; le reste
  (étapes/explication) à droite.
- **Signaux** : tri (score ↔ priorité) + filtre statut dans la bande gauche (déjà amorcé lot 1,
  à aligner sur la largeur standard).
- **Opportunités** : la **liste des dossiers** devient la bande latérale gauche standard ; sélection
  **fortement** marquée (fond plein + barre + coche + libellé « Sélectionnée »), détail ancré à droite
  avec en-tête = titre du dossier sélectionné. (Renforcer le surlignage lot 2 jugé insuffisant.)
- **Sources** : la **sélection d'onglet** (Qualification / Approfondissement / Contribution / Jobs /
  Automatisation) passe en bande latérale gauche (liste verticale), contenu de l'onglet à droite ;
  chaque source en **carte accordéon** (réaffirmer le motif).
- **Grille** : sélecteur **A (tri /10) / B (score /100)** en bande gauche (déjà lot 2, à aligner largeur),
  axes en fiches accordéon, rationnels éditables.
- **Backlog (nouvelle vue ÉV15)** : un tableau/kanban des évolutions : colonnes **En cours** vs
  **Réalisé** (et **Backlog** à faire). Source de données = les specs `SPEC_EVOL_*` + l'état Git
  (PR mergées = réalisé). Le **chat (ÉV9)** gagne un outil `ajouter_demande` (crée un item backlog) et
  `traiter_demande` (relie à une PR/lot) : démonstration du flux « demande → en cours → réalisé ».

## 4. Découpage
- **ÉV14 — UAT round 5 UI** : D-T5 (bande latérale standardisée sur les 5 vues) + D-T6
  (Automatisation dans Sources, Jobs vs Automatisation clarifié) + renfort sélection Opportunités +
  réaudit accordéons.
- **ÉV15 — Vue Backlog** : vue + données (specs + Git) + outils chat `ajouter_demande`/`traiter_demande`.
- Pré-requis : intégration complète ÉV9/ÉV11/ÉV12 sur main + bascule du stack live (faite avant ÉV14).
