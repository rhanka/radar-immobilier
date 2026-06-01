# SPEC_EVOL — ÉV12 : UAT round 4 (accordéons, nav horizontale, drawer, automatisation réelle)

> **Intention committée** suite au UAT round 4 (captures à l'appui). Retours **verbatim** + design
> **proposé** (brainstorm) par item, + décisions transverses. Fusionné au plan global (`PLAN.md`).
> Objectif : itération rapide. Implémentation = évolution **ÉV12** (UI) + amorce **ÉV11** (live).

## 1. Retours verbatim (UAT round 4)
- **signal-1** : « on est passé d'une représentation détaillée à une représentation très pauvre des
  signaux. Une version intermédiaire avec des cartes dépliables (accordéon) serait plus fiable. En
  particulier, il n'y a pas la source du signal, ni aucune explication du scoring, ni le nombre
  d'opportunités attachées. »
- **signal-2** : « Quand on clique sur Approfondir on va sur la vue Opportunités filtrée par le
  signal (bien), mais le nom du filtre vs du signal ne se correspondent pas clairement. » (filtre
  affiche `sig-h609-4` vs signal « Rezonage résidentiel · Règl. 150-49 · H-609-4 »).
- **opportunités** : « le drawer ne ressemble pas à un drawer ; il faut mieux comprendre la relation
  entre la barre de navigation parmi les opportunités et le détail. Rien n'indique dans le drawer
  quelle opportunité est sélectionnée. »
- **menu latéral** : « rebasculer sur un menu horizontal en haut. Pour la vue de base (sans drawer),
  marge gauche ET droite de même dimension. Ex. pour Signaux, les méthodes de score + filtre
  pourraient être une bande latérale gauche. »
- **sources** : « le modal en hover n'est pas terrible ; plutôt une carte dépliable (contenu de la
  source dans l'accordéon). »
- **automatisation** : « lancer un Claude 4.8 (en plus des 4 runs). Et automatiser concrètement une
  source ou deux : c'est frustrant d'être totalement mocké. »
- **grille** : « mode accordéon ; les rationnels des axes doivent être éditables ; le type de score
  (tri de signal / score d'opportunité) + sa description passeraient en menu latéral à la sélection ;
  le poids des axes en premier (full screen) et les axes en fiches 50% screen (hors latéral). »

## 2. Décisions transverses (proposées)
- **D-T1 Navigation** : repasser à une **barre horizontale en haut** (remplace la sidebar gauche).
  Contenu : **marges gauche/droite symétriques** quand pas de panneau détail.
- **D-T2 Bande latérale par vue** : les CONTRÔLES d'une vue vont dans une **bande latérale gauche
  propre à la vue** (≈ 1/4) ; le contenu à droite. (Signaux : tri + filtre à gauche. Grilles : type
  de score + description à gauche.)
- **D-T3 Accordéon = motif récurrent** pour les listes : Signaux, Sources, Grilles → cartes
  dépliables (résumé replié / détail déplié), via le design-system (`Card` + disclosure).
- **D-T4 Provenance/scoring lisibles** : partout où un score apparaît, le détail (source + pourquoi
  ce score) est accessible (accordéon / hover existant).

## 3. Proposition par item
- **signal-1 → cartes accordéon** : repliée = type, règl.·zone, valeur /10, confiance, statut, date.
  Dépliée = **source(s) du signal** (label + lien), **explication du scoring** (pourquoi cette
  valeur /10 selon le type VISION + pourquoi cette confiance), **nombre d'opportunités attachées**
  (compté via `signalId` sur les dossiers) + bouton Approfondir.
- **signal-2 → libellé de filtre lisible** : le chip de filtre Opportunités affiche le **nom humain**
  du signal (type + règl. + zone, ex. « Rezonage résidentiel · Règl. 150-49 · H-609-4 »), identique
  au titre de la carte signal — plus jamais l'id brut `sig-h609-4`.
- **opportunités → master-detail clair** : garder liste + détail, mais (a) **surligner** l'opportunité
  sélectionnée dans la liste, (b) **en-tête du détail = titre de l'opportunité sélectionnée** +
  fil d'ariane « Opportunités › {titre} », (c) ne plus appeler ça « drawer » : un vrai panneau de
  détail ancré. (Option Drawer slide-over écartée par défaut au profit du master-detail lisible —
  à confirmer en UAT.)
- **sources → carte dépliable** : remplacer le modal hover par une **carte accordéon** (le
  `SourceDeepDive` se déplie dans la carte au clic, pas en survol).
- **grille → refonte layout** :
  - **Bande latérale gauche** : sélecteur du **type de score** (Tri de signal /10 ↔ Score
    d'opportunité /100) + sa **description** (selon la sélection).
  - **Pleine largeur (haut)** : **poids des axes** d'abord (vue d'ensemble 30/20/20/15/15).
  - **Fiches 50% écran** : les **axes en accordéon**, avec **rationnels ÉDITABLES** (niveaux 0-5).
- **automatisation → réel** :
  - **5ᵉ track benchmark** : run **Claude Opus 4.8** sur le PROMPT analyste (lancé en bg) ajouté à
    la comparaison (A2 Claude 4.7 / C2 Codex / H1 Humain / G2 Gemini / **A3 Claude Opus 4.8**).
  - **Automatiser 1-2 sources concrètement** (amorce ÉV11) : pipeline live réel sur des sources
    **publiques sans clé** (avis publics PDF + rôle XML, ou cadastre/BDZI REST) — un job qui fetch
    + extrait + produit/raffraîchit un signal, lancé depuis l'UI (Onboarding/Automatisation),
    progression visible. (Substrat : `@sentropic/flow` + table Drizzle + endpoint Hono, cf. §12 du
    recadrage.)

## 4. Découpage
- **ÉV12 — UAT round 4 UI** : nav horizontale + marges symétriques + bandes latérales par vue ;
  accordéons (Signaux/Sources/Grilles) ; signal-1 (source+scoring+nb opp) ; signal-2 (libellé
  filtre) ; opportunités (sélection surlignée + en-tête détail) ; grille (layout + édition rationnels).
- **ÉV11 (amorce)** — automatisation réelle d'1-2 sources + 5ᵉ track Opus 4.8 dans le benchmark.
- Reste convenu : ÉV9 chat, ÉV10 h2a.
