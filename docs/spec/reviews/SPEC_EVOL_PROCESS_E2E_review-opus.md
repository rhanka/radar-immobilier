J'ai lu l'ensemble. Voici ma relecture critique, structurée selon tes 9 axes. Je cite les sections (§) du spec `SPEC_EVOL_PROCESS_E2E.md` et des inputs.

---

## 1. Forces

- **Traçabilité VISION/PROCESS explicite** (§4.1, §10) : le spec nomme honnêtement le gap réel — le score LLM « pifométrique » sans grille (§4.1) — et y répond par des grilles configurables + preuve. C'est le bon problème.
- **Anti-pifométrie par l'UX** (§4.4) : hover = mini-grille + niveau surligné + justification + preuve. Cela opérationnalise directement la gouvernance PROCESS §5 (« jamais un score élevé sans trace de preuve »). Excellent.
- **Toggle réel/simulation + étiquetage honnête** (§1, §6) : application directe de la règle anti-triche (MASTER, DEMO_FINDINGS §2). Conceptuellement aligné.
- **Modèle signal→N opportunités** (§3) : correct (un règlement touche N zones → N lots, cf. PROMPT phase 3). C'est la bonne cardinalité, là où la démo actuelle mélangeait les états.
- **Décomposition ordonnée par dépendances** (§9) : socle modèle+scoring d'abord, console/jobs/onboarding ensuite. Pragmatique pour replanifier.
- **Benchmark par étape** (§8) : raffinement sain du benchmark global (DEMO_FINDINGS) — un modèle par phase plutôt qu'un score unique.

## 2. Faiblesses / risques

- **L'axe Valeur marché (15 %, §4.3) est aujourd'hui non-scorables** : transactions, vacance, absorption, comparables sont tous Tier C / non-disponibles pour Valleyfield (DATA_MODEL §2.3 : JLR/Centris payants, permis absents de Données Québec). 15 % du score repose sur de la donnée que l'investigation a prouvée indisponible.
- **L'axe Risque (20 %) dépend d'intersections géospatiales bloquées** : DATA_MODEL §1.3 — pas de polygones de zonage en open-data, l'intersection CPTAQ « blocked by missing zone H polygons ». Donc « bloquant inondable/CPTAQ » (niveau 1) n'est en pratique pas calculable aujourd'hui.
- **Faisabilité niveau 5 exige « propriétaire unique »** (§4.3) alors que le nom du propriétaire est **caviardé par la loi** (DATA_MODEL §2.2, LFM art. 72). Les niveaux 1 et 5 reposent sur une donnée non obtenable sans Registre foncier payant.
- **Aucune règle de calcul quand un axe est « non-disponible »** : la formule `Σ(niveau × poids)` (§4.3) suppose un niveau par axe. Que vaut le marché quand il est non-disponible ? Mettre 1 pénalise injustement, mettre 3 fabrique, exclure change les poids. **Non spécifié — c'est le trou le plus grave.**
- **Dépendance `@sentropic/flow`** (§5) posée comme fondation sans spike de validation : couplage externe à risque, alors que le benchmark montre qu'un agent 0-shot simple (Opus) bat déjà l'humain (DEMO_FINDINGS §10).
- **Toggle réel/simulation « par vue »** (§6) : surface large, risque de deux jeux de données parallèles qui divergent, et de fuite de simulé présenté comme réel si le label n'est pas appliqué *au niveau donnée* (pas seulement visuel).

## 3. Contradictions / incohérences internes

- **Deux échelles présentées comme un seul score raffiné.** §4.2 : brut /10 (×confiance). §4.3 : pondéré /5 affichable /100. L'exemple « 90→63 » (§4.3) les compare comme une progression continue, et §3 parle d'« un score qui se précise : brut → provisoire → final ». Or ce ne sont **pas** le même score qui se raffine : c'est un *prior de type de signal* qui bascule vers un *composite multi-axes*. Le récit « brut→provisoire→final » est trompeur.
- **CPTAQ a un signe opposé selon la couche.** Couche A (§4.2) : CPTAQ = signal **positif** 8/10 (déverrouillage). Grille Risque (§4.3) : « CPTAQ active » = **bloquant** niveau 1. Même source, sens inverse, non réconcilié. Critique pour le pilote #3 (H-143 / A-118, VERTICAL_SLICE §3).
- **Potentiel niveau 5 « en vigueur » contredit la thèse VISION « avant le marché ».** Le meilleur potentiel (§4.3) est donné à l'état le **moins asymétrique** (le plus public). PROCESS §3 dit l'inverse : « perle rare = potentiel élevé + timing encore peu visible ».
- **Le Timing pénalise le long terme que VISION valorise.** Grille Timing niveau 1 = « horizon >10 ans ». Or VISION §6 décrit la CPTAQ (8/10) comme « horizon long terme 1–10 ans » et VISION §9 cible explicitement « opportunités structurelles à long terme ». Un signal CPTAQ fort se verrait écraser son timing (20 %), déprioritisant exactement ce que VISION veut remonter.
- **« Chacun = un écran »** (§2) est approximatif : T3 a 2 sous-vues, et le cycle de vie §3 chevauche T1+T2. Le mapping 1:1 traitement↔écran ne tient pas.

