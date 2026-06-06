# SPEC_INTENT — Modélisation des données : zonage, lots, désignation dans le temps, valuation

> **Intention rédigée par l'assistant (radar)**, à brainstormer/valider avant implémentation.
> Travail mené **en parallèle** du chantier scraping (délégué `codex:immo3` via h2a).
> Statut : intention committée. Pas de code tant que le design n'est pas validé.

## 1. Pourquoi
Le modèle actuel (`packages/radar-domain/src/valleyfield-dossiers.ts`, `schemas/opportunity-fiche.v1`,
`signal`, `scoring`) est centré **dossier/signal**. Le zonage et les lots y sont encastrés de façon
ad hoc, en chaînes de texte (« U-521 → H-521 », « Règl. 150-49 », zone « H-609-4 »). Or la valeur du
radar dépend de trois capacités que le modèle actuel ne porte pas proprement :
1. suivre l'**évolution temporelle** des zonages et des lots (un zonage change de code/usage/densité
   via un règlement à une date ; un lot est subdivisé/renuméroté ; un secteur passe U→H) ;
2. reconstituer l'**état « à une date »** (cf. `SPEC_EVOL_PROCESS_E2E.md`, parcours « simulation à date ») ;
3. rattacher la **valuation** (rôle d'évaluation, valeur marchande) à un lot/zone **dans le temps**,
   pour alimenter les axes **potentiel** et **marché** du scoring (aujourd'hui souvent `non-disponible`).

## 2. Entités cibles (à affiner)
- **Zone** : id interne stable + **code affiché** (qui peut changer), type (H/C/U/I/P/A/CONS/REC…),
  densité (log/ha, étages, hauteur), règlement source, géométrie (PostGIS), période de validité
  `[validFrom, validTo]`, liens `supersedes` / `supersededBy`.
- **Lot** : numéro cadastral, désignation, géométrie, superficie, zone courante (résolue à date),
  historique de désignation (filiation parent/enfant pour subdivisions/remembrements).
- **DesignationEvent** (temporel) : un changement d'identité/attributs d'une zone OU d'un lot, **effectué
  par un règlement/avis à une date** (`validFrom`). C'est le cœur : permet l'état « as of date » + la
  traçabilité (provenance source).
- **Valuation** : valeur (rôle d'évaluation par année, valeur marchande estimée), portée (lot/zone),
  source, confiance, date.

## 3. Temporalité (bitemporelle)
- Distinguer **temps de validité** (le fait est vrai dans le monde : entrée en vigueur d'un règlement)
  et **temps de connaissance** (quand radar l'a recueilli). Permet « à date » réel + audit.
- Chaque zone/lot = **timeline d'événements** (event-sourced léger) → reconstruire l'état à T.

## 4. Désignations dans le temps (la demande explicite)
- Modéliser comment un **zonage** et un **lot** et leur **désignation** sont faits/refaits au fil du
  temps : un règlement (ex. 150-49, 150-51) **crée / scinde / renomme** des zones (H-143 → H-143-1,
  U-521 → H-521), **redécoupe** (C-541 → C-541-1/-2). Chaque opération = `DesignationEvent` daté + sourcé.
- Idem lots : subdivision / rénumérotation cadastrale → **chaîne de filiation** datée.

## 5. Valuation
- Rôle d'évaluation : valeur foncière/bâtie par lot et par **année** (cycle trisannuel QC).
- Valeur marchande estimée (comparables/heuristique) → **axe marché** du scoring.
- Lien explicite valuation → axes scoring : `potentiel densification × valeur actuelle = upside`.

## 6. Séparation ciblage / recueil / exploitation (aligné chantier scraping)
- **Recueil (raw)** : enregistrements bruts horodatés + provenance (source, url, `fetchedAt`), non normalisés.
- **Exploitation (normalisé)** : entités Zone/Lot/Designation/Valuation dérivées, avec lien vers le raw
  + confiance/vérification (mode réel vs hypothèse).
- Le modèle **porte la provenance de bout en bout** (cohérent avec le mode réel/simulation existant).

## 7. Livrables attendus (phase design, à valider avant code)
- Schéma **Zod** + **PostGIS** (tables + relations temporelles).
- Règles de **résolution « as of date »**.
- **Mapping vers le scoring** (potentiel/marché) + signaux (un rezonage = `DesignationEvent` de type
  changement de densité/usage).
- **Stratégie de migration** depuis `valleyfield-dossiers.ts` (généralisable multi-villes).

## 8. Découpage
- **ÉV-DATA-MODEL** : design + schéma + résolution as-of-date + valuation, en parallèle du scraping.
  À **brainstormer** (superpowers:brainstorming) avant toute implémentation.
