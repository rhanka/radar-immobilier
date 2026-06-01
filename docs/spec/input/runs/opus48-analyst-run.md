# Radar densification — Salaberry-de-Valleyfield

**Agent benchmark : 5ᵉ track — Claude Opus 4.8** · mode `max · isolé · web-only`
**Date d'exécution :** 2026-06-01 · **Prompt :** `docs/spec/input/PROMPT.md` (6 phases)
**Méthode :** WebSearch/WebFetch sur sources publiques officielles uniquement ; PDF d'avis publics (FlateDecode) téléchargés puis extraits localement avec `pdftotext -layout`. **Aucune donnée fabriquée** — toute information absente est marquée `non disponible`. Faits vérifiés (✅) et hypothèses d'analyse (🔎) distingués partout.

> ⚠️ **Règle Fair-Benchmarking** (`rules/MASTER.md`) : l'auto-évaluation M1–M7 en §7 est une **auto-notation transparente, à soumettre à un scoring indépendant**. Elle n'est pas un verdict. Aucune complaisance n'est revendiquée vis-à-vis du track Opus 4.7 (A2 = 34).

---

## 0. Table de score des opportunités

Grille canonique `SPEC_EVOL_SOCLE_STATES_SCORING.md` §3.3 — axes 0-5, pondérations **Potentiel 30 % · Risque 20 % (inversé, 5 = aucune contrainte) · Timing 20 % · Faisabilité 15 % · Marché 15 %**. Score partiel renormalisé sur les axes `disponibles` (§3.4). Valeur signal /10 par type (§3.2 : rezonage résidentiel = 10, CPTAQ = 8, PPCMOI = 7).

| # | Opportunité (signal) | Type signal | Valeur signal | Potentiel (30%) | Risque (20%) | Timing (20%) | Faisab. (15%) | Marché (15%) | **Score /5** | Recommandation |
|---|---|---|---|---|---|---|---|---|---|---|
| **D1** | **150-51 — nouvelle zone résidentielle ch. Larocque Est** (secteur C-627, entre Trudeau & Daoust) : multifamilial **4-12 log.**, isolé, 3 étages | Rezonage résidentiel | **10/10** | 4 | 4 | 4 | 3 | `non-disp.` | **3.82** *(partiel)* | `qualifier-avec-expert` |
| **D2** | **150-51 — conversion U-521 → habitation** (rue Cossette × Lanctôt) : multifamilial **8 log.** isolé/jumelé, 3 étages/12 m (U→H) | Rezonage résidentiel | **10/10** | 4 | 4 | 4 | 3 | `non-disp.` | **3.82** *(partiel)* | `qualifier-avec-expert` |
| **D3** | **150-49 — densification conditionnelle boisée** H-143 / H-609-4 : base 0,5 log/ha → **jusqu'à 50 log/ha** si 30 % de boisé protégé | Rezonage résidentiel | **10/10** | 4 | 2 | 3 | 3 | `non-disp.` | **3.12** *(partiel)* | `qualifier-avec-expert` |

**Détail du calcul (renormalisation §3.4)** — marché `non-disponible` pour les 3 (Tier C : aucun comparable au grain *zone* ; voir Phase 4). Somme des poids disponibles = **0,85 ≥ 0,50** (au-dessus du plancher), donc score numérique conservé mais **statut `partiel`** → **toutes les recommandations plafonnées à `qualifier-avec-expert`** ; les actions d'engagement (`approcher-propriétaire`, `monter-dossier-acquisition`) sont **bloquées** tant que le manque marché/lot n'est pas levé.

- **D1 / D2** : (4·0,30 + 4·0,20 + 4·0,20 + 3·0,15) / 0,85 = 3,25 / 0,85 = **3,82**
- **D3** : (4·0,30 + 2·0,20 + 3·0,20 + 3·0,15) / 0,85 = 2,65 / 0,85 = **3,12**

> **Signal lot-vérifié connexe (Phase 3) :** PPCMOI2026-0066, 110 ch. Larocque — lots **3 819 015 / 3 819 031 / 3 819 167** (+ 3 819 168 mitoyen), 45 log./chambres (résidences étudiantes + bureaux). Valeur signal **7/10**. Traité en *veille concurrentielle* (projet déjà déposé par un requérant) plutôt qu'en dossier d'opportunité ouverte — mais il **confirme que le corridor chemin Larocque se densifie** (clustering avec D1).