## 4. Manques

- **Traitement « non-disponible » dans le score** (cf. §2 ci-dessus) + opérationnalisation de la règle PROCESS §3 « score élevé sans preuve récente → surveillance ». Absent.
- **Propagation de la confiance** dans le score pondéré : PROCESS §6 dit « score + preuve + niveau de confiance » par critère ; §4.3 ne pondère pas par la confiance (seul Couche A le fait, §4.2).
- **Mémoire temporelle des dossiers.** VISION §4.2/§7 (« un dossier évolue sur plusieurs séances », « construire une mémoire dans le temps ») et §4.5 (rétroanalyse 2 ans) : le cycle de vie §3 est un flux signal→opp unique, pas une évolution multi-séances. La rétroanalyse n'apparaît qu'en T0 sans alimenter le suivi continu.
- **Liaison de documents.** VISION §4.4/§7 (« relier les documents entre eux », reconstruire le contexte derrière un n° de règlement) : pas dans le modèle d'états.
- **Taxonomie d'actions appauvrie.** PROCESS §6 / fiche §4 : *rejeter / surveiller / qualifier avec expert / approcher propriétaire / monter dossier d'acquisition* (5 sorties). §3 ne retient que `Écarté`, `Surveillance`, et « Approfondi → action » (flou).
- **Pipeline YouTube** (VISION §4.3, pondéré) quasi absent des T0–T4 et de la console sources.
- **Calibration des grilles sur les 3 pilotes réels** (H-609-4, U-521→H-521, H-143) : le spec *propose* des grilles mais ne les **valide pas** contre les dossiers Valleyfield qui existent déjà. Occasion manquée.
- **Agrégation multi-signaux** sur un même dossier (un règlement = zonage + densité + hauteur) : max ? additif ? Non dit.
- **Provenance « simulé »** : §6 introduit le label « instruit par l'humain · hypothèse simulée », mais l'enum DATA_MODEL §8 est `fait | hypothese | non-disponible`. Il manque une valeur `simulé`/`instruit-humain` ou un axe `mode: réel|simulé` séparé.

## 5. Sur-ingénierie / YAGNI

- **Front-load de T3 (console sources, 2 sous-vues) + T4 (monitoring jobs)** (§2) : ces outils ne servent qu'**une fois l'automatisation continue en place** — or VERTICAL_SLICE §11 l'a explicitement mise hors-scope (« automatisation continue / ordonnancement hors scope ; ce slice est une matérialisation, pas le moteur »). Construire la console avant le moteur = prématuré. (§9 les ordonne 5ᵉ — bien — mais ils restent dans le socle.)
- **`@sentropic/flow` comme socle de l'assistant + agents de veille + auto-enrichissement + orchestration** (§5) : adopter un framework agentique complet avant que le pipeline simple soit prouvé. Le benchmark (Opus 0-shot) suggère qu'on n'en a pas besoin pour le socle.
- **Voie (c) connecteurs MCP par source** (§7) : roadmap correcte, mais YAGNI maintenant.
- **Toggle réel/simulation *par vue*** (§6) : un mode démo global + provenance par item (déjà supporté par `EvidenceItem.verification`, DATA_MODEL §8) suffit probablement. La simulation devrait être un **état de la donnée**, pas un toggle UI qui échange des datasets.
- **Couche A comme couche scorée distincte** (§4.2) : largement redondante avec « Potentiel réglementaire » (le type de signal *est* le prior de potentiel). À questionner : un seul scoring avec un composant « type » dans Potentiel pourrait suffire.

## 6. Alignement VISION/PROCESS — écarts précis

