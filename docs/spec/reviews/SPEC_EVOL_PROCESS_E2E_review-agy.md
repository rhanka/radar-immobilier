# Relecture critique de la spécification : Process e2e, états, scoring & matérialisation (SOCLE)

> **Rôle** : Relecteur critique senior (architecture produit, modèle de données et immobilier au Québec)  
> **Date de relecture** : 26 mai 2026  
> **Cible** : [SPEC_EVOL_PROCESS_E2E.md](file:///home/antoinefa/src/radar-immobilier/tmp/docs-process-e2e-socle/docs/spec/SPEC_EVOL_PROCESS_E2E.md)  
> **Contexte** : Intégration des acquis de l'investigation réelle de Valleyfield ([SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md](file:///home/antoinefa/src/radar-immobilier/tmp/docs-process-e2e-socle/docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md), [SPEC_EVOL_DATA_MODEL.md](file:///home/antoinefa/src/radar-immobilier/tmp/docs-process-e2e-socle/docs/spec/SPEC_EVOL_DATA_MODEL.md) et [SPEC_EVOL_DEMO_FINDINGS.md](file:///home/antoinefa/src/radar-immobilier/tmp/docs-process-e2e-socle/docs/spec/SPEC_EVOL_DEMO_FINDINGS.md)).

---

## 1. Forces de la spécification

Le document présente des bases solides qui font progresser le projet vers une maturité industrielle :

*   **Rigueur du découpage de l'entonnoir (T0→T4) (§2)** : La structuration en 5 traitements distincts (onboarding municipal, veille Radar, approfondissement, gestion des sources et monitoring) permet de bien clarifier les écrans et le cycle de vie de la donnée.
*   **Modélisation amont/aval réaliste (§3)** : La distinction conceptuelle `1 signal (T1 - amont) → N opportunités (T2 - aval)` est tout à fait juste. Elle reflète parfaitement la réalité où un seul amendement de zonage (ex: règlement 150-49) s'applique à une ou plusieurs zones physiques comprenant des dizaines de lots cadastraux distincts.
*   **Charte d'honnêteté et toggle Réel/Simulation (§1 et §6)** : L'obligation d'étiqueter explicitement toute donnée simulée par le label *« instruit par l'humain · hypothèse simulée »* est une excellente mesure anti-triche (rendue nécessaire suite aux dérives constatées avec le benchmark G2). Cela protège la crédibilité de la démo.
*   **Objectivation du scoring (§4.1/4.2/4.3)** : Remplacer l'évaluation LLM pifométrique originelle par des grilles configurables de 1 à 5 combinées à des justifications interactives (au survol) assure la traçabilité et la transparence attendues par les professionnels de l'immobilier.
*   **Split pragmatique de la charge de travail (§5)** : La répartition des tâches en `auto-only`, `assisté` et `décision-humaine` témoigne d'une bonne compréhension des verrous légaux et techniques de l'écosystème québécois.

---

## 2. Faiblesses et risques majeurs

*   **Le risque du « Zoning Polygon Gap » (Impasse géospatiale) (§4.3 / §6)** : La spécification postule une intersection géospatiale automatique pour valider le potentiel réglementaire des lots en T2. Or, l'investigation réelle de Valleyfield ([SPEC_EVOL_DATA_MODEL.md §1.3](file:///home/antoinefa/src/radar-immobilier/tmp/docs-process-e2e-socle/docs/spec/SPEC_EVOL_DATA_MODEL.md#L37-L58)) a démontré qu'il n'existe pas de jeu de données vectoriel ouvert pour les zones de cette municipalité (plans uniquement disponibles en images PDF scannées). Sans solution de repli (ex. : appariement textuel par noms de rues ou numérisation manuelle rapide), l'automatisation complète de la phase T2 est irréalisable à court terme pour de nombreuses municipalités québécoises.
*   **La barrière légale sur l'identité des propriétaires (LFM Art. 72) (§3 / §5)** : Le modèle d'opportunité T2 cherche à récupérer le nom du propriétaire pour qualifier la faisabilité foncière. Or, l'Article 72 de la *Loi sur la fiscalité municipale* interdit la diffusion publique des noms de propriétaires en open-data. Le système sera donc aveugle en mode automatique standard (Tier A), forçant le recours au Registre Foncier payant (Tier C, 1,50 $/doc via JLR ou API privée). Cette dépendance cruciale à une donnée payante et non automatisable facilement à l'échelle n'est pas assez soulignée dans les flux de traitements.
*   **La fragilité technique de la source YouTube (§2 / §5 / §7)** : L'utilisation des vidéos de conseils municipaux pour la veille T1 est séduisante mais sous-estime les obstacles techniques : l'API `timedtext` de YouTube requiert souvent une session authentifiée, et l'orchestration locale de `yt-dlp` + Whisper pour transcrire des séances de 3 heures s'avère lourde, coûteuse et sujette à un taux élevé de faux positifs si elle n'est pas précédée d'un découpage thématique fin.
*   **Risque de saturation de la base de données par l'effet multiplicateur (§3)** : Si le passage de T1 à T2 s'effectue de manière purement automatique, un seul changement de zonage sur un grand boulevard ou une zone résidentielle élargie peut créer d'un coup plus de 200 fiches opportunités (lots individuels), saturant l'écran de l'utilisateur de "bruit" peu exploitable financièrement (petits lots, habitations récentes, etc.).

---

## 3. Contradictions et incohérences internes

*   **Contradiction majeure dans l'ordonnancement de la planification (§2 vs §9)** : Le traitement **T0** (Onboarding + proposition de sources + rétroanalyse 2 ans) est défini au §2 comme l'étape d'amorçage indispensable pour configurer une municipalité et générer le corpus initial. Pourtant, dans le plan d'évolution proposé au §9, le développement de **T0** est relégué en **6e position**, bien après le Radar T1 (étape 2) et les Opportunités T2 (étape 3). C'est une incohérence majeure : comment faire tourner et tester le Radar ou les Opportunités en mode "données réelles" sans avoir développé les fondations de configuration et d'ingestion fournies par T0 ?
*   **Veille promptée vs Monitoring de jobs d'ingestion (§7 vs §2)** : Le tableau d'automatisation du §7 décrit la voie (a) (Refresh piloté par prompt de façon itérative par source) comme "oui, prouvé". Cependant, le §2 introduit un écran de monitoring des jobs T4 (runs, échecs). Si le système repose sur des prompts lancés à la demande par des agents pour lire les PV municipaux, la notion d'ingestion structurée (ETL planifiée) entre en conflit direct. La spécification doit clarifier où s'arrête la tâche planifiée (cron/scraping classique) et où commence l'exécution de l'agent `@sentropic/flow`.
*   **Incompatibilité de la règle d'or avec la simulation de lots (§6 vs §1)** : La règle cardinale de l'application est *« ne rien inventer »*. Or, activer le mode "Simulation" sur la vue Opportunités T2 risque d'amener le système à générer de faux attributs de lots (fausses superficies, fausses valeurs, faux propriétaires) pour illustrer la démo. Si ces données simulées côtoient des lots réels, la distinction risque d'être floue pour l'utilisateur, ce qui heurte de plein fouet la règle anti-triche globale de `rules/MASTER.md`.

---

## 4. Manques (Gaps à combler)

*   **Typage de la provenance géospatiale** : Dans le modèle d'opportunité, il manque un attribut pour expliciter la méthode d'affectation géologique du lot à la zone réglementaire, afin de gérer l'absence de vecteurs municipaux ouverts. Une propriété `zonePolygonSource: "vectorised-pdf" | "open-data" | "street-name-proximity" (hypothese)` est requise pour assurer la transparence du faisceau de preuves.
*   **Flag de validation cadastrale** : La fiche d'opportunité minimale (§4 du PROCESS et §3 de la spécification) doit intégrer un indicateur `confirmed: boolean` sur les lots candidats pour différencier un lot lié par simple proximité d'adresse (hypothèse) d'un lot géométriquement intersecté avec la zone réglementaire (fait validé).
*   **Gouvernance du stockage et rétention des gros fichiers** : La spécification ne mentionne aucun mécanisme de gestion pour le stockage des fichiers lourds d'ingestion (XML du rôle d'évaluation de 27 Mo, fichiers PDF volumineux des avis municipaux, transcriptions de conseils). Une architecture de cache local ou de stockage objet (S3) doit être spécifiée pour éviter l'engorgement du disque.
*   **Versioning des grilles de score configurables (§4.4)** : Si l'utilisateur édite et publie une nouvelle version des poids ou des grilles de notation, la spécification ne précise pas si les opportunités déjà notées sous l'ancienne grille doivent être recalculées rétroactivement ou gelées sous leur ancienne version pour conserver l'historique des analyses.

