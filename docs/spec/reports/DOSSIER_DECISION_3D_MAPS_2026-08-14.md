# Dossier de décision — Cartographie 3D & capitalisation module geo

> À revoir par : owner (décision) + geo-cond + geo-archi (revue architecture module geo).
> Sources : spec `SPEC_EVOL_3D_MAPS_2026-08-14.md` (passe 5.6 Sol, extension v2 en cours) ;
> revue **Fable 5** = PRÊTE-AVEC-RÉSERVES ; direction owner = capitaliser les vues dans un module geo.

## 1. Décision demandée
Cadrer l'évolution « vue 3D photoréaliste au niveau zone » ET la direction structurante « capitaliser les vues carto dans un module geo réutilisable » (préférence owner de longue date), avant tout spike/implémentation.

## 2. Contexte (faits vérifiés)
- **[FACT]** Stack carto front = `maplibre-gl ^5.24.0` **uniquement** ; aucun Cesium/deck.gl/Google Maps client. Toute 3D photoréaliste impose un 2e moteur lourd ou un adaptateur risqué.
- **[FACT]** Il existe **déjà** un module `@sentropic/geo-ui-svelte@^0.1.1` (composant `GeoMap`) consommé par `ui/src/lib/components/geo/GeoView.svelte` → véhicule probable de capitalisation.
- **[FACT]** Le **fond satellite 2D n'existe pas** dans le code (aucune occurrence `satellite` dans `ui/src`) et son fournisseur n'est pas choisi. C'est le socle du mode imagerie ET du repli gracieux.
- **[FACT]** Aucune clé tuiles ; `GOOGLE_API_KEY` = clé LLM Gemini (à ne pas réutiliser). Aucune CSP dans le repo.
- **[FACT]** La spec Sol est factuellement rigoureuse (20+ affirmations code vérifiées exactes par Fable), pose D1–D7 sans les trancher, AC-01→AC-09, hors-périmètre + inconnues déclarés.
- **[JUDGMENT]** La 3D « Google Earth » est une amende owner du 2026-08-14 sur §5 de `SPEC_RAW_USER_REVIEW`.

## 3. Blocages durs (Fable + Sol convergents)
1. **P05 est un prérequis bloquant non formalisé** : pas de fond satellite 2D dans le code, fournisseur non choisi → le repli et le mode imagerie reposent sur un livrable inexistant. P05 (`feat/map-basemap-controls`) doit précéder la 3D.
2. **Spike comparatif §3.4 non fait** : fournisseur/moteur/clé/coût indécidables sans lui (Google direct vs Cesium vs MapTiler vs self-hosted).
3. **Direction module geo non encore architecturée** : déléguée à geo (complément de proposition, revu geo-archi + Sol + Fable).

## 4. Décisions owner (résumé — voir question)
- **G — Capitalisation module geo** : confirmer que les vues (dont 3D) visent `@sentropic/geo-ui-svelte` / module geo (préférence owner) ; geo détaille l'architecture.
- **D2 — Sémantique du déclencheur** : seuil de zoom fixe (`z≥14`) vs sélection sémantique de zone vs règle combinée.
- **D1+D3 — Autoriser le spike comparatif** (coûts réels) pour convertir la préférence Google Earth en choix fournisseur/moteur/clé.
- **Séquencement & périmètre 1re livraison** : P05 avant 3D ; périmètre = consommateurs `GeoCityMapBase` (Signaux/Sources) seul vs route `geo` incluse.

## 5. Recommandation conducteur
- Confirmer la **capitalisation module geo** (aligne avec la préférence owner + un module existe déjà) ; laisser geo en architecturer le contrat.
- **D2** : règle combinée (seuil zoom + déclencheur sélection-de-zone), à calibrer sur échantillon urbain/rural — le pur seuil zoom rate les grandes zones rurales cadrées sous z=14.
- **Autoriser le spike** (borné, sans engagement de dépense) : c'est le seul moyen de trancher D1/D3/D4 sur preuves.
- **Séquencer** P05 → 3D ; 1re livraison sur les consommateurs `GeoCityMapBase`.

## 6. Réversibilité / coût
Tout est réversible à ce stade : spec + spike, aucune dépendance ni dépense engagée (hors-périmètre §7.1). Le spike a un coût (temps + éventuels crédits d'essai fournisseur) mais pas d'engagement.

## 7. Attendu de l'owner
Les 4 décisions ci-dessus (question dédiée). La revue geo/geo-archi raffine le contrat du module geo, pas ces choix produit.

## 8. ORIENTATIONS OWNER (2026-08-14) — à RATIFIER APRÈS la double revue

> Process : la **décision finale** (dossier / question via l'outil) est prise **APRÈS** la
> double revue geo + geo-archi (+ design-system + passes Sol/Fable). Les points ci-dessous sont
> des **orientations owner** = input à challenger par les relecteurs, pas des décisions figées.

- **G — Capitalisation** : orientation = **modules du DESIGN SYSTEM (sent-tech-design-system), VALIDÉS PAR GEO** (et non un module geo-owned). Le DS porte les modules UI carto ; geo valide (correction géo/domaine) + contrat data geo ; immo consomme. `@sentropic/geo-ui-svelte` = point de départ, statut geo-vs-DS à trancher.
- **D2 — Déclencheur** : **règle combinée** (seuil zoom z≥14 OU sélection sémantique de zone), calibrée sur échantillon urbain/rural.
- **D1+D3 — Spike** : **autorisé** (comparatif chiffré, sans engagement de dépense).
- **Séquencement** : **3D EN PARALLÈLE de P05** (choix owner). Couplage assumé : le repli 2D + le mode imagerie s'intègrent quand P05 livre le fond satellite 2D + le seam de contrôles ; le travail 3D avance en parallèle, le point d'intégration se synchronise à l'atterrissage de P05.