---

## 1. Faisceau de preuves par phase (sources sourcées, URL exactes)

### PHASE 1 — Modifications de zonage récentes / projetées

**Cadre réglementaire vérifié ✅**

| Élément | Fait vérifié | Source (URL exacte) |
|---|---|---|
| Plan d'urbanisme | **Règlement 450**, adopté en conseil **12 nov. 2024**, **entré en vigueur 23 janv. 2025** ; version codifiée **450-02** (après amendement 450-01 en vigueur 10 sept. 2025) | [plan d'urbanisme](https://www.ville.valleyfield.qc.ca/reglements-municipaux/projet-de-reglement-450-concernant-le-plan-durbanisme) · [neomedia 625464](https://www.neomedia.com/vaudreuil-soulanges/actualites/valleyfield/625464/salaberry-de-valleyfield-adopte-son-nouveau-plan-durbanisme) |
| Règlement de zonage | **Règlement nº 150** (zonage). Amendements antérieurs intégrés : 150-44 (zones A), 150-47 (I/P/U/CONS/REC, en vigueur 9 juill. 2025) | [zonage et ses amendements](https://www.ville.valleyfield.qc.ca/reglements-municipaux/zonage-et-ses-amendements) · [avis publics](https://www.ville.valleyfield.qc.ca/avis-publics) |
| **150-49** (en attente ⏳) | Projet adopté **10 fév. 2026** ; consultation **11 mars 2026**. Encadre l'urbanisation des secteurs boisés. Zones **H-143, H-143-1, H-148-1, H-609-4**. Crée le zonage **CONSERVATION**, nouvelle zone **A-118-1** et **CONS-147-1**. Sous-règlements **150-49-1 / 150-49-2** : registres référendaires **22 avr. 2026**, **en attente d'approbation MAMH**. | [avis consultation 150-49/-50 (PDF)](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_150-49_150-50_assemblee_consultation.pdf) · [registre 150-49-1](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-1.pdf) · [registre 150-49-2](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-2.pdf) |
| **150-50** (en attente ⏳) | Projet adopté **10 fév. 2026** ; consultation **11 mars 2026**. Resserre les usages commerciaux des zones **C-541 / C-543** ; redécoupage en **C-541-1, C-541-2, C-543-3, C-543-4** ; **C-543-1** agrandie. *Pas susceptible d'approbation référendaire.* | [avis consultation 150-49/-50 (PDF)](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_150-49_150-50_assemblee_consultation.pdf) |
| **150-51** (en attente ⏳) | Projet adopté **17 mars 2026** ; consultation **7 avr. 2026** ; **second projet adopté 14 avr. 2026** ; avis d'approbation référendaire **22 avr. 2026**. Ouvre du multifamilial dans plusieurs zones (détail Phase 4). | [avis consultation 150-51 (PDF)](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_assemblee_150-51.pdf) · [avis approbation référendaire 150-51 (PDF)](https://dua3m7xvptjbw.cloudfront.net/documents/avis/Avis-public-Approbation-referendaire-150-51.pdf) |
| Statut au 2026-06-01 | La page **réglements-en-attente** liste **150-49, 150-50 ET 150-51 tous encore en attente** ; 150-49-1/-2 en attente d'approbation MAMH. | [réglements-en-attente](https://www.ville.valleyfield.qc.ca/reglements-en-attente) |

> 🔎 **Divergence signalée (non tranchée) :** un résumé automatisé de la page *zonage-et-ses-amendements* a suggéré une version codifiée « 150-50 » déjà en vigueur (21 mai 2026). Ceci **contredit** la page *réglements-en-attente* (qui range 150-49/-50/-51 en attente). Je **n'affirme pas** l'entrée en vigueur de 150-49/-50 : faute de l'avis d'entrée en vigueur correspondant, le statut retenu est **« en attente »** (le plus défendable). À vérifier au greffe.

**Doctrine de densification municipale ✅** : la Ville assume une densification *hors CMM* ; ~30 % du territoire est développable ; le 10 étages est limité à deux secteurs MOCO du centre, le reste majoritairement 1-2 étages. → [Journal Saint-François « densité assumée hors de la CMM »](https://www.journalsaint-francois.ca/salaberry-de-valleyfield-la-densite-assumee-hors-de-la-cmm/)

### PHASE 2 — Zones géographiques concernées

**Disponible ✅ (grain texte + croquis)** — les avis 150-51 et 150-49/-50 décrivent les zones concernées + contiguës. L'avis 150-51 contient un **croquis du secteur concerné** par zone.

Table des **zones concernées / contiguës** (verbatim avis 150-51, second projet) :

| Zone visée | Secteur (rues) | Zones contiguës (périmètre référendaire) |
|---|---|---|
| **C-627** | ch. Larocque (côté Est), rues Trudeau, Marchand, Daoust | C-627-1, C-625, C-540, H-628, H-632, H-634, P-635, **H-656**, C-636 |
| **U-521** | rues Lanctôt et Cossette | P-520, H-516, H-519, H-518, H-524, H-522 |
| **H-535** | rues Jeanne-Mance et Édouard (face terrain sportif Cégep) | C-534, P-547, P-536 |
| **C-566** | rues Salaberry et Académie | H-569, C-567, P-556, H-565, P-568 |
| **H-561** | rues Laroche, Académie, Viau | H-561-1, P-559, P-570, P-560, P-571, H-571-1, H-563, C-562 |
| **H-801** | rues Léger et du Sanctuaire | U-902, CONS-720, H-803, C-802, H-804 |

Source : [avis approbation référendaire 150-51 (PDF)](https://dua3m7xvptjbw.cloudfront.net/documents/avis/Avis-public-Approbation-referendaire-150-51.pdf)

**Plans de zonage / affectations ✅** : Annexe B — Plan de zonage (3 feuillets) sur la [page zonage](https://www.ville.valleyfield.qc.ca/reglements-municipaux/zonage-et-ses-amendements) ; Plan 3 — Plan des affectations (450-01) sur la [page plan d'urbanisme](https://www.ville.valleyfield.qc.ca/reglements-municipaux/projet-de-reglement-450-concernant-le-plan-durbanisme).

**Portail cartographique** : une [carte interactive municipale](https://www.ville.valleyfield.qc.ca/carte-interactive) existe (application JS). 🔎 **Limites géographiques précises (polygones avant/après géoréférencés)** des zones modifiées = **non disponible** par extraction automatisée (rendu JS, pas de couche téléchargeable accessible). Contraintes physiques (zone inondable BDZI, bande riveraine) : **non intersectées au grain lot** dans ce run → `non disponible` (non fabriqué). Plusieurs zones cibles (C-627, U-521, H-535, C-566) sont en **secteur urbain desservi** ; REC-137 (golf) et H-801 sont en frange (le second jouxte CONS-720).

### PHASE 3 — Lots concernés

**Rôle d'évaluation en ligne ✅ existe** : [consultation du rôle d'évaluation](https://www.ville.valleyfield.qc.ca/role-devaluation) (recherche par adresse / matricule / numéro de lot). 🔎 **Données lot-par-lot (matricule, superficie, dimensions, valeur terrain/bâtiment) = `non disponible`** par moissonnage automatisé (outil de consultation interactif, pas d'export ; cohérent avec le constat « rôle bloqué » des runs antérieurs). **Honnêteté : aucune valeur de lot inventée.**

**Exception — lots imprimés dans une source officielle ✅** : l'avis PPCMOI2026-0066 énumère explicitement les lots du **cadastre du Québec, circ. foncière de Beauharnois** :

| Dossier | Adresse | Lots (vérifiés) | Zones | Nature |
|---|---|---|---|---|
| **PPCMOI2026-0066** | 110, ch. Larocque | **3 819 015, 3 819 031, 3 819 167** (+ 3 819 168 mitoyen) | C-511-1, H-513, P-512 | Résidences étudiantes + bureaux + stationnements ; **jusqu'à 45 log./chambres** (vs max 4 en C-511-1) ; mixité commerce/habitation ; résolution **2026-05-999** (12 mai 2026), consultation 20 mai 2026 |

Source : [avis PPCMOI2026-0066 (PDF)](https://dua3m7xvptjbw.cloudfront.net/documents/avis/PPCMOI2026-0066-Avis-public-assemblee-de-consultation.pdf) · [page PPCMOI](https://www.ville.valleyfield.qc.ca/ppcmoi)

> Pour les zones D1/D2/D3, **l'énumération des lots intersectant la zone** exige le SIG/rôle (bloqué) → `non disponible`. C'est ce qui plafonne l'axe Faisabilité à 3 (« un terrain candidat existe ; l'attribution à la zone reste hypothèse »).

### PHASE 4 — Potentiel de développement (normes nouvelles, verbatim)

**150-51 — usages/densités ajoutés (demandes de particuliers) ✅** [source PDF](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_assemblee_150-51.pdf) :
- **C-566** (rue Salaberry, E de rue Académie) : ajout **habitation multifamiliale 5 à 8 logements**, max **3 étages / 12 m**.
- **U-521** (rue Cossette × Lanctôt) : **multifamilial 8 logements**, structure isolée et jumelée, **3 étages / 12 m** — *conversion d'une zone d'utilité publique vers l'habitation*.
- **H-801** (terrain adjacent rue Léger, E boul. Mgr-Langlois) : ajout de la structure **contiguë**.
- **H-535** (rue Salaberry, face terrain sportif du Cégep) : **maisons de chambres et résidences étudiantes jusqu'à 3 étages**.
- **Nouvelle zone résidentielle** côté Est du **chemin Larocque, entre rues Trudeau et Daoust** : **multifamilial 4 à 12 logements**, structure isolée, **3 étages** (secteur C-627).
- Initiatives Ville : H-561 agrandie (rue Laroche, à même P-571) ; H-334 (retrait note PIIA) ; REC-137 (golf) ; I-918 (recyclage, Écoparc).

**150-49 — densité conditionnelle boisée ✅** [source PDF](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_150-49_150-50_assemblee_consultation.pdf) — *densité de base réduite à **0,5 log/ha**, bonifiée selon le % de boisé protégé* :
- **H-143-1 et H-148-1** : **2 log/ha** si 55 % protégé ; **15 log/ha** si 70 % protégé.
- **H-143 et H-609-4** : **50 log/ha** si 30 % protégé.
- Du 30 % au 70 % protégé : ≥ 20 % en continu, bandes ≥ 10 m de profondeur et ≥ 1000 m². Boisés protégés → zonage **CONSERVATION** (ou servitude perpétuelle). Encadrement déboisement/reboisement. Dépend d'un **règlement PIIA « amendement à venir »** (dépendance bloquante 🔎).

**Contraintes identifiées :**
- **CPTAQ** : 150-49 crée la zone agricole **A-118-1** (restrictions strictes) — proximité agricole à valider pour tout lot mitoyen ; les zones-cibles D1/D2 (Larocque, Cossette) sont **urbaines** (risque CPTAQ faible). 🔎 Aucune demande/décision CPTAQ spécifique trouvée pour D1/D2/D3 → `non disponible`.
- **Boisé / environnement (D3)** : conservation 30 % + PIIA = contrainte majeure mitigable mais coûteuse.
- **PIIA** : 153-18 (en attente) modifie le règlement PIIA ; H-334 voit son PIIA retiré, mais le bonus densité 150-49 **dépend** d'un futur PIIA.
- **Inondable / riverain** : `non disponible` au grain lot (non fabriqué).

### PHASE 5 — Qualification des opportunités

Critères : amplitude résidentielle, simplicité réglementaire, absence de contrainte majeure, alignement plan d'urbanisme (consolidation), pondération VISION (rezonage 10 > CPTAQ 8 > PPCMOI 7 > dérogation 5).

**Retenues (Top 3 = D1, D2, D3 ci-dessus).** Logique de tri :
1. **D1 (C-627 Larocque Est)** — plus forte amplitude (jusqu'à 12 log.), création d'une **zone résidentielle neuve** alignée sur la consolidation du plan 450, corridor desservi.
2. **D2 (U-521)** — **conversion U→H** (cas-type d'ouverture forte §3.3), parcelle d'utilité publique généralement desservie, mais amplitude moindre (8 log.).
3. **D3 (150-49 H-143/H-609-4)** — densité conditionnelle élevée (50 log/ha) mais contrainte boisé/PIIA et dépendance réglementaire ⇒ risque/timing dégradés.

**Veille (non scorées en dossier, mais à suivre) :**
- **H-535** (résidences étudiantes face Cégep) et **C-566** (5-8 log.) — ouvertures réelles, amplitude plus faible.
- **PPCMOI2026-0066** (110 ch. Larocque, lots vérifiés, 45 log.) — projet déjà déposé → veille concurrentielle ; **co-localisé avec D1** (corridor Larocque = signal de cluster).

**Écartés (contrôle des faux positifs ✅) :**
- **150-50** : *restriction* d'usages commerciaux (C-541/C-543) — **non densifiant**, hors cible.
- **PPCMOI2026-0061** (490 boul. Hébert) : non confirmé résidentiel dans ce run → écarté faute de preuve d'usage habitation (non fabriqué).
- **REC-137 / I-918** : golf / industriel-recyclage — non résidentiel.

### PHASE 6 — voir §2 (rapport structuré) et §3 (recommandation).

---

## 2. Rapport structuré (gabarit PROMPT.md)

**1️⃣ Résumé du changement de zonage** — Trois amendements de zonage en cours (tous *en attente* au 2026-06-01) sur le Règlement 150 : **150-49** (densité conditionnelle à la conservation de boisés ; crée le zonage CONSERVATION), **150-50** (resserrement commercial C-541/C-543 — non densifiant), **150-51** (ouvertures multifamiliales ponctuelles + une nouvelle zone résidentielle). Objectif municipal : **développement durable / consolidation** assumée hors CMM (plan d'urbanisme 450, en vigueur 23 janv. 2025).

**2️⃣ Zones concernées** — Voir tableau Phase 2. Cibles urbaines desservies (ch. Larocque Est, Cossette/Lanctôt, Salaberry/Académie, face Cégep) ; croquis dans l'avis 150-51. Limites géoréférencées précises = non disponible (portail JS).

**3️⃣ Lots candidats** — Énumération lot-par-lot = non disponible (rôle interactif, non exportable), **sauf** PPCMOI2026-0066 (lots 3 819 015/031/167, imprimés à la source).

**4️⃣ Analyse stratégique** —
- **D1** : projet optimal = petit collectif **8-12 logements** isolé, 3 étages, en infill de corridor. Risque réglementaire = **référendaire** (zone susceptible d'approbation, périmètre de zones contiguës large : C-625, H-628…). Complexité **moyenne**.
- **D2** : **petit multiplex 8 logements** sur ex-terrain d'utilité publique ; risque = référendaire + confirmation du statut foncier du parcelle U. Complexité **moyenne**.
- **D3** : **développement dense conditionnel** (jusqu'à 50 log/ha) sur terrain partiellement boisé ; risque = conservation 30 %, PIIA à venir, A-118-1/CPTAQ à proximité. Complexité **élevée**.

**5️⃣ Conclusion** — voir §3.

---

## 3. Recommandation

**Top opportunités :** **D1 (ch. Larocque Est / C-627, 3,82) ≈ D2 (U-521, 3,82) > D3 (150-49 boisé, 3,12).** Les trois sont des **rezonages résidentiels (signal 10/10)**, le cœur de la mission et le sommet de la pondération VISION.

**Statut commun : `qualifier-avec-expert` (engagement bloqué).** Les trois dossiers sont **partiels** : l'axe **Marché** est `non disponible` (aucun comparable au grain *zone* ; les données régionales — Quartier V, CMHC — ne placent pas de niveau au grain zone, §3.4.0) et l'**énumération des lots** dépend du rôle/SIG bloqué. Conformément à §3.4, **aucune approche propriétaire** avant levée de ces manques.

**Actions recommandées (prochaines vérifications) :**
1. **Lever le manque foncier** : interroger le [rôle](https://www.ville.valleyfield.qc.ca/role-devaluation) et la [carte interactive](https://www.ville.valleyfield.qc.ca/carte-interactive) (ou demande greffe) pour matricule/superficie/valeur/vacance des lots de C-627 (Larocque E, entre Trudeau et Daoust), U-521 (Cossette×Lanctôt), H-143/H-609-4.
2. **Trancher le statut réglementaire** : confirmer au greffe (greffe@ville.valleyfield.qc.ca) si 150-49/-50 sont entrés en vigueur (divergence §1) et le calendrier d'adoption finale de 150-51.
3. **Marché au grain zone** : comparables Centris/JLR du secteur + absorption — actuellement payants/absents → axe Marché à documenter avant tout score d'engagement.
4. **Surveiller le corridor Larocque** : D1 + PPCMOI2026-0066 (45 log.) co-localisés = cluster de densification à cartographier.
5. **D3 uniquement** : suivre le **PIIA « à venir »** dont dépend le bonus 50 log/ha, et vérifier la proximité CPTAQ (A-118-1).

**Contexte marché régional (contexte, pas un niveau d'axe) ✅** : marché actif — **Quartier V** rue Tougas (~360-364 logements, ~21 immeubles, ~60 M$, consortium Loiselle/Ménard/Harden/Habitat 2000) et **100 logements abordables aînés** (coin Tougas/Michel-Choinière, ~22,5 M$, livraison printemps 2027). → [projets résidentiels Ville](https://www.ville.valleyfield.qc.ca/projets-residentiels-et-multifamiliaux) · [Quartier V — Harden](https://www.harden.ca/our-projects/quartier-v) · [neomedia 430770](https://www.neomedia.com/vaudreuil-soulanges/actualites/valleyfield/430770/investissements-de-60-m-pour-un-projet-residentiel) · [100 log. aînés — Ville](https://www.ville.valleyfield.qc.ca/actualites/un-immeuble-de-100-logements-abordables-pour-aines-autonomes-sera-construit-a-salaberry-de-valleyfield-grace-a-un-partenariat-novateur)

---

## 4. Sources (consolidé)

**Officiel municipal :** [zonage & amendements](https://www.ville.valleyfield.qc.ca/reglements-municipaux/zonage-et-ses-amendements) · [avis publics](https://www.ville.valleyfield.qc.ca/avis-publics) · [réglements-en-attente](https://www.ville.valleyfield.qc.ca/reglements-en-attente) · [plan d'urbanisme 450](https://www.ville.valleyfield.qc.ca/reglements-municipaux/projet-de-reglement-450-concernant-le-plan-durbanisme) · [PPCMOI](https://www.ville.valleyfield.qc.ca/ppcmoi) · [rôle d'évaluation](https://www.ville.valleyfield.qc.ca/role-devaluation) · [carte interactive](https://www.ville.valleyfield.qc.ca/carte-interactive) · [projets résidentiels](https://www.ville.valleyfield.qc.ca/projets-residentiels-et-multifamiliaux)
**Avis publics (PDF, extraits localement) :** [150-49/-50 consultation](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_150-49_150-50_assemblee_consultation.pdf) · [150-51 consultation](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_assemblee_150-51.pdf) · [150-51 approbation référendaire](https://dua3m7xvptjbw.cloudfront.net/documents/avis/Avis-public-Approbation-referendaire-150-51.pdf) · [150-49-1 registre](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-1.pdf) · [150-49-2 registre](https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-2.pdf) · [PPCMOI2026-0066](https://dua3m7xvptjbw.cloudfront.net/documents/avis/PPCMOI2026-0066-Avis-public-assemblee-de-consultation.pdf)
**Presse / tiers :** [neomedia 625464 (plan 450)](https://www.neomedia.com/vaudreuil-soulanges/actualites/valleyfield/625464/salaberry-de-valleyfield-adopte-son-nouveau-plan-durbanisme) · [Journal Saint-François (densité hors CMM)](https://www.journalsaint-francois.ca/salaberry-de-valleyfield-la-densite-assumee-hors-de-la-cmm/) · [Harden — Quartier V](https://www.harden.ca/our-projects/quartier-v) · [Habitations Sylvain Ménard — Quartier V](https://habitationssylvainmenard.com/quartier-v)

---

## 5. Honnêteté factuelle — ce qui n'a PAS été produit (anti-fabrication)

- ❌ **Aucun** numéro de lot, matricule, superficie ou valeur inventé pour D1/D2/D3 → `non disponible` (rôle bloqué). Seuls les lots **imprimés** dans l'avis PPCMOI2026-0066 sont cités.
- ❌ **Aucune** intersection zone inondable / bande riveraine / CPTAQ affirmée sans source → `non disponible`.
- ❌ **Aucun** comparable marché au grain zone inventé → axe Marché `non disponible`, score plafonné.
- ⚠️ Entrée en vigueur 150-49/-50 : **divergence signalée**, statut prudent « en attente », non affirmé.
- 🔎 Hypothèses d'analyse (faisabilité niveau 3, types de produit, amplitude) explicitement marquées et fondées sur les normes verbatim, jamais présentées comme faits cadastraux.

---

## 6. Limites du run

- **Phase 2** : polygones géoréférencés avant/après = non extraits (portail JS) ; description textuelle + croquis seulement.
- **Phase 3** : rôle non moissonnable automatiquement (Cloudflare/JS) — limite structurelle, pas un défaut d'effort ; cohérent avec R11 du référentiel projet.
- **Marché** : données zone-grain payantes/absentes (Tier C) → axe non disponible par conception, pas par omission.
- PDF binaires FlateDecode → nécessité d'extraction locale `pdftotext` (méthode documentée, reproductible).

---

## 7. Auto-évaluation benchmark — 5ᵉ track (Opus 4.8) · *à valider par scoring indépendant*

> **Auto-notation transparente**, alignée sur les métriques gelées M1–M7 de `ui/src/lib/demo/benchmark-data.ts`. **Non complaisante** : présentée pour vérification neutre, pas comme un verdict. La référence A2 (Opus 4.7) = 34/35.

| Métrique | Auto-score | Justification (vérifiable) |
|---|---|---|
| **M1 Couverture des signaux** | 4 | 150-49, 150-50, 150-51 (+ sous-règlements 150-49-1/-2), PPCMOI (6 dossiers + 2026-0066 détaillé), plan 450, Quartier V, 100 log. aînés, doctrine densité hors CMM. *Couverture marché/démographie/catalyseurs infra moins poussée (axe non scoré) → 4, pas 5.* |
| **M2 Précision réglementaire** | 5 | Numéros + dates + nature verbatim (densités 0,5→2→15→50 log/ha ; 150-51 zones C-566/U-521/H-535/C-627 ; dates 10 fév / 11 mars / 17 mars / 7 avr / 14 avr / 22 avr 2026), extraits du texte officiel. |
| **M3 Traçabilité des sources** | 5 | URL exacte par affirmation (deep-links cloudfront PDF + pages municipales). |
| **M4 Honnêteté factuelle** | 5 | `non disponible` pour lots/marché/inondable ; divergence 150-50 signalée et non affirmée ; ✅/🔎 partout ; zéro fabrication ; application stricte du plafond §3.4. |
| **M5 Spécificité actionnable** | 4 | Secteur→zone→rue atteint ; lots vérifiés sur PPCMOI2026-0066 ; mais énumération lot-par-lot des zones cibles non disponible (rôle bloqué) → plafond honnête. |
| **M6 Contrôle des faux positifs** | 5 | 150-50 (restriction, non densifiant), 490 Hébert, REC-137/golf, I-918/recyclage écartés explicitement. |
| **M7 Priorisation VISION** | 5 | Top 3 = rezonages (10) ; PPCMOI (7) en veille ; dérogations/restrictions secondarisées ; CPTAQ traité au grain. |
| **Total auto-évalué** | **33/35** | *À confirmer indépendamment ; aucune supériorité auto-proclamée vs A2 (34).* |

**Objet TrackScore proposé (à valider) :**
```ts
{
  id: "A5", name: "Claude Opus 4.8", operator: "agent",
  mode: "mode max · isolé · web-only",
  scores: [4, 5, 5, 5, 4, 5, 5], total: 33, rank: null /* à classer par scoring indépendant */,
  fabrication: "none",
  note: "Cœur réglementaire complet (150-49/-50/-51) avec densités/zones/dates verbatim extraites des PDF officiels ; lots vérifiés via PPCMOI2026-0066 ; scoring strictement conforme à la doctrine §3.4 (marché non-disponible → plafond qualifier-avec-expert) ; divergence d'entrée en vigueur signalée sans l'affirmer. Aucune fabrication. Auto-score à valider."
}
```
> ⚠️ `rank` laissé à `null` : le classement vs A2/C2/H1/G2 **doit** être posé par l'évaluateur indépendant (règle Fair-Benchmarking), pas auto-attribué.