---

## 5. Sur-ingénierie et YAGNI (À retirer ou simplifier)

*   **Le Toggle Réel/Simulation au niveau de chaque vue (§6)** : Concevoir et implémenter un interrupteur "Réel ↔ Simulation" par écran multiplie les chemins de données et les états dans le code du frontend (Svelte/React), créant une complexité de maintenance inutile. Il est fortement recommandé de déplacer ce toggle à un niveau global (Workspace ou header global de la console) pour basculer toute la session utilisateur en "Mode Démo/Simulation" ou "Mode Production/Réel".
*   **Les connecteurs MCP par source en cible (§7, Voie c)** : Créer des serveurs Model Context Protocol (MCP) spécifiques pour chaque municipalité est une sur-ingénierie manifeste à ce stade. Des scripts ETL légers lancés par cron (comme démontré par Codex C2 avec le rôle XML) ou des intégrations directes d'APIs publiques sont plus fiables, plus simples à maintenir et moins consommateurs de ressources que des connecteurs agent-natifs complexes.
*   **Le panneau latéral de Chat global persistant (§5)** : Maintenir une session de chat persistante et synchronisée à travers tous les écrans et toutes les étapes du pipeline est lourd à mettre en œuvre en V1. Il serait plus efficace et plus simple de proposer un composant de chat contextuel intégré directement dans les écrans stratégiques (ex: Onboarding T0 et Qualification Opportunités T2), plutôt qu'un outil persistant transverse.

