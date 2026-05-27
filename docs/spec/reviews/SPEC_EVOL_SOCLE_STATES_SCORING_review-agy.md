# Relecture Critique FOCALISÉE — Évolution ÉV1 (Socle States & Scoring)
**Par : Antigravity, relecteur critique**

---

### 1. CALIBRATION : Justesse arithmétique et cohérence de l'axe Marché

- **Justesse arithmétique (§5) :** 
  Les calculs des 3 scores partiels à partir des niveaux d'axes renormalisés sur un poids disponible de `0.85` (retrait de l'axe Marché, poids de `0.15`) sont **strictement justes** et rigoureux.
  
  - **H-609-4 (Champlain) :**
    $$\text{Score} = \frac{4 \times 0.30 + 3 \times 0.20 + 3 \times 0.20 + 2 \times 0.15}{0.85} = \frac{2.70}{0.85} \approx 3.17647 \rightarrow \mathbf{3.18}$$
    *(Conforme aux 3.18 de la spec, ligne 287)*
  
  - **U-521 → H-521 (Lanctôt / Cossette) :**
    $$\text{Score} = \frac{4 \times 0.30 + 2 \times 0.20 + 4 \times 0.20 + 3 \times 0.15}{0.85} = \frac{2.85}{0.85} \approx 3.35294 \rightarrow \mathbf{3.35}$$
    *(Conforme aux 3.35 de la spec, ligne 287)*
  
  - **H-143 / H-143-1 (Grande-Île) :**
    $$\text{Score} = \frac{3 \times 0.30 + 1 \times 0.20 + 4 \times 0.20 + 2 \times 0.15}{0.85} = \frac{2.20}{0.85} \approx 2.58823 \rightarrow \mathbf{2.59}$$
    *(Conforme aux 2.59 de la spec, ligne 287)*
  
  Les valeurs tombent parfaitement à deux décimales près.

- **Honnêteté et cohérence du Marché "non-disponible" :**
  Oui, la décision d'exclure l'axe Marché pour les 3 pilotes est **parfaitement cohérente et honnête**. Utiliser des proxies macro-économiques (comme la vacance de la SCHL à 0,1 % ou la hausse des permis de la MRC à 22 %) pour simuler un score local de marché spécifique à la zone serait une violation flagrante de la règle anti-triche (*anti-invention*). Les données réelles à l'échelle de la zone (comparables JLR/Centris) manquent cruellement (Tier C gap, cf. `valleyfield-dossiers.ts` ligne 248).
  
