# Critique Structurée du Socle v4 — Évaluation Critique Senior (Process E2E & Modèle Opérationnel)

**Rôle** : Relecteur Critique Senior (Antigravity)  
**Date** : 2026-05-26  
**Statut de la révision** : Évaluation de la v4 intégrant les retours v3  
**Cible** : `/home/antoinefa/src/radar-immobilier/tmp/socle-reviews/critique-agy-v4.md`

---

## 1. Application des corrections v3 en v4 (Analyse point par point)

La version 4 du socle (`SPEC_EVOL_PROCESS_E2E.md`) et du modèle opérationnel (`SPEC_EVOL_OPERATING_MODEL.md`) a fait l'objet d'un assainissement et d'un "right-sizing" en profondeur. Voici la vérification systématique des 9 chantiers issus de la critique v3 :

*   **(a) h2a V1 = POLICY + label de rôle + journal simple (Crypto/modes/ABC différés)**  
    *   **Statut : OK / Entièrement résolu.**  
    *   *Justification* : Le §11 et le §6 de la `SPEC_EVOL_PROCESS_E2E.md` valident formellement ce compromis. La complexité cryptographique (`ed25519`), les modes de coordination avancés, les profils ABC et les contrats bilatéraux sont explicitement repoussés à des phases ultérieures (hors V1). La V1 se focalise uniquement sur une `POLICY` anti-triche exploitable, l'étiquetage en clair des rôles et un journal d'événements simple en base de données.
*   **(b) Spike d'abord et découplé (comme pour flow)**  
    *   **Statut : OK / Entièrement résolu.**  
    *   *Justification* : L'incohérence méthodologique a été levée au §5 et §11. `@sentropic/h2a` (v0.3.1) est désormais traité avec la même prudence d'ingénierie que `@sentropic/flow` : *spike de compatibilité et de validation d'abord*, puis intégration découplée derrière une interface propre pour isoler le socle des instabilités de la bibliothèque.
*   **(c) PRINCIPAL = humain, l'IA n'est jamais PRINCIPAL**  
    *   **Statut : OK / Entièrement résolu.**  
    *   *Justification* : La correction de catégorie a été rigoureusement appliquée. Le §11 de la `SPEC_EVOL_PROCESS_E2E.md` et le §2 de la `SPEC_EVOL_OPERATING_MODEL.md` réaffirment que le `PRINCIPAL` est obligatoirement un humain ou un groupe d'humains légalement constitué (l'expert Sentropic). L'IA est reléguée à son rôle naturel de `CONDUCTOR` (supervisant la meute d'agents de développement) ou d'exécutante sous mandat.
*   **(d) Retrait de public-authority/consortium comme recours + nœud externe OACIQ/médiation**  
    *   **Statut : OK / Entièrement résolu.**  
    *   *Justification* : Les abus linguistiques ont disparu. Les modes `consortium` et `public-authority` sont écartés de la V1. Le modèle opérationnel intègre désormais un **nœud d'escalade externe réaliste** (médiation, OACIQ, tribunaux) au lieu de faire de Sentropic le juge et partie terminal des litiges plateforme-client, éliminant ainsi le deadlock de gouvernance d'affaires.
*   **(e) federation ➔ CONTRACT/delegated**  
    *   **Statut : OK / Entièrement résolu.**  
    *   *Justification* : La relation d'affaires B2B est requalifiée au §2 de la `SPEC_EVOL_OPERATING_MODEL.md` comme un `CONTRACT` SaaS standard avec autorité `delegated`, ce qui correspond exactement à la réalité commerciale du radar et élimine la fiction d'une fédération de pairs souverains.
*   **(f) B2B2C + support multi-tiers = hypothèse hors V1**  
    *   **Statut : OK / Entièrement résolu.**  
    *   *Justification* : La topologie multi-tenant complexe, le support à 4 niveaux et le cycle d'affaires B2B2C sont explicitement classés comme "hypothèses stratégiques cibles" et sortis du périmètre de la démo V1, qui redevient un radar mono-opérateur centré sur l'utilisateur interne.
*   **(g) Coût marginal réécrit honnêtement**  
    *   **Statut : OK / Entièrement résolu.**  
    *   *Justification* : Changement de ton salutaire au §4 de la `SPEC_EVOL_OPERATING_MODEL.md`. Le mythe du coût marginal plat a été écarté pour admettre que l'intervention humaine experte (et payante : registre foncier, validation réglementaire locale) est sur le **chemin critique** de chaque opportunité qualifiée, et non un simple "edge case" de support. Un modèle de coût récurrent par dossier qualifié est préconisé.
*   **(h) Loi 25 (PII hors-chaîne)**  
    *   **Statut : OK / Entièrement résolu.**  
    *   *Justification* : Prise en compte cruciale de la conformité québécoise au §11 de la `SPEC_EVOL_PROCESS_E2E.md` et au §5 de la `SPEC_EVOL_OPERATING_MODEL.md`. Pour respecter le droit à l'effacement et à la rectification de la Loi 25, toutes les informations nominatives (propriétaires issus du registre foncier payant) seront stockées **hors chaîne signée immuable** (uniquement des hashs ou des clés de référence).
*   **(i) Signer les décisions d'affaires globales, jamais les items de données individuels**  
    *   **Statut : OK / Entièrement résolu.**  
    *   *Justification* : Résolution élégante du risque d'explosion combinatoire. Au lieu de forcer une signature cryptographique sur chaque lot extrait d'un rezonage massif (qui aurait saturé la SPA), le système ne signera cryptographiquement (lorsque la crypto sera activée) que les jalons de décision d'affaires lourds (qualification finale, go/no-go).

