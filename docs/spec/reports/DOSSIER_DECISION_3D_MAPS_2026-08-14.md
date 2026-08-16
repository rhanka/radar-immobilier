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

## 9. DÉCISIONS RATIFIÉES (owner, APRÈS double revue modèle — 2026-08-15)

> Double revue modèle **Sol xhigh + Fable 5** = convergentes, **RATIFIER AVEC AJUSTEMENTS**.
> Vérification **domaine geo + geo-archi** en cours (faisabilité : état réel `@sentropic/geo-ui-svelte`
> 0.1.x→0.5.0, abstraction moteur des couches, `geo-core` caméra/zoom normalisés, collision `GeoMap`).

- **G — Résidence** : **module cartographique GEO-OWNED, DS-compliant** (renverse l'orientation §8 « DS-owned »).
  Geo = runtime géospatial (CRS/projection, caméra, adaptateurs renderer 2D/3D, couches, picking, attribution,
  exactitude) ; DS = chrome (tokens/thèmes/contrôles/a11y) ; immo = adaptateur métier mince. Base = `@sentropic/geo-ui-svelte`
  étendu après audit ; **dérive de version ^0.1.1 (app) vs 0.5.0 (source)** = premier test de crédibilité.
- **D5 — Périmètre 1re livraison** : **route geo INCLUSE** ; réduction de risque = **build délégué à une passe 5.6 Sol max**.
- **Séquencement** : **parallélisme à 2 portes** — porte 1 = gel d'un contrat de seam v1 renderer-neutral avant toute intégration UI ;
  porte 2 = sync finale sur fond satellite 2D réel + seam P05 ; dev fournisseur-spécifique après spike + G ;
  **priorité P05** sur contention de ressources ; acceptation intégrée gated par P05/D8.
- **D2 — Déclencheur** : règle combinée **+ plancher** (la branche « zone sélectionnée » ne maintient la 3D que si la zone reste
  cadrée à une échelle significative ; dézoom franc → retour 2D, annotation conservée). Calibration urbain/rural avant gel.
- **D1/D3 — Spike autorisé** ; fournisseurs = **Google Photorealistic 3D Tiles, Cesium ion, self-hosted/open** ;
  structuré source × renderer × diffusion ; élimination anticipée couverture/licence ; timeboxé ; scénario fournisseur commun D8+D1.
- **D8 — Fond satellite 2D** : décidé au spike (échéance dans P05, repli si satellite indisponible).
- **D9 — Retirer** en imagerie : masquer choroplèthe + aplats de lots non sélectionnés, garder contour/libellé de la cible ;
  final sur premières captures réelles.
- **D6 — Mesure 3D vraie** (choix owner) ; note : les 2 revues recommandaient désactiver/projeter au sol pour éviter l'ambiguïté →
  **risque d'implémentation à cadrer**, pas à retrancher.

## 10. Mise à jour post-revue domaine geo-archi (2026-08-15)
Réf (worktree geo `/.lanes/archi/docs/spec/`) : `REVUE_D06_D07_GEO_2026-08-15.md` (fdc3f40b),
`SPEC_GEO_MAP_ENGINE.md` (ADR-0025, 2fc76754), `CHIFFRAGE_MOTEUR_CARTO_2026-08-15.md` (7338fda8).
- **Moteur = B (renderer-neutre-v1)** — pivot owner tranché via la conduite geo-cond. Confirme la face
  runtime de « geo propriétaire du module carto ». **Le gel du seam reste HELD** (conduite geo-cond→owner,
  gel après démo 3D verte) — non touché ici.
- **`zone_ref_canon_v1` — flag « clé inventée » RÉSOLU** : geo sert DÉJÀ la clé exacte
  `{city_slug, zone_ref_canon_v1, reglement_number}` (SPEC_GEO_SERVED_CONTRACT §2, manifeste + SHA). La revue
  Fable 3D la voyait « absente » car invisible depuis le repo immo. Contrat geo réel et verrouillé → note
  anti-invention immo corrigée.
- **Raffinement no-reparent (DS sign-off)** : invariant à 2 niveaux — **host container stable sur TOUTE
  transition** (y.c. switch renderer), mais **le canvas interne PEUT être remplacé au switch 2D↔3D** (contexte
  WebGL non transférable maplibre↔Cesium/deck) ; le moteur **round-trip l'état** (sélection/caméra/viewport)
  sans remount visible. Ma contrainte C2 est honorée dans l'esprit.
- **D06 (§3 plan) = VALIDABLE AVEC RÉSERVES** : geo sert déjà la clé + partitions fermées 1106 + garde
  homonyme + blocage collision. Réserves à graver côté immo (D03) : homonyme `usage_dominant` geo≠signal ·
  `proof` structurel ≠ preuve v2 · MCP = surface Radar · G01 = association règlement servie.
- **D07 (warden BDZI/GRHQ/CPTAQ) = AUDIT À PRODUIRE** (surface environnementale neuve, sous disciplines v1).
- **Dissents owner-gated** : #7 (geo sert l'explicite-avec-preuve, ne préjuge pas de l'UX immo) et #3 (couche
  utilisateur = fork non tranché G03 ; environnementale = canonique geo). **Présentation owner portée par
  geo-cond** (surface unique) ; le volet immo lui est transmis, pas de double-escalade.