- **Échelle 0–5 vs 1–5.** PROCESS §3 et §6 disent littéralement « score de **0** à 5 ». Les grilles §4.3 sont **1→5**. Perdre le 0 empêche de distinguer « blocage absolu / absence totale » de « minimal » — particulièrement gênant sur Risque (0 = bloquant absolu).
- **Les 6 phases PROCESS sont diluées.** Le modèle T0–T4 (§2) réorganise par écran/cadence, pas par les 6 phases (signal, ancrage, contraintes, marché, **contexte stratégique**, scoring). Où est « Contexte stratégique » (PROCESS phase 5 : StatCan/transport/MRC, catalyseurs) dans T0–T4 ? Implicite en T2, jamais nommé. Un mapping T↔phases manque.
- **Inversion priorité/score non assumée.** VISION §6 étiquette PPCMOI « Priorité 2 » (7/10) et CPTAQ « Priorité 4 » (8/10) — incohérence **interne à VISION**. Couche A (§4.2) tranche correctement par les scores (CPTAQ 8 > PPCMOI 7, cohérent avec M7 de DEMO_FINDINGS) mais **sans le dire**. À expliciter comme résolution d'une ambiguïté de l'input.
- **« Langage municipal » / intentions politiques** (VISION §5/§7, PROCESS étape 1 : *intention politique / exception / pression citoyenne / bruit*) : pas tracé comme type de signal propre en Couche A.

## 7. Faisabilité technique

- **Scoring** : calculable **uniquement** si la donnée existe. En l'état (DATA_MODEL), Marché = Tier C indisponible, Risque = intersection bloquée, Faisabilité = propriétaire caviardé. Une **grande part de Couche B est non-disponible** pour le pilote ⇒ beaucoup de scores finaux seront partiels/hypothèses. Faisable seulement *après* avoir défini le traitement « non-disponible ».
- **Automatisation a/b/c** (§7) : (a) replay par prompt = **prouvé** (DEMO_FINDINGS : les agents ont exécuté PROMPT.md) ✓. (b) jobs+ETL sur open-data stable = faisable (CKAN confirmé). (c) MCP = spéculatif, OK en futur.
- **`@sentropic/flow`** : « réutilisation écosystème » affirmée sans preuve d'adéquation. À valider par un spike **avant** d'en faire la fondation.
- **Toggle réel/simulation** : techniquement faisable — la provenance par item existe déjà (`verification`, DATA_MODEL §8). D'où ma recommandation §5 : dériver le mode de la provenance, pas un toggle qui swappe des datasets.
- **signal→N opportunités** : structurellement faisable, mais le « N » (zone→lots) est **hypothèse seule** pour Valleyfield (proximité par nom de rue, DATA_MODEL §1.3). Doit porter `confirmed: false` (reco DATA_MODEL §5.3). Le spec ne le mentionne pas.
- **T0 « proposition de sources »** : le set Tier-A est en réalité **constant** pour les 1 100+ municipalités QC (DATA_MODEL §1.1). La « proposition » est surtout un template fixe + découverte du site municipal — moins novateur que présenté, mais faisable.

## 8. Grilles de score (§4) — justesse, calibration, corrections concrètes

**Couche A (§4.2)** — fidèle à VISION §6 (bonne traçabilité), mais :
- **Multiplier type × confiance écrase deux dimensions** (valeur stratégique vs certitude de détection). Un zonage 10 détecté à 0,5 = un PPCMOI 7 à 0,7 ≈ 5 : pour le triage T1, on **enterre** justement les signaux « haute valeur mais incertaine » qu'on voudrait remonter à l'humain. ➜ **Afficher valeur ET confiance séparément**, ne pas multiplier.
- **Table incomplète** vs la taxonomie des inputs : manquent *intention politique* (PV), *consultation publique annoncée*, *refonte/plan d'urbanisme*, *modification de grille/COS*, *requalification de secteur*, *TOD*, *investissement public*. ➜ Ajouter ces lignes ou définir leur mapping.
- **Agrégation multi-signaux** non définie (max vs additif).

**Couche B (§4.3)** — corrections par axe :