---

## 6. Alignement VISION / PROCESS (Analyse des écarts)

*   **Le paradoxe de la notation de la CPTAQ (VISION §6 vs PROCESS §3)** : C'est le plus gros écart conceptuel constaté. La **VISION §6** identifie la CPTAQ (dézonage agricole) comme une opportunité majeure de priorité 1 (score 8/10), un excellent signal précoce de développement futur à long terme (1 à 10 ans). Cependant, le modèle de scoring du **PROCESS §3** intégré au §4.3 (Grille Risque de contrainte) classe la présence d'une zone CPTAQ active en niveau 1 ("bloquant"), ce qui détruit immédiatement le score global de l'opportunité. Le système se contredit en interne : il cherche d'un côté à lever des signaux de veille agricole (VISION), tout en disqualifiant immédiatement ces mêmes lots lors de la notation (PROCESS).
*   **Le flou sur la qualification des dérogations mineures** : La VISION §6 exige explicitement de filtrer le bruit des dérogations non résidentielles ou trop mineures (cabanons, clôtures). Le PROCESS intègre cette exigence en théorie dans la Couche A du score brut (§4.2, score 1/10 à filtrer). Toutefois, la spécification ne détaille pas la grammaire ou la méthode d'ingestion qui permettra au LLM/Parser d'effectuer ce tri de manière fiable et déterministe.

---

## 7. Faisabilité technique (Analyse et Scoring)

*   **Scoring double couche (§4.2 et §4.3)** : **Haute faisabilité**. La formule est simple, transparente et facilement modélisable en base de données. L'utilisation d'une validation Zod dans `@radar/domain` garantira la conformité des données écrites.
*   **Automatisation par phases (§7)** :
    *   **Voie (a)** (Refresh par prompt) : **Faisabilité élevée** pour un prototype ou une démo ciblée, mais **non viable à l'échelle** en production en raison des coûts de jetons LLM et des latences de traitement.
    *   **Voie (b)** (Jobs + ETL stables) : **Excellente faisabilité**. L'utilisation des APIs CKAN et des flux de données structurés de Données Québec est robuste et peu coûteuse.
    *   **Voie (c)** (MCP) : **Faisabilité faible à moyenne** ; la complexité de mise en place de serveurs MCP n'en vaut pas la chandelle par rapport aux bénéfices opérationnels immédiats.
*   **Toggle Réel / Simulation (§6)** : **Faisabilité moyenne**. Elle ne pose aucun problème si elle s'appuie sur le chargement de fichiers JSON simulés figés mais réalistes. En revanche, si la simulation doit générer à la volée des informations cadastrales sur des lots réels, le risque d'incohérence technique est très fort.
*   **Pipeline Signal → N opportunités (§3)** : **Faisabilité complexe**. Si le système applique la liaison amont/aval à l'aveugle, l'extraction de lots sur des zones denses va générer un volume ingérable de fiches opportunités. Pour assurer la faisabilité technique, il est impératif d'intégrer des filtres physiques matériels automatiques (ex: exclure les lots inférieurs à 350 m² ou ayant un ratio valeur bâtiment/valeur terrain supérieur à 80 %) avant de créer les fiches T2.

---

## 8. Audit critique des grilles de score (§4.3)

Les grilles proposées au §4.3 pour la Couche B sont globalement cohérentes, mais nécessitent plusieurs ajustements d'étalonnage pour être fonctionnelles :

