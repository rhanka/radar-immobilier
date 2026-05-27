# Relecture Critique de Confirmation FOCALISÉE — Évolution ÉV1 (v2)
**Rapporteur :** Antigravity, relecteur critique tranchant & anti-complaisance
**Date :** 27 mai 2026

---

### 1. DOCTRINE DE DISPONIBILITÉ (§3.4.0)

Le "test du grain de l'axe" introduit au §3.4.0 résout de manière rigoureuse et conceptuellement satisfaisante la contradiction apparente de la v1 (Risque disponible avec composants hypothétiques vs Marché exclu comme non disponible). 

- **Justification du Risque disponible (niveau 3, calibration §5) :** Les couches géospatiales BDZI ArcGIS et GRHQ fournissent des faits réels et vérifiés *à l'échelle locale de la zone elle-même* (0 inondation BDZI locale, hydrographie locale dans la bounding-box). Le fait que l'intersection précise CPTAQ soit hypothétique (mitoyenneté sur le Feuillet-1) baisse légitimement la confiance globale à `low`, mais ne remet pas en cause l'existence de données factuelles à l'échelle de la zone.
- **Justification du Marché non disponible :** L'axe Marché mesure la tension transactionnelle *spécifique à la zone*. En l'absence de comparables de transactions locaux (Centris/JLR non disponibles, Tier C gap), utiliser les données de permis de la MRC ou la vacance de la SCHL (qui sont de grain macro-régional) équivaudrait à attribuer arbitrairement à la zone une note moyenne. Ce serait une fabrication/invention de donnée locale, contraire aux principes de la VISION et de l'anti-triche.
- **Verdict :** Le principe est **parfaitement défendable**. Il trace une frontière claire : le niveau géographique des preuves doit correspondre à l'échelle de mesure de l'axe. Le biais mathématique induit par la renormalisation (qui équivaut à une imputation par la moyenne pondérée, cf. §3.1) est explicitement assumé et opérationnellement neutralisé par le plafond d'engagement.

---

### 2. ENTITÉ SIGNAL (§2.0) + signalId

L'intégration de la spécification complète de l'interface `Signal` (§2.0) et de la relation descendante `signalId` dans l'entité `OpportunityDossier` comble de manière exemplaire le vide structurel majeur de la v1.

- Le shape minimal (`id`, `type`, `value` comme prior /10 de triage, `confidence`, `status`, `sourceRefs`, `detectedAt`, `bylaw` et `zone`) est propre et complet.
- La structure 1→N est désormais formellement ancrée dans le socle partagé des états.
- **Verdict :** Ce shape minimal est **pleinement suffisant** pour que l'évolution ÉV2 (Radar T1) puisse s'appuyer dessus sans imposer de refactorisations ou de migrations de données lourdes ultérieures.

---

### 3. MODE RÉEL/SIMULATION (§2.7)

L'ajout du discriminant `mode: "real" | "simulation"` sur les deux entités majeures du système, `OpportunityDossier` et `JournalEntry` (§2.7), résout entièrement le risque de pollution du journal réel par les actions ou scénarios simulés.

- Le partitionnement logique au niveau des requêtes, du journal et des exports garantit une isolation hermétique.
- Le lien est renforcé au niveau de la provenance par donnée brute via l'enum de vérification `simulé` (§2.6), agissant en parfait complément.
- **Verdict :** **Robuste et fonctionnel.** La traçabilité opérationnelle et l'auditabilité en production sont garanties.

---

### 4. ROBUSTESSE aggregate() (§3.4)

Le pseudo-code TypeScript révisé de la fonction `aggregate()` (§3.4) fait preuve d'une robustesse technique remarquable et élimine tous les bugs latents de la v1 :