- **Potentiel (30 %)** : la grille **mélange magnitude et maturité légale** (niv. 3 « en cours », 4 « adopté », 5 « en vigueur »). Or la maturité est l'axe Timing → **double comptage**. PROCESS §3 définit Potentiel = *magnitude/nature de l'ouverture + alignement intentions*, indépendamment du statut. ➜ Réécrire Potentiel **purement sur l'ampleur** (combien de densité/usage/valeur débloqués, alignement municipal) ; **retirer « en vigueur » du niveau 5** (anti-asymétrie VISION).
- **Risque (20 %, inversé)** : grille la plus propre. Deux corrections : (1) **désambiguïser CPTAQ** — *zone agricole protégée sans demande* = bloquant ; *demande/décision de dézonage en cours* = signal positif, risque moindre ; (2) ajouter un niveau/règle **« indéterminé / non-intersecté »** qui **ne défausse PAS vers 5** (sinon « inconnu » = « sûr », dangereux). Repasse à l'échelle **0–5** : 0 = bloquant absolu.
- **Timing (20 %)** : séparer **horizon** (long ≠ mauvais en soi) et **visibilité concurrentielle**. Ne pas pénaliser la CPTAQ structurelle long-terme (VISION §9). Le niveau 5 « marché pas au courant » exige une **mesure** (proxy transactions/permis) — indisponible (Tier C) ⇒ aujourd'hui inatteignable légitimement. ➜ Définir le proxy ou marquer le critère « visibilité » comme hypothèse.
- **Faisabilité (15 %)** : retirer/flagger **« propriétaire unique » / « multipropriété »** (caviardé, LFM 72) comme hypothèse ; **confirmer la source de « services en place »** (eau/égout — pas évident en open-data).
- **Marché (15 %)** : définir le comportement **non-disponible** = renormaliser sur les axes disponibles **+ plafonner la recommandation à « surveillance »** (PROCESS §3 : « score élevé sans preuve récente → surveillance »), **jamais** un niveau neutre fabriqué.
- **Transverse** : (1) afficher la **version de grille** par score (la vue est dite « versionnée » §4.4, mais le lien score↔version n'est pas posé) ; (2) pondérer par la **confiance** ; (3) **calibrer les 5 grilles sur les 3 pilotes Valleyfield réels avant de figer** — sinon la calibration reste « proposée » (mot du spec) et non testée.

## 9. Top 5 améliorations concrètes, priorisées

1. **Clarifier la sémantique du score (fondation, débloque tout).** Acter que score brut (prior de *type*, /10, §4.2) ≠ score pondéré (composite multi-axes, /5→/100, §4.3) ; **supprimer le récit trompeur « 90→63 / brut→provisoire→final »** comme un seul score raffiné. **Définir le traitement « non-disponible »** dans `Σ(niveau×poids)` : renormalisation sur axes disponibles + plafond « surveillance ». Sans ça, aucun score final n'est calculable honnêtement sur Valleyfield.

2. **Corriger et calibrer les grilles** (§4.3). Dé-confondre Potentiel (ampleur) vs Timing (maturité/visibilité) ; retirer « en vigueur » de Potentiel-5 ; passer en **0–5** (PROCESS) ; désambiguïser CPTAQ ; ajouter « indéterminé≠sûr » au Risque. Puis **valider sur les 3 dossiers réels** (H-609-4, U-521→H-521, H-143) avant de figer.

3. **Ancrer les grilles dans la réalité des données** (DATA_MODEL). Marquer par défaut **Marché (Tier C), propriétaire (LFM 72), Risque (gap polygone)** comme non-disponibles ; aucune valeur fabriquée ; intégrer `confirmed:false` et `zonePolygonSource` (reco DATA_MODEL §5). C'est l'application de la règle anti-triche + gouvernance PROCESS §5.

4. **Réduire la surface du socle (YAGNI).** Sortir du socle : **T3 console / T4 jobs** (hors-scope VERTICAL_SLICE §11), **`@sentropic/flow`** (spike de validation d'abord), **voie (c) MCP**. Socle minimal = modèle d'états + grilles + vue Grilles + **Radar T1** + **Opportunités T2** + **provenance/simulation au niveau donnée** (pas de toggle par vue).

5. **Compléter le modèle temporel & les taxonomies.** Ajouter : dossier **multi-séances** + rétroanalyse alimentant le suivi (VISION §4.2/§4.5/§7) ; **liaison de documents** par n° de règlement (VISION §4.4) ; **taxonomie d'actions complète** PROCESS §6 (rejeter/surveiller/qualifier-expert/approcher-propriétaire/acquisition) ; **types de signaux manquants** en Couche A (intention politique, consultation, refonte, grille/COS, TOD, investissement public) + provenance `simulé` dans l'enum.

---

**Verdict synthétique** : le spec pose les bonnes intentions (anti-pifométrie, traçabilité, démo fidèle, signal→N) et une décomposition saine, mais il **figure des grilles non encore confrontées à la réalité des données** que l'investigation a pourtant documentée — d'où trois axes (Marché, Risque, Faisabilité) partiellement inopérants en l'état, une **confusion Potentiel/Timing**, une **incohérence d'échelle entre les deux couches de score**, et un **socle trop large** (console/jobs/flow). À corriger en priorité avant de replanifier le `PLAN.md` : la sémantique du score + le traitement « non-disponible » + la calibration sur les 3 pilotes réels.