---

## 2. Nouvelles contradictions ou régressions introduites en v4

L'examen attentif des modifications v4 ne révèle **aucune régression fonctionnelle ni contradiction logique**. Bien au contraire, les ajustements structurels améliorent la cohérence d'ensemble :

1.  **Désambiguïsation du Scoring (T1 vs T2) :** L'abandon de l'ancien récit d'un "score unique qui s'affine" au profit de deux mesures étanches (le *score de triage T1* /10 basé sur la typologie de signal, et le *score d'opportunité T2* basé sur une analyse multi-axes ancrée au réel) élimine une friction conceptuelle historique majeure.
2.  **Introduction de l'échelle 0-5 (et du 0 bloquant) :** Le passage à une échelle incluant le 0 (au lieu de 1-5) pour le score d'opportunité T2 (§4.3) résout la prise en compte des contraintes environnementales et d'aménagement rédhibitoires (ex: zone inondable active, zone agricole pérenne). Cela s'accorde logiquement avec la règle de décision qui plafonne la recommandation à "surveillance" ou "rejet".
3.  **Traitement lucide des données manquantes :** L'introduction de `confirmed: boolean` sur les lots (§3) et l'aveu pragmatique du gap géospatial de Valleyfield (les grilles de zonage n'étant disponibles qu'en PDF matriciels) prouvent que la v4 fait face aux contraintes du terrain. Dire honnêtement que les opportunités initiales seront étiquetées `"hypothese-street-name"` et plafonnées à `"surveillance"` respecte scrupuleusement la charte éthique anti-triche du projet.

---

## 3. Juste milieu du périmètre V1 (Ni trop maigre, ni trop gras)

La v4 atteint un **équilibre d'ingénierie remarquable** :

*   **Ce qui a été élagué (le "Gras" / YAGNI évité) :**
    *   Pas de gestion complexe de clés privées `ed25519` dans la SPA Svelte (ce qui posait de lourds risques de failles XSS/PII).
    *   Pas de déploiement de meutes d'agents de support autonomes et instables en direct avec le client final (Tier 0).
    *   Pas d'implémentation prématurée de protocoles de gouvernance multi-humains (`consortium`, `public-authority`).
*   **Ce qui a été préservé (la "Valeur" métier sécurisée) :**
    *   Le **mode global Réel ↔ Simulation** reste au cœur de l'UI pour matérialiser clairement les projections d'aménagement.
    *   La **règle anti-triche** est intégralement garantie par la provenance par item, l'étiquetage clair du rôle instructeur, et le plafonnement automatique des dossiers incomplets.
    *   La **mémoire temporelle multi-séances** et la liaison réglementaire contextuelle (avis ↔ règlements ↔ PV) restent inchangées, assurant une démo percutante et à haute valeur ajoutée.

---

## 4. Points bloquants résiduels avant de replanifier le `PLAN.md`

**Aucun point bloquant technique ou d'affaires ne subsiste.**
Les zones d'incertitude qui paralysaient la v3 ont été méthodiquement traitées :
*   Le gap des polygones géospatiaux de Valleyfield est assumé et encapsulé par le statut `confirmed: false` et la source `zonePolygonSource`.
*   Le problème du runtime Edge de `@sentropic/h2a` est neutralisé par le découplage systématique derrière une interface et la planification d'un spike préliminaire en phase 5.
*   Les risques juridiques liés à la Loi 25 québécoise sont balisés par le cloisonnement des renseignements personnels hors de la chaîne d'audit immuable.

La voie est totalement libre pour actualiser la feuille de route.

---

## 5. Verdict final et suggestions résiduelles

### Verdict : GO (Franc, massif et immédiat)

La spécification v4 est validée pour la replanification du `PLAN.md`. C'est un cadre d'ingénierie extrêmement propre, d'une grande rigueur professionnelle, qui garantit la livraison d'une démo robuste et commercialement convaincante sans accumuler de dette technologique cryptographique ou d'architectures sur-ingéniérées.

### Corrections résiduelles recommandées (Maximum 3)

Pour parfaire les développements du socle, voici les 3 micro-ajustements suggérés à intégrer lors de l'écriture des tâches :

1.  **Immutabilité logicielle du journal simple (V1) :**
    Bien que la crypto soit différée, spécifier dans le modèle de données SQL que la table du journal d'événements simple possède des droits d'accès limités en écriture (pas de `UPDATE` ni de `DELETE` autorisés au niveau de l'ORM/Postgres) afin de simuler logiciellement le comportement append-only à moindres frais en V1.
2.  **Masquage des PII à l'affichage :**
    Préciser formellement que dans l'UI de la démo, si une donnée de propriétaire est extraite ou validée manuellement via le registre foncier (payant), elle doit être masquée par défaut (ex: *« Propriétaire validé (Nom masqué - Loi 25) »*) et accessible uniquement sur clic explicite avec journalisation de l'accès, afin de démontrer la sensibilité Loi 25 directement devant le client.
3.  **Alerte d'assemblage de micro-lots sur les pré-filtres physiques :**
    S'assurer que le pré-filtre physique de superficie (lot ≥ 350 m²) n'exclut pas silencieusement des micro-lots adjacents appartenant au même propriétaire (ou contigus et sous-exploités) qui présenteraient un potentiel d'assemblage foncier majeur une fois réunis. Ajouter une règle métier de "détection de contiguïté de micro-lots sous-exploités" lors des phases ultérieures d'enrichissement.