- **Division par zéro & Plancher :** L'évaluation immédiate `wSum < WEIGHT_FLOOR` (WEIGHT_FLOOR=0.50) protège à 100 % contre la division par zéro dans les cas de dossiers vides ou trop pauvres en données, tout en câblant proprement le comportement `tooThin: true` (qui force le statut à `surveiller`).
- **Assertion d'invariant :** La boucle de vérification initiale `(availability === "available") === (level !== null)` assure qu'aucun axe incohérent (comme un niveau valorisé avec une disponibilité fictive ou inversement) ne puisse pénaliser silencieusement le score ou contourner le garde-fou du cap de recommandation.
- **Vigilance d'implémentation :** Pour le polissage final du code de production, il conviendra d'ajouter explicitement une garde vérifiant que `a.level >= 0 && a.level <= 5` au sein de la boucle d'invariant pour se prémunir d'éventuels dépassements de grilles.

---

### 5. RÉGRESSION

L'analyse minutieuse de la v2 démontre qu'**aucune régression** n'a été introduite. Les écarts et compléments par rapport à la v1 sont tous extrêmement positifs :

- L'imputation par la moyenne due à la renormalisation est assumée de façon transparente (§3.1), restaurant l'honnêteté scientifique des chiffres affichés (qui augmentent dans 2 cas sur 3 de la calibration).
- Le sur-périmètre du cap (`qualifier-avec-expert` au lieu de `surveillance`) est un écart par rapport au document parent (`SPEC_EVOL_PROCESS_E2E.md` §4.4) mais il est intelligent (permet d'initier la levée du gap de données par un expert) et pleinement assumé comme une supersession explicite (§3.4).
- L'enrichissement de l'enum `Verification` avec `simulé` (§2.6) est cohérent et bien répertorié dans la section migration.
- La complétion de la grille Marché 0-5 au §3.3 élimine la grossièreté de la v1.

---

### 6. RECALCUL

L'arithmétique du tableau de calibration (§5) a été recalculée et est d'une exactitude absolue :

- Poids renormalisés sur 4 axes (Marché non disponible) : `potentiel` (0.353) / `risque` (0.235) / `timing` (0.235) / `faisabilité` (0.176) [somme des poids disponibles = 0.85].
- **H-609-4 :**
  $$\text{Score} = \frac{4 \times 0.30 + 3 \times 0.20 + 3 \times 0.20 + 2 \times 0.15}{0.85} = \frac{2.70}{0.85} \approx 3.1764 \rightarrow \mathbf{3.18}$$ *(Exact)*
- **U-521 → H-521 :**
  $$\text{Score} = \frac{4 \times 0.30 + 2 \times 0.20 + 4 \times 0.20 + 3 \times 0.15}{0.85} = \frac{2.85}{0.85} \approx 3.3529 \rightarrow \mathbf{3.35}$$ *(Exact)*
- **H-143 / H-143-1 :**
  $$\text{Score} = \frac{3 \times 0.30 + 1 \times 0.20 + 4 \times 0.20 + 2 \times 0.15}{0.85} = \frac{2.20}{0.85} \approx 2.5882 \rightarrow \mathbf{2.59}$$ *(Exact)*

Le calcul naïf 5-axes (avec Marché à 3) donnant respectivement 3.15, 3.30 et 2.65 est également confirmé et correspond parfaitement aux fixtures existantes de `valleyfield-dossiers.ts` (l.293/569/835).

---

### 7. BLOQUANT RÉSIDUEL

**Aucun bloquant résiduel** majeur n'a été détecté. La spécification ÉV1 v2 est mature, complète et prête pour l'étape de développement (writing-plans).

**Points d'attention/nettoyages mineurs lors du codage :**
1. **Validation des limites :** Assurer dans le code de production d'agrégation la validation stricte des bornes du score d'axe (`level >= 0 && level <= 5`).
2. **Couplage Zod :** Veiller à ce que le schéma Zod enrichi pour `AxisScore` force de manière stricte l'équivalence `available ⇔ level !== null` lors de la validation des données d'opportunités entrantes.

---

### VERDICT FINAL : **GO**

La révision v2 de la spécification résout avec brio, clarté et élégance l'intégralité des failles conceptuelles et techniques qui avaient motivé le double NO-GO de la version précédente. Les fondations géospatiales de la disponibilité sont désormais inattaquables, l'entité Signal est proprement ancrée pour les évolutions futures, et l'implémentation de l'agrégateur est parfaitement blindée. Le feu vert est accordé pour l'implémentation.