*   **Grille « Risque de contrainte » (Poids 20 %)** :
    *   *Niveau 1* : « bloquant (CPTAQ active / inondable 0-20 ans) ». **Correction nécessaire** : Pour aligner la grille à la VISION, une demande CPTAQ en cours ou une modification agricole imminente doit être notée à un niveau intermédiaire (ex: niveau 3 - négociable/mitigation active), tandis que seule la désignation de zone verte agricole *pérenne et protégée* (sans demande active) doit être classée en niveau 1 (bloquant).
*   **Grille « Timing » (Poids 20 %)** :
    *   *Niveau 5* : « fenêtre ouverte + marché pas au courant ». **Correction nécessaire** : L'état « marché pas au courant » est un concept abstrait inquantifiable par un algorithme ou un agent autonome. Il doit être remplacé par un indicateur factuel et vérifiable, par exemple : *« fenêtre ouverte + aucune transaction notariée récente enregistrée sur la zone depuis la publication du premier projet de règlement »*.
*   **Grille « Faisabilité foncière » (Poids 15 %)** :
    *   *Niveau 5* : « grand lot vacant, propriétaire unique ». **Correction nécessaire** : En raison de l'Art. 72 de la LFM, la donnée de propriété est masquée en open-data (Tier A). Par conséquent, en mode purement automatique sans saisie payante Tier C, le système sera incapable d'attribuer le niveau 5. La grille doit mentionner explicitement que les niveaux 4 et 5 sont « aveugles » en mode automatique et requièrent une validation humaine ou une clé d'accès Registre Foncier (Tier C).
*   **Grille « Valeur marché » (Poids 15 %)** :
    *   Cette grille repose sur des comparables et des prix d'absorption qui sont des données payantes et fermées (Tier C - Centris/JLR). En mode automatique gratuit, le système ne pourra évaluer que la valeur municipale. Il faut ajouter une note indiquant que cette dimension sera par défaut notée de manière conservatrice (ex: niveau 3 générique par municipalité) à moins d'un enrichissement manuel ou payant.

---

## 9. Top 5 améliorations concrètes et priorisées

Pour corriger les lacunes identifiées et garantir le succès de la replanification du `PLAN.md`, voici les cinq chantiers prioritaires à mener :

### 1️⃣ Résoudre l'impasse géospatiale (Zoning Polygon Gap) — [Priorité 1 · Technique]
*   **Action** : Ajouter l'attribut `zonePolygonSource` (enum : `vectorised-pdf | wms-municipal | open-data-ckan | hypothese-street-name`) dans le schéma Zod de `OpportunityDossier` pour acter le niveau de preuve géospatiale.
*   **Action** : Introduire un flag `confirmed: boolean` (défaut : `false`) sur les éléments de l'array `lots[]` pour séparer les lots candidats identifiés par correspondance d'adresse des lots physiquement et géométriquement validés par intersection polygonale.

### 2️⃣ Résoudre le paradoxe CPTAQ — [Priorité 2 · Métier & Scoring]
*   **Action** : Réviser la grille de notation du **Risque de contrainte** (§4.3) pour distinguer clairement la contrainte foncière bloquante immédiate (zone verte protégée intouchable) de la veille foncière active (demande CPTAQ en cours). Attribuer un score de 3/5 ou 4/5 aux demandes actives en cours pour éviter de saboter les notes globales des opportunités à long terme qui font le cœur de la VISION.

### 3️⃣ Réordonner le plan de replanification (T0 Onboarding) — [Priorité 3 · Architecture]
*   **Action** : Dans la décomposition des évolutions (§9), remonter l'évolution **Onboarding T0** de la 6e place à la **2e place** (juste après le Lot 1 - Socle modèle et scoring). On ne peut pas tester ni déployer sainement le flux Radar T1 ou Opportunités T2 sans disposer de l'assistant de configuration de ville et du chargeur de corpus initial.

### 4️⃣ Unifier le Toggle Réel/Simulation — [Priorité 4 · UX]
*   **Action** : Remplacer les multiples toggles par vue (§6) par un commutateur unique et global situé dans le header persistant de l'application. Ce switch basculera tout l'environnement (Radar, Opportunités, Sources, Jobs) dans un mode simulé ou réel, simplifiant drastiquement la gestion d'état dans le frontend Svelte.

### 5️⃣ Mettre en place des filtres physiques matériels pré-T2 — [Priorité 5 · Performance]
*   **Action** : Pour éviter la saturation des données en T2 due à l'effet multiplicateur d'un signal amont, définir des règles de filtrage géométrique et fiscal minimales en base de données avant la création automatique des dossiers opportunités (ex: superficie minimale du lot > 350 m², valeur du bâtiment < 80 % de la valeur totale du rôle d'évaluation).

---