- **Biais de l'exclusion de l'axe marché :**
  Il existe un biais mathématique inhérent à cette renormalisation. Exclure un axe non disponible *gonfle artificiellement* le score global si cet axe avait été médiocre dans la réalité (ex. si le marché réel s'était avéré à un niveau de 1 ou 2), et inversement le *pénalise* s'il avait été excellent (niveau 5). Dans notre cas, exclure un marché inconnu revient à faire l'hypothèse implicite que le marché est exactement dans la moyenne pondérée des autres axes. Ce biais est acceptable **uniquement parce qu'il est neutralisé par le garde-fou (cap) de recommandation** qui bloque les actions d'engagement.

---

### 2. ALGORITHME non-disponible (§3.4) : Renormalisation et Plafond de Recommandation

- **Santé globale de l'algorithme :**
  Le principe de renormalisation + plafond à `qualifier-avec-expert` (bloquant `approcher-propriétaire` et `monter-dossier-acquisition`) est extrêmement sain. C'est un excellent garde-fou opérationnel qui évite d'engager des capitaux sur des dossiers où des pièces maîtresses (contraintes ou valeur marchande) sont manquantes.

- **Failles identifiées :**
  1. **Asymétrie des poids non gérée :** L'algorithme traite de manière identique la non-disponibilité d'un axe de poids faible (Marché, 15 %) et d'un axe de poids fort (Potentiel, 30 %). Manquer le potentiel réglementaire (le moteur même du projet) déclenche le même statut `partial` et le même cap qu'un manque sur le marché. C'est une faille conceptuelle de discernement.
  2. **Vulnérabilité critique de division par zéro dans le code (Crash) :**
     Dans le TypeScript de la ligne 233-241, si **tous** les axes sont `non-disponible` (ou si la somme des poids disponibles $wSum$ vaut 0), le calcul fait une division par zéro `(level * weight) / wSum` produisant un crash `NaN`. Il manque un garde-fou.
  3. **Absence d'implémentation du plancher `availableWeightSum` (§9, proposé à 0.50) :**
     Ce plancher est excellent en théorie pour éviter de noter un dossier "trop mince", mais il est **complètement absent** du code TypeScript esquissé au §3.4. Sans garde-fou explicite (`if (wSum < 0.50)`), un dossier avec seulement 15 % de données disponibles (ex. Faisabilité seule) sera renormalisé sur 100 %, générant un score pseudo-fiable et aberrant.
  4. **Garantie du "Inconnu != favorable" :**
     Elle est garantie dans le sens où l'on n'attribue pas une note neutre (2.5) ou optimiste artificielle. Cependant, comme expliqué au point 1, sur le plan purement arithmétique, exclure un axe potentiellement mauvais *favorise* le score par rapport à sa réalité. La sécurité ne repose donc pas sur la formule arithmétique mais uniquement sur la robustesse du typage du cap de recommandation.

---

### 3. MODÈLE D'ÉTATS (§2) : Complétude pour une Fondation vs Gold-plating

- **Complétude pour ÉV2 (Radar T1) / ÉV3 (Opportunités T2) :**
  Le modèle d'états est solide pour une fondation, mais il souffre d'un oubli et d'un manque de flexibilité majeurs :
  
  1. **Absence de distinction de mode dans le journal/dossier :**
     La spec introduit un mode global `Réel ↔ Simulation` (§6), mais ne prévoit aucun champ `mode: "real" | "simulation"` dans le schéma `OpportunityDossier` ou dans la table du journal append-only. Si l'utilisateur passe en mode Simulation et prend une décision, cette décision va polluer le registre append-only de production réelle. C'est un point de régression majeur pour la traçabilité et l'auditabilité.
  2. **Absence de métadonnées pour le gabarit/COS aval (ÉV3) :**
     ÉV3 (Opportunités T2) exigera de calculer la capacité physique réelle (nombre d'unités max, COS). Le schéma `lots` actuel dans `opportunity.ts` ne possède pas de champ générique de métadonnées géométriques ou réglementaires (`metadata: jsonb`), ce qui obligera à une nouvelle migration SQL lourde lors d'ÉV3.

- **Sur-spécification (Gold-plating) :**
  - **`zonePolygonSource` (§2.2) :** L'enum très strict (`"open-data-ckan" | "wms-municipal" | "vectorised-pdf" | "hypothese-street-name"`) est trop rigide pour une V1. Un simple typage string ou un enum plus large aurait évité de brider le système face à de nouvelles sources imprévues (ex. API provinciale, scraping de rapports).
  - **Postgres immutable au niveau rôle applicatif (§2.4) :** Restreindre les privilèges `UPDATE/DELETE` au niveau rôle Postgres est une excellente pratique de sécurité pour une production multi-tenant, mais pour une démo V1 mono-opérateur, c'est de l'ingénierie prématurée qui alourdit les scripts de migration Drizzle (§7).

---

### 4. COHÉRENCE AVEC LE SOCLE PARENT

- **Contradiction sur le plafond de recommandation :**
  Il y a un léger glissement sémantique entre le parent et l'évolution :
  - `SPEC_EVOL_PROCESS_E2E.md` §4.4 stipule : *"plafonner la recommandation à « surveillance » si une preuve clé manque."*
  - `SPEC_EVOL_SOCLE_STATES_SCORING.md` §3.4 élargit le plafond à `qualifier-avec-expert` : *"the recommendation is bounded to {rejeter, surveiller, qualifier-avec-expert}"*.
  
  Cette dérogation est **intelligente et pragmatique** : elle permet d'escalader le dossier à un expert pour débloquer la donnée manquante, ce que le strict statut "surveillance" ne permettait pas d'initier de façon fluide.

- **Tenue des deux mesures distinctes (T1 vs T2) :**
  La cohérence est parfaitement tenue. L'abandon total du récit "un seul score qui s'affine" (`SPEC_EVOL_PROCESS_E2E.md` §4.1) est consommé. Le tri T1 (/10) reste un prior de détection macro, tandis que le score T2 (0-5) est le score d'opportunité micro ancré dans les faits de terrain. L'absence de multiplication valeur × confiance à l'étape T1 (§3.2) est également respectée, évitant de masquer les signaux incertains à fort potentiel.

---

### 5. PÉRIMÈTRE ÉV1 : Arbitrage et pertinence des choix

- **Ce qui doit SORTIR de l'ÉV1 (YAGNI / Sur-ingénierie) :**
  - **Le versionnage complet des grilles (§3.6) :** Gérer des versions multiples de grilles avec gel rétroactif des scores passés dans le schéma est inutile en V1 alors que nous n'avons qu'un ensemble de grilles par défaut et aucun éditeur de grilles dans l'UI. Cela complexifie inutilement la base de données.
  - **La sécurité Postgres au niveau rôle applicatif (§2.4) :** Peut être simulée par le code applicatif ou simplement reportée à ÉV4+.

- **Ce qui doit RENTRER dans l'ÉV1 (Manques critiques) :**
  - Le champ `mode: "real" | "simulation"` dans le schéma d'opportunité et la table de journal.
  - Le contrôle du plancher de 50 % ($wSum < 0.50$) directement implémenté dans le code de calcul d'agrégation.

---

### 6. POINTS BLOQUANTS ET CORRECTIONS RÉSIDUELLES

#### **Vrais Bloquants (À corriger impérativement avant approbation) :**
1. **Bug critique de division par zéro (aggregate §3.4) :** Risque de `NaN` si aucun axe n'est disponible.
2. **Absence du plancher de poids à 0.50 dans le code de calcul (§3.4 vs §9) :** Permet à des dossiers vides d'obtenir des scores extrapolés à 100 %.
3. **Pollution du registre par le mode Simulation :** Pas de cloisonnement (`mode`) dans la table Postgres du journal de décisions append-only.
4. **Incohérence du schéma TypeScript `opportunity.ts` :** Le schéma exporté dans `packages/radar-domain/src/schemas/opportunity.ts` ne supporte pas l'enveloppe complexe de score d'axe (`AxisScore` avec `confidence`, `evidenceRefs`, etc.), ce qui empêchera la compilation immédiate du code de calibration des 3 pilotes.

#### **Corrections résiduelles (Nettoyages faciles) :**
1. Relâcher l'enum très strict de `zonePolygonSource` pour le rendre plus évolutif.
2. Reporter l'implémentation du moteur de versionnage complexe des grilles à ÉV3.
3. Clarifier l'implémentation du masquage PII par défaut au niveau du backend vs affichage frontend (impact RGPD / Loi 25).

---

### VERDICT FINAL : NO-GO

La spec est d'une excellente qualité analytique et capture parfaitement la réalité complexe du terrain de Valleyfield. Cependant, l'absence de garde-fous dans l'algorithme d'agrégation ($wSum < 0.50$ et division par zéro) ainsi que le risque de pollution du journal de décision réel par le mode Simulation représentent des risques techniques majeurs pour un socle de fondation. Une révision rapide du code d'agrégation et du schéma pour inclure le typage des enveloppes de score et le cloisonnement réel/simulé lèvera immédiatement ce NO-GO.
