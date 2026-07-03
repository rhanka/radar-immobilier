# WPA -> geo — inventaire

## Track frontA-data
  - A.2.1 Liste des villes + perimetre (rayon MTL extensible QC) via CiblagePlan [DONE, done, unknown]
  - A.2.2 Scraper procès-verbaux GENERIQUE (avis de motion + changement de zonage + n. reglement a suivre) [DONE, done, unknown]
  - A.2.3 YouTube seances: download + transcrit (Voxtral si besoin) + graphify [DONE, done, unknown]
  - Source conseils-municipaux (PV) — automation=refresh [DONE, done, unknown]
  - Source avis-publics — automation=refresh [DONE, done, unknown]
  - Source youtube-seances — automation=refresh [DONE, done, unknown]
  - WP A.2 — Data: identification progressive 'easy first' + 4 agents remote [TO-DO, in-progress, unknown]
  - A.2.4 Todo permanente + 4 agents background via remote (download/Obscura) + MAJ track [TO-DO, to-do, unknown]
  - A.2.5 Captcha->Obscura pour identification proprietaire de lot (secondaire, rate-limite, role foncier public) [TO-DO, to-do, unknown]
  - Source zonage (PDF/GeoJSON) — automation=one_shot [TO-DO, to-do, unknown]
  - Source role-evaluation (Donnees Quebec) — automation=one_shot [TO-DO, to-do, unknown]
  - P4 Data quality view — per-city PV YouTube ontology zones lots [TO-DO, in-progress, unknown]

## Occurrences sources geo/data
docs/spec/SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md:1:# SPEC_INTENT — Modélisation des données : zonage, lots, désignation dans le temps, valuation
docs/spec/SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md:9:`signal`, `scoring`) est centré **dossier/signal**. Le zonage et les lots y sont encastrés de façon
docs/spec/SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md:12:1. suivre l'**évolution temporelle** des zonages et des lots (un zonage change de code/usage/densité
docs/spec/SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md:36:- Modéliser comment un **zonage** et un **lot** et leur **désignation** sont faits/refaits au fil du
docs/spec/SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md:55:- **Mapping vers le scoring** (potentiel/marché) + signaux (un rezonage = `DesignationEvent` de type
docs/spec/cadrage-extraction-zones-pdf.md:1:# Cadrage — Ré-extraction des ZONES de zonage depuis les PDF municipaux → GeoJSON
docs/spec/cadrage-extraction-zones-pdf.md:5:> **Objectif** : prouver et chiffrer un pipeline qui transforme les plans/grilles de zonage
docs/spec/cadrage-extraction-zones-pdf.md:7:> collections `qc-zonage-<ville>` (polygones géoréférencés WGS84), pour débloquer la longue-traîne.
docs/spec/cadrage-extraction-zones-pdf.md:8:> **Loi 25** : zonage = donnée publique, zéro PII (les PDF traités ne contiennent aucune donnée personnelle).
docs/spec/cadrage-extraction-zones-pdf.md:17:- **Découverte structurante** : une part significative des plans de zonage QC ne sont **pas des
docs/spec/cadrage-extraction-zones-pdf.md:23:  (H-53) **calé sur le cadastre réel** → GeoJSON au format cible. Voir §6.
docs/spec/cadrage-extraction-zones-pdf.md:40:| **Zonage open-data ArcGIS** | `packages/radar-sources/src/geo/arcgis-zonage.ts` | Villes AVEC SIG ouvert (Longueuil, Sherbrooke, Shawinigan…). Hors scope ici (déjà couvert). |
docs/spec/cadrage-extraction-zones-pdf.md:41:| **Zonage open-data CKAN** | `packages/radar-sources/src/geo/ckan-zonage.ts` | 8 villes Données Québec. Hors scope. |
docs/spec/cadrage-extraction-zones-pdf.md:43:| **Inventaire géo par ville** | `packages/radar-sources/src/geo/geo-source-inventory.data.ts` | Statut zonage/lots par ville (`availability`, `quality`). |
docs/spec/cadrage-extraction-zones-pdf.md:44:| **Ingestion OGC + PostGIS** | `api/src/services/geo/ogc-pull.ts`, `api/src/db/schema.ts` | Format cible : collections `qc-zonage-<ville>`, table `zone_versions` (`code_norm`, `code_affiche`, `kind`, `geom` en `geometry(Geometry,4326)`), bitemporel. |
docs/spec/cadrage-extraction-zones-pdf.md:45:| **Spikes antérieurs** | `.../_spikes/zonage-plans-grilles-valleyfield/README.md`, `.../_spikes/contraintes-geo-valleyfield.md` | Ont conclu « bloqué : plans = images scannées, vectorisation manuelle requise ». **Ce cadrage lève partiellement ce verdict** (cf. §2 : tous les plans ne sont pas des scans). |
docs/spec/cadrage-extraction-zones-pdf.md:50:  le zonage a été **numérisé en amont** (déjà vectoriel) ; pour **Sainte-Catherine**, les
docs/spec/cadrage-extraction-zones-pdf.md:52:  des **plans de zonage PDF + grilles par préfixe H/C/I/M/P**, puis exportées en GeoJSON
docs/spec/cadrage-extraction-zones-pdf.md:55:  au format des collections `qc-zonage-<ville>`.
docs/spec/cadrage-extraction-zones-pdf.md:60:// FeatureCollection -> collection qc-zonage-saint-amable -> table zone_versions
docs/spec/cadrage-extraction-zones-pdf.md:75:## 2. Typologie des PDF de zonage québécois
docs/spec/cadrage-extraction-zones-pdf.md:83:1. **Plan de zonage** (carte) : polygones de zones + codes au centroïde. → porte la **géométrie**.
docs/spec/cadrage-extraction-zones-pdf.md:84:2. **Grille de zonage** (tableau usages × zones) : 1 grille par zone ou par préfixe, lignes =
docs/spec/cadrage-extraction-zones-pdf.md:110:PDF de zonage municipal
docs/spec/cadrage-extraction-zones-pdf.md:123:   FeatureCollection → collection qc-zonage-<ville> → ogc-pull → zone_versions
docs/spec/cadrage-extraction-zones-pdf.md:250:| L0 | Inventaire : tirer les PDF de zonage des 27 villes, classer T1/T2/T3/T4 (script de détection) | 1–2 j |
docs/spec/cadrage-extraction-zones-pdf.md:255:| L5 | Sortie `qc-zonage-<ville>` + ingestion `ogc-pull` + QA/validation par ville | 2–3 j |
docs/spec/cadrage-extraction-zones-pdf.md:262:> - **~60 % des villes** : zonage géoréférencé **quasi-automatique** (revue ≤ 30 min).
docs/spec/cadrage-extraction-zones-pdf.md:274:**Objectif** : prouver l'extraction sur 1 ville facile (PDF vectoriel/géoréf) → 1 zone GeoJSON
docs/spec/cadrage-extraction-zones-pdf.md:282:   gdalinfo sta-plan-zonage.pdf → Driver: PDF/Geospatial PDF ; GeoTransform présent
docs/spec/cadrage-extraction-zones-pdf.md:331:- Script `detect-zonage-pdf` : pour chaque ville des 27, tirer le(s) PDF de zonage (URL connue ou
docs/spec/cadrage-extraction-zones-pdf.md:350:  revue/correction humaine, avec export GeoJSON versionné.
docs/spec/cadrage-extraction-zones-pdf.md:353:- Émettre `qc-zonage-<ville>` ; ingérer via `ogc-pull` (`zone_versions`, bitemporel) ;
docs/spec/cadrage-extraction-zones-pdf.md:388:  1 polygone de zone (H-53) au format `qc-zonage-<ville>`, calé sur le cadastre réel. Limite
docs/spec/track-report-tableau-2026-06-26.md:19:| 1 | WP B — Vertical profond geo (zone->lot), villes prioritaires opportunites<6mois x lots GeoJSON | done | unknown | 1.8 |
docs/spec/track-report-tableau-2026-06-26.md:21:| 3 | CS-L2 — Fiche lot complète (Évaluation): cadastre + rôle MAMH + zone + grille PDF + Google Maps + notes | to-do | unknown |  |
docs/spec/track-report-tableau-2026-06-26.md:51:| 16 | Provincial graph — partition par MRC quand N villes ingérées (différé) | done | unknown |  |
docs/spec/track-report-tableau-2026-06-26.md:53:| 18 | WP4 source #3 — rôle d'évaluation MAMH SourceAdapter (collect->exploitation) | done | stale |  |
docs/spec/track-report-tableau-2026-06-26.md:54:| 19 | WP4 source #4 — Adresses Québec adapter + mentions Adresse | done | stale |  |
docs/spec/track-report-tableau-2026-06-26.md:66:| 31 | Réorientation « Grand filet » — radar changement de zonage, carte-first, multi-villes | done | unknown |  |
docs/spec/track-report-tableau-2026-06-26.md:67:| 32 | A.1.1 Vue Signaux (maille Quebec/villes) — nb opportunites/ville sur 6 mois, clic ville -> liste changements de zonage | done | unknown |  |
docs/spec/track-report-tableau-2026-06-26.md:69:| 34 | A.1.3 Vue Evaluation (maille zone/lots) — qualifier lots selon grilles de zonage | done | unknown |  |
docs/spec/track-report-tableau-2026-06-26.md:70:| 35 | A.1.4 Vue Sources (maille Quebec, maturite recueil) — villes GeoJSON coloriees par maturite; clic -> liste donnees recueillies (site, PV scrappes/graphifies, avis, YouTube transcrits/graphifies, zonages/ilots/proprietaires PDF\|GeoJSON, statut) | done | unknown |  |
docs/spec/track-report-tableau-2026-06-26.md:72:| 37 | A.2.2 Scraper procès-verbaux GENERIQUE (avis de motion + changement de zonage + n. reglement a suivre) | done | unknown |  |
docs/spec/track-report-tableau-2026-06-26.md:113:| 5 | Source zonage (PDF/GeoJSON) — automation=one_shot | to-do | unknown |  |
docs/spec/track-report-tableau-2026-06-26.md:114:| 6 | Source role-evaluation (Donnees Quebec) — automation=one_shot | to-do | unknown |  |
docs/spec/track-report-tableau-2026-06-26.md:121:| 13 | CS-P2 — Compléments P2: annonces en vente, lookup code postal, éditeur zonage manuel, mobile, dashboard couverture | to-do | unknown |  |
docs/spec/track-report-tableau-2026-06-26.md:123:| 15 | CS-P2-S13 — Lookup code postal (Adresses Québec/IGO A7 + geocoder.ca fallback, cache) | to-do | unknown |  |
docs/spec/brainstorm-industrialisation-refresh-data.md:164:│  • geo (local) : lots cadastraux ArcGIS MRNF, inventaire zonage               │
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_v3_review-opus.md:32:**Le point qui casse le modèle.** OPERATING_MODEL §1/§5 pose « agents absorbent le volume, l'humain n'est qu'un recours rare → coût marginal ». Mais ton propre socle dit le contraire : les axes décisifs sont **structurellement non-disponibles sans étape humaine/payante** — propriétaire caviardé LFM 72 (DATA_MODEL §2.2), comparables marché Tier C (§2.3), polygones de zonage absents → zone = hypothèse (§1.3), registre foncier à 1,50 $/doc. PROCESS §5 l'assume : « garder une étape humaine pour les décisions lourdes ». Donc l'étape humaine/experte n'est **pas un edge case rare** : elle est sur le **chemin critique de quasiment chaque opportunité qualifiée**. La courbe de coût marginal n'est pas plate — chaque dossier sérieux déclenche une escalade coûteuse récurrente. La thèse économique est à réécrire honnêtement.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_v3_review-opus.md:46:**Friction n°1 — explosion combinatoire.** « 1 signal → N opportunités » (§3) = des centaines de lots pour un rezonage. Si chaque dossier voit ses décisions devenir des artefacts **signés**, le volume d'enveloppes explose avec N (malgré les pré-filtres). Règle à poser : **signer les décisions, jamais chaque item de donnée**.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_v3_review-agy.md:46:    Faire interagir un client final directement avec des agents autonomes (Tier 0) pour interpréter des changements de zonage comporte un risque financier et opérationnel énorme. L'analyse urbanistique au Québec est complexe, locale et sujette à interprétation juridique. Si un agent autonome donne une mauvaise interprétation d'une grille de zonage à cause d'une hallucination ou d'une donnée d'entrée erronée, la responsabilité civile et professionnelle de la plateforme est engagée.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_v3_review-agy.md:94:    B --> C["3. Résoudre le gap de zonage (Valleyfield GIS)"]
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_v3_review-agy.md:104:    Rediriger l'effort de développement. Au lieu de passer du temps sur la surcouche h2a en V1, investir 2 jours de travail pour vectoriser manuellement les PDF de zonage (Feuillets 1 & 2) de Valleyfield. Sans polygones de zonage réels, aucune signature cryptographique ne donnera de valeur commerciale à la démo.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_review-opus.md:16:- **L'axe Valeur marché (15 %, §4.3) est aujourd'hui non-scorables** : transactions, vacance, absorption, comparables sont tous Tier C / non-disponibles pour Valleyfield (DATA_MODEL §2.3 : JLR/Centris payants, permis absents de Données Québec). 15 % du score repose sur de la donnée que l'investigation a prouvée indisponible.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_review-opus.md:17:- **L'axe Risque (20 %) dépend d'intersections géospatiales bloquées** : DATA_MODEL §1.3 — pas de polygones de zonage en open-data, l'intersection CPTAQ « blocked by missing zone H polygons ». Donc « bloquant inondable/CPTAQ » (niveau 1) n'est en pratique pas calculable aujourd'hui.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_review-opus.md:40:- **Agrégation multi-signaux** sur un même dossier (un règlement = zonage + densité + hauteur) : max ? additif ? Non dit.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_review-opus.md:54:- **Les 6 phases PROCESS sont diluées.** Le modèle T0–T4 (§2) réorganise par écran/cadence, pas par les 6 phases (signal, ancrage, contraintes, marché, **contexte stratégique**, scoring). Où est « Contexte stratégique » (PROCESS phase 5 : StatCan/transport/MRC, catalyseurs) dans T0–T4 ? Implicite en T2, jamais nommé. Un mapping T↔phases manque.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_review-opus.md:70:- **Multiplier type × confiance écrase deux dimensions** (valeur stratégique vs certitude de détection). Un zonage 10 détecté à 0,5 = un PPCMOI 7 à 0,7 ≈ 5 : pour le triage T1, on **enterre** justement les signaux « haute valeur mais incertaine » qu'on voudrait remonter à l'humain. ➜ **Afficher valeur ET confiance séparément**, ne pas multiplier.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_review-opus.md:77:- **Risque (20 %, inversé)** : grille la plus propre. Deux corrections : (1) **désambiguïser CPTAQ** — *zone agricole protégée sans demande* = bloquant ; *demande/décision de dézonage en cours* = signal positif, risque moindre ; (2) ajouter un niveau/règle **« indéterminé / non-intersecté »** qui **ne défausse PAS vers 5** (sinon « inconnu » = « sûr », dangereux). Repasse à l'échelle **0–5** : 0 = bloquant absolu.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_v4_review-agy.md:40:    *   *Justification* : Résolution élégante du risque d'explosion combinatoire. Au lieu de forcer une signature cryptographique sur chaque lot extrait d'un rezonage massif (qui aurait saturé la SPA), le système ne signera cryptographiquement (lorsque la crypto sera activée) que les jalons de décision d'affaires lourds (qualification finale, go/no-go).
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_v4_review-agy.md:50:3.  **Traitement lucide des données manquantes :** L'introduction de `confirmed: boolean` sur les lots (§3) et l'aveu pragmatique du gap géospatial de Valleyfield (les grilles de zonage n'étant disponibles qu'en PDF matriciels) prouvent que la v4 fait face aux contraintes du terrain. Dire honnêtement que les opportunités initiales seront étiquetées `"hypothese-street-name"` et plafonnées à `"surveillance"` respecte scrupuleusement la charte éthique anti-triche du projet.
docs/spec/reviews/SPEC_EVOL_SOCLE_STATES_SCORING_review-opus.md:20:**(b) Le biais d'exclure tout l'axe marché est réel et incohérent avec le traitement du risque.** Le marché a des proxies **factuels** (MRC +22 %, vacance 0,1 %, Vivaxcès 284 u. — l.233/520) qui crient « marché tendu » (niveau 4-5 régional). On les jette en « contexte/confiance » et on impute marché ≈ 3.18 par renormalisation. **Or pour le risque, la spec fait l'inverse** : H-609-4 a BDZI=0 (fait) + GRHQ ras (fait) + CPTAQ A-939 *non confirmé* (hypothèse) → scoré **risque=3 available, confidence:low**. Même structure de preuve (du factuel macro + une pièce précise manquante), **deux traitements opposés** : risque = available/low-conf, marché = non-disponible/exclu. Cette asymétrie est exactement ce qui propulse les scores via renormalisation. **Préco : marché « available, confidence:low » niveau 3 (sur proxies macro) serait plus honnête que l'exclusion** — et utiliserait l'enveloppe de confiance (§3.5) construite pour ça. À défaut, justifier explicitement pourquoi le marché mérite l'exclusion binaire et pas le risque.
docs/spec/reviews/SPEC_EVOL_SOCLE_STATES_SCORING_review-codex-v2.md:5:La contradiction v1 est globalement levee. La v2 pose une regle testable: un axe est `available` si une preuve place un niveau au grain mesure par cet axe; sinon il est `non-disponible` (`docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md:268-273`). La distinction risque/marche est defensable: le risque a des faits au grain zone/bbox (BDZI/GRHQ) et une sous-piece CPTAQ hypothetique (`:275-281`), tandis que le marche n'a que des donnees regionales MRC/CMHC, explicitement insuffisantes pour placer un niveau zone (`:261-266`).
docs/spec/reviews/SPEC_EVOL_SOCLE_STATES_SCORING_review-agy-v2.md:12:- **Justification du Marché non disponible :** L'axe Marché mesure la tension transactionnelle *spécifique à la zone*. En l'absence de comparables de transactions locaux (Centris/JLR non disponibles, Tier C gap), utiliser les données de permis de la MRC ou la vacance de la SCHL (qui sont de grain macro-régional) équivaudrait à attribuer arbitrairement à la zone une note moyenne. Ce serait une fabrication/invention de donnée locale, contraire aux principes de la VISION et de l'anti-triche.
docs/spec/reviews/SPEC_EVOL_SOCLE_STATES_SCORING_review-agy.md:26:  Oui, la décision d'exclure l'axe Marché pour les 3 pilotes est **parfaitement cohérente et honnête**. Utiliser des proxies macro-économiques (comme la vacance de la SCHL à 0,1 % ou la hausse des permis de la MRC à 22 %) pour simuler un score local de marché spécifique à la zone serait une violation flagrante de la règle anti-triche (*anti-invention*). Les données réelles à l'échelle de la zone (comparables JLR/Centris) manquent cruellement (Tier C gap, cf. `valleyfield-dossiers.ts` ligne 248).
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_review-agy.md:15:*   **Modélisation amont/aval réaliste (§3)** : La distinction conceptuelle `1 signal (T1 - amont) → N opportunités (T2 - aval)` est tout à fait juste. Elle reflète parfaitement la réalité où un seul amendement de zonage (ex: règlement 150-49) s'applique à une ou plusieurs zones physiques comprenant des dizaines de lots cadastraux distincts.
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_review-agy.md:27:*   **Risque de saturation de la base de données par l'effet multiplicateur (§3)** : Si le passage de T1 à T2 s'effectue de manière purement automatique, un seul changement de zonage sur un grand boulevard ou une zone résidentielle élargie peut créer d'un coup plus de 200 fiches opportunités (lots individuels), saturant l'écran de l'utilisateur de "bruit" peu exploitable financièrement (petits lots, habitations récentes, etc.).
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_review-agy.md:58:*   **Le paradoxe de la notation de la CPTAQ (VISION §6 vs PROCESS §3)** : C'est le plus gros écart conceptuel constaté. La **VISION §6** identifie la CPTAQ (dézonage agricole) comme une opportunité majeure de priorité 1 (score 8/10), un excellent signal précoce de développement futur à long terme (1 à 10 ans). Cependant, le modèle de scoring du **PROCESS §3** intégré au §4.3 (Grille Risque de contrainte) classe la présence d'une zone CPTAQ active en niveau 1 ("bloquant"), ce qui détruit immédiatement le score global de l'opportunité. Le système se contredit en interne : il cherche d'un côté à lever des signaux de veille agricole (VISION), tout en disqualifiant immédiatement ces mêmes lots lors de la notation (PROCESS).
docs/spec/reviews/SPEC_EVOL_PROCESS_E2E_review-agy.md:68:    *   **Voie (b)** (Jobs + ETL stables) : **Excellente faisabilité**. L'utilisation des APIs CKAN et des flux de données structurés de Données Québec est robuste et peu coûteuse.
docs/spec/geo-detail-schema-mapping.md:17:  /** Identifiant unique — correspond à la valeur de `categoryKey` dans les props GeoJSON. */
docs/spec/geo-detail-schema-mapping.md:74://   - axis-badge--zonage : sky-100 (neutre)
docs/spec/geo-detail-schema-mapping.md:83:    id: "rezonage",
docs/spec/geo-detail-schema-mapping.md:84:    labelFr: "Rezonage",
docs/spec/geo-detail-schema-mapping.md:128:    id: "modification_zonage",
docs/spec/geo-detail-schema-mapping.md:129:    labelFr: "Modification de zonage",
docs/spec/geo-detail-schema-mapping.md:130:    color: "#3b82f6",   // blue-500 — variante réglementaire du rezonage
docs/spec/geo-detail-schema-mapping.md:240:// Niveaux : base (toujours visible) / dimension / anticipation / zonage
docs/spec/geo-detail-schema-mapping.md:248:    { id: "zonage",       labelFr: "Zonage" },
docs/spec/geo-detail-schema-mapping.md:252:    // Clé de prop GeoJSON    Label FR                  Kind        Niveau
docs/spec/geo-detail-schema-mapping.md:268:    // ── Niveau zonage ─────────────────────────────────────────────────────────
docs/spec/geo-detail-schema-mapping.md:269:    { key: "bylaw",           labelFr: "Règlement constitutif", kind: "text",     level: "zonage" },
docs/spec/geo-detail-schema-mapping.md:270:    { key: "url_grille",      labelFr: "Grille d'usage (PDF)",  kind: "pdf",      level: "zonage" },
docs/spec/geo-detail-schema-mapping.md:271:    { key: "source_ref",      labelFr: "Source PV",             kind: "citation", level: "zonage" },
docs/spec/geo-detail-schema-mapping.md:272:    { key: "source_url",      labelFr: "Lien document source",  kind: "url",      level: "zonage" },
docs/spec/geo-detail-schema-mapping.md:273:    { key: "geom_source",     labelFr: "Source géométrie",      kind: "text",     level: "zonage" },
docs/spec/geo-detail-schema-mapping.md:274:    { key: "geom_fetched_at", labelFr: "Géométrie mise à jour", kind: "date",     level: "zonage" },
docs/spec/geo-detail-schema-mapping.md:287:    { id: "zonage", labelFr: "Zonage" },
docs/spec/geo-detail-schema-mapping.md:294:    { key: "zone_code",       labelFr: "Zone affectée",         kind: "text",  level: "zonage" },
docs/spec/geo-detail-schema-mapping.md:295:    { key: "signal_count",    labelFr: "Signaux attachés",      kind: "number",level: "zonage" },
docs/spec/geo-detail-schema-mapping.md:296:    { key: "geom_source",     labelFr: "Source géométrie",      kind: "text",  level: "zonage" },
docs/spec/geo-detail-schema-mapping.md:297:    { key: "geom_fetched_at", labelFr: "Géométrie mise à jour", kind: "date",  level: "zonage" },
docs/spec/geo-detail-schema-mapping.md:349:| `rezonage` | `rezonage` | `rezonage` |
docs/spec/geo-detail-schema-mapping.md:358:| `modification_zonage` | `modification_zonage` | `modification_zonage` |
docs/spec/SPEC_EVOL_DATA_MODEL.md:26:municipality that files with MAMH (all 1 100+ do).
docs/spec/SPEC_EVOL_DATA_MODEL.md:32:| `zone` (H-609-4, U-521, …) | Règlement de zonage municipal (PDF grilles, feuillets) | Not in rôle XML; must be inferred by spatial intersection with municipal zoning polygons — which are NOT published in open-data vector format for Salaberry-de-Valleyfield (feuillets are scanned PDF images) |
docs/spec/SPEC_EVOL_DATA_MODEL.md:35:| Usage autorisé après rezonage | Grille H-521 (règl. 150-51), grille H-609-4 (règl. 150-49) | Not yet published at investigation date (2026-05-25); stated non-disponible |
docs/spec/SPEC_EVOL_DATA_MODEL.md:42:Québec does not list a municipal zoning GeoJSON/WFS for this municipality.
docs/spec/SPEC_EVOL_DATA_MODEL.md:95:| Permis de construction par zone (Valleyfield) | Not on Données Québec (Laval only) | Requires direct request to Ville or MAMH |
docs/spec/SPEC_EVOL_DATA_MODEL.md:128:| Permis de construction (Valleyfield-specific) | Not on Données Québec | Only Laval publishes this dataset; Valleyfield data requires direct municipal request |
docs/spec/cadrage-zones-lots-acquisition.md:1:# Cadrage — Acquisition des données intra-ville : ZONES (zonage) + LOTS (cadastre)
docs/spec/cadrage-zones-lots-acquisition.md:9:> **Loi 25** : zonage + cadastre = **données publiques**, jamais de PII. Le rôle d'évaluation
docs/spec/cadrage-zones-lots-acquisition.md:10:> ouvert (MAMH) est **caviardé** (ni nom de propriétaire, ni adresse, ni n° de lot) → la
docs/spec/cadrage-zones-lots-acquisition.md:20:   (4,64 M lots, polygone + `NO_LOT`, GeoJSON, gratuit). Effort : **1–2 j-h**. → **`geo`**.
docs/spec/cadrage-zones-lots-acquisition.md:23:   zonage** packagés en open data sur Données Québec. **~600–800 petites villes** n'ont que des
docs/spec/cadrage-zones-lots-acquisition.md:27:   CKAN Données Québec. JMap au cas par cas. GOnet/PG et PDF en dernier (rendement faible).
docs/spec/cadrage-zones-lots-acquisition.md:29:   (cadastre allégé, scrapers de plateformes zonage, registre municipalités, contraintes). **`immo`
docs/spec/cadrage-zones-lots-acquisition.md:32:5. **Séquencement** : (S1) lots province + CKAN zonage → couverture immédiate ~15 villes zonage +
docs/spec/cadrage-zones-lots-acquisition.md:33:   1104 villes lots ; (S2) crawler ArcGIS générique → +150–250 villes zonage ; (S3) recensement
docs/spec/cadrage-zones-lots-acquisition.md:49:`zonage{availability,quality,url}`, `lots{…}`, `notes`) + données seed pour 6 villes pilotes dans
docs/spec/cadrage-zones-lots-acquisition.md:57:| **Cadastre allégé** (REST MELCC/MRNF) | **1104/1104 villes** (couche unique province-entière) | ArcGIS REST `query` → GeoJSON/JSON/PBF ; polygone + `NO_LOT` | © Gouv. QC, **accès public** (pas CC-BY estampillé), attribution | **Vérifié** : 4 642 815 lots (`where=1=1&returnCountOnly=true`), `maxRecordCount=2000`, `supportsPagination=true`, WKID natif 3857 (`outSR=4326` OK) |
docs/spec/cadrage-zones-lots-acquisition.md:71:Contrairement aux lots, **il n'existe aucune couche zonage provinciale**. Le zonage est municipal,
docs/spec/cadrage-zones-lots-acquisition.md:77:| Zonage en **open data structuré** (Données Québec / hub Esri) | **~10–15** | GeoJSON/SHP/KML + EsriREST | **Oui, direct** |
docs/spec/cadrage-zones-lots-acquisition.md:78:| Carte web **ArcGIS REST** publique (sans dataset CKAN) | **~140–235** | `FeatureServer`/`MapServer` query → JSON/GeoJSON | **Oui** (crawler générique) |
docs/spec/cadrage-zones-lots-acquisition.md:80:| Visualiseur **GOnet/Azimut** (PG Solutions) | plusieurs centaines en évaluation, **zonage public minoritaire** | viewer propriétaire, souvent **login** | Difficile (auth + obscura) |
docs/spec/cadrage-zones-lots-acquisition.md:83:**Total « format ouvert exploitable » pour le zonage : estimé ~150–250 villes** (open data +
docs/spec/cadrage-zones-lots-acquisition.md:89:Comptages vérifiés (Données Québec, API CKAN, 2026-06-14) :
docs/spec/cadrage-zones-lots-acquisition.md:90:- `package_search?q=zonage&rows=0` → **`count: 50`** datasets (toutes organisations confondues).
docs/spec/cadrage-zones-lots-acquisition.md:91:- Organisations municipales avec zonage + géométrie téléchargeable observées : Longueuil,
docs/spec/cadrage-zones-lots-acquisition.md:93:  Rouyn-Noranda → **~10–15 villes** publient le zonage en open data structuré (presque toutes via
docs/spec/cadrage-zones-lots-acquisition.md:104:2. **Zonage open data (CKAN)** : pour chaque ville, requêter l'API CKAN Données Québec
docs/spec/cadrage-zones-lots-acquisition.md:105:   (`package_search?q=<nom_ville> zonage`, puis `package_show` pour résoudre les ressources et
docs/spec/cadrage-zones-lots-acquisition.md:106:   formats). Filtrer sur `format ∈ {GeoJSON, SHP, KML, EsriREST, GPKG}`. **Rejouable** : c'est une
docs/spec/cadrage-zones-lots-acquisition.md:109:   chaque ville (déductible du `slug`/`name` ou d'un annuaire MAMH des municipalités), sonder des
docs/spec/cadrage-zones-lots-acquisition.md:115:   - PDF : lien « plan de zonage » / « règlement d'urbanisme » pointant un `.pdf`.
docs/spec/cadrage-zones-lots-acquisition.md:122:> des sites web municipaux** (à dériver d'un dataset MAMH ou d'un crawl ciblé). Sans lui, le
docs/spec/cadrage-zones-lots-acquisition.md:132:MRC), **PG Solutions/Azimut** (GOnet — leader évaluation/matrice graphique, surtout petites
docs/spec/cadrage-zones-lots-acquisition.md:135:| # | Plateforme | Éditeur | ~Parc QC (zonage web public) | Format réel | Scrapabilité | Effort scraper |
docs/spec/cadrage-zones-lots-acquisition.md:138:| **T2** | **Données Québec CKAN** (open data packagé) | Gouv. QC + villes | **~10–15** | Téléchargement direct **GeoJSON/SHP/KML/GPKG** + parfois `EsriREST` | **Oui — direct.** API CKAN stable | **Faible** : 1 adapter CKAN (~1,5–2,5 j-h, déjà spike-é) |
docs/spec/cadrage-zones-lots-acquisition.md:140:| **T4** | **GOnet / Azimut** (matrice graphique) | Azimut → **PG Solutions** (Harris) | Centaines en évaluation, **zonage public minoritaire** | Viewer propriétaire, **souvent derrière login** côté citoyen ; export GML côté ville seulement | **Non / difficile** (« obscura » de fait : auth + viewer fermé) | **Élevé** : 8–15+ j, session authentifiée, fragile et risqué (ToS) |
docs/spec/cadrage-zones-lots-acquisition.md:144:carte de zonage → hors périmètre. **GeoCentralis** est un intégrateur Esri → retombe sur **T1**
docs/spec/cadrage-zones-lots-acquisition.md:159:| **P0** | **Crawler ArcGIS REST générique** (zonage) | T1 | **~150–250** | Élevée | **3–5 j-h** | détection `/rest/services` + `query?f=geojson` |
docs/spec/cadrage-zones-lots-acquisition.md:160:| **P1** | **Adapter CKAN Données Québec** (zonage) | T2 | **~10–15** (+ découverte) | Élevée | **1,5–2,5 j-h** | spike `donnees-quebec-catalog` |
docs/spec/cadrage-zones-lots-acquisition.md:169:- **Normalisation GeoJSON WGS84** (`outSR=4326`) en sortie.
docs/spec/cadrage-zones-lots-acquisition.md:198:| Détection de changement de zonage (avis de motion → n° règlement) | **`immo`** | Signal métier (« grand filet ») |
docs/spec/cadrage-zones-lots-acquisition.md:201:**Règle de découpage** : `geo` livre des **GeoJSON normalisés + provenance** (zones, lots,
docs/spec/cadrage-zones-lots-acquisition.md:213:- **Interface de livraison** : se mettre d'accord sur le **format de couche** (GeoJSON paginé vs
docs/spec/cadrage-zones-lots-acquisition.md:226:| **S1 — Socle ouvert** | Scraper **cadastre allégé** (lots, province) + adapter **CKAN** (zonage open data) | **1104 villes lots** + **~10–15 villes zonage** | **3–5 j-h** | aucune (spikes existants) |
docs/spec/cadrage-zones-lots-acquisition.md:227:| **S2 — Levier ArcGIS** | **Crawler ArcGIS REST générique** (zonage T1) | **+~150–250 villes zonage** | **3–5 j-h** | S1 (norme GeoJSON/provenance) |
docs/spec/cadrage-zones-lots-acquisition.md:233:**100 % des villes en lots** et **~170–290 villes en zonage** (open data + ArcGIS + JMap). Le reste
docs/spec/cadrage-zones-lots-acquisition.md:247:  totaux mondiaux mêlant évaluation/finance/loisirs, pas le zonage cartographié). Les répartitions
docs/spec/cadrage-zones-lots-acquisition.md:249:- **Query GeoJSON live non démontrée de bout en bout** sur tous les endpoints (certains `/query`
docs/spec/cadrage-zones-lots-acquisition.md:253:  zonage. À investiguer sur un déploiement réel avant tout chiffrage ferme.
docs/spec/cadrage-zones-lots-acquisition.md:259:  dataset MAMH ou d'un crawl ciblé. Risque sur la complétude du recensement tant qu'il manque.
docs/spec/cadrage-zones-lots-acquisition.md:273:- Réorientation « grand filet » (cadre stratégique zonage-centrique) :
docs/spec/cadrage-zones-lots-acquisition.md:276:- Spikes : `_spikes/cadastre-infolot`, `_spikes/zonage-municipal-open-data`,
docs/spec/SPEC_INTENT_SCAFFOLDING.md:10:Le projet `radar-immobilier` met en œuvre la vision décrite dans `docs/spec/input/VISION.md` (cahier de vision complet) et `docs/spec/input/PROCESS.md` (processus opérationnel) : un **radar immobilier IA** capable de surveiller automatiquement les documents municipaux d'une ville et d'identifier des opportunités de densification résidentielle (zonage, PPCMOI, dérogations, CPTAQ, etc.).
docs/spec/SPEC_INTENT_SCAFFOLDING.md:20:- **Sources municipales** (sites villes, PDF, vidéos YouTube de conseils, portails cartographiques, Données Québec, CPTAQ, etc.).
docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md:38:| 1. Signal réglementaire | assez concret pour ancrer ? | avis publics PDF (Tier A) ; zonage/grilles PDF + PV (Tier B OCR/LLM) ; **YouTube conseil** (transcription, §6) |
docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md:39:| 2. Ancrage foncier | lot réel/localisable ? | **rôle d'évaluation open-data** (XML/GeoJSON, donneesouvertes.affmunqc.net) ; **cadastre allégé** (NO_LOT) ; Adresses Québec — Tier A |
docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md:41:| 4. Marché | le marché soutient ? | **permis** Données Québec (Tier A) ; transactions/JLR/Centris = **Tier C → manque documenté** |
docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md:42:| 5. Contexte stratégique | asymétrie de timing ? | **StatCan** (démo/revenus) ; transport/MRC — Tier A/B |
docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md:49:  PDF, BDZI, GRHQ, CPTAQ cartes/décisions, permis, Adresses Québec, StatCan.
docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md:50:- **Tier B — tenté** (scraping/OCR/LLM) : zonage municipal + grilles PDF, PV
docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md:51:  conseils, schémas MRC, YouTube (transcription).
docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md:60:densification / hauteur / zonage / intentions politiques → **relier au dossier**
docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md:91:pour le fetch (Données Québec API, téléchargements géospatiaux, PDF, YouTube).
docs/spec/data-division-immo-geo.md:18:   génériques et réutilisables hors immo** (cadastre, zonage, contraintes, registre municipalités,
docs/spec/data-division-immo-geo.md:21:   (détection avis-motion→n° règlement→changement de zonage, ontologie temporelle zonage/lots,
docs/spec/data-division-immo-geo.md:25:   `api.geo.sent-tech.ca` (immo consomme, ne scrape plus) ; (b) **le registre municipalités**
docs/spec/data-division-immo-geo.md:28:   géo** (CPTAQ, BDZI, milieux humides) ; (e) **l'acquisition du rôle d'évaluation MAMH** et des
docs/spec/data-division-immo-geo.md:30:   géoréférencement de plans de zonage PDF** (geo le fait déjà mieux qu'immo).
docs/spec/data-division-immo-geo.md:32:   sémantique** avis-motion→règlement→zonage (cœur produit) ; (b) le **scraping des PV / séances**
docs/spec/data-division-immo-geo.md:40:   récupéré par l'infra immo) et la **géoréf** si un plan de zonage est joint. Argument en §4.
docs/spec/data-division-immo-geo.md:49:été **supprimés**) ; `immo` consomme l'API OGC `api.geo.sent-tech.ca`.
docs/spec/data-division-immo-geo.md:55:| c | **Registre des villes** (`municipalities.qc.json`, 1106) | `radar-sources/geo/municipalities.qc.json` + loader `municipalities.ts` ; génération `radar/data-prep/fetch-municipal-polygons.ts` (GeoNames + MAMH + haversine) | Actif (statique régénérable) |
docs/spec/data-division-immo-geo.md:57:| e | **Rôle d'évaluation MAMH / Données Québec** | `radar-sources` (`role-evaluation-mamh.ts` + parser RLUEx) + `api` (registre) | Actif |
docs/spec/data-division-immo-geo.md:58:| f | **Adresses Québec** (terrAPI) | `radar-sources` (`adresses-quebec.ts` + parser) + `api` (registre) | Actif |
docs/spec/data-division-immo-geo.md:64:- **Harvester OGC/cadastre industrialisé** : API OGC `api.geo.sent-tech.ca`, collections
docs/spec/data-division-immo-geo.md:65:  `qc-lots-<slug>` / `qc-zonage-<slug>`, GeoJSON→PostGIS. `crawlQcCadastreLots` (4,6 M lots QC),
docs/spec/data-division-immo-geo.md:66:  `acquireCkanGeoJson` (11 manifestes CKAN zonage confirmés). **C'est la partie stable consommée
docs/spec/data-division-immo-geo.md:69:  zonage AutoCAD/PDF (mutool/OCG layers), géoréf par intersections de rues OSM (RANSAC/ICP), avec
docs/spec/data-division-immo-geo.md:87:| a' | **Détection sémantique** avis-motion→règlement→zonage | immo | **immo** | immo | immo | — | geo | LA valeur produit immo. Strictement métier, anti-invention. Indélégable. |
docs/spec/data-division-immo-geo.md:89:| c | Registre municipalités (slug, mrc, lat/lon, pop, distance) | immo (`radar-sources`) | **geo** | geo | geo | immo | — | Donnée géo pure (MRC/coordonnées/population). `geo` = source de vérité ; immo consomme. Seuls `priorityRank`/`excluded`/`deprioritized` restent une **vue immo** (overlay métier). |
docs/spec/data-division-immo-geo.md:96:| h | Rôle d'évaluation MAMH (acquisition open-data) | immo (adapter) | **geo** (acquisition) / **immo** (sémantique) | geo | geo | immo | — | Acquisition = open-data CKAN/MAMH générique, géoréférencé (NO_LOT), réutilisable hors immo → délègue. **Mais la jointure rôle↔lot + enrichissement valeur/usage = immo** (scoring). |
docs/spec/data-division-immo-geo.md:97:| i | Adresses Québec (acquisition terrAPI) | immo (adapter) | **geo** | geo | geo | immo | — | Couche d'adresses provinciale géoréférencée, générique. Aucune sémantique immo dans l'acquisition. |
docs/spec/data-division-immo-geo.md:98:| j | **OCR / géoréf de plans de zonage PDF** | immo (`pdf-ocr` stub) + geo (atelier) | **geo** | geo | geo | immo | — | `geo` le fait DÉJÀ (vision/RANSAC/ICP) mieux qu'immo. Le stub `pdf-ocr.ts` immo n'est même pas câblé. Délègue. |
docs/spec/data-division-immo-geo.md:105:  cadastre, zonage, contraintes, registre municipalités, inventaire/recensement, rôle (acquisition),
docs/spec/data-division-immo-geo.md:115:- **Format** : `geo` livre des **GeoJSON normalisés + provenance** via l'**API OGC**
docs/spec/data-division-immo-geo.md:116:  `api.geo.sent-tech.ca` (collections `qc-lots-<slug>` / `qc-zonage-<slug>`), pagination
docs/spec/data-division-immo-geo.md:119:  cf. caveat « 2 181 127 »). Côté zonage : `code_affiche`. La normalisation/jointure temporelle
docs/spec/data-division-immo-geo.md:150:- **La géoréf d'un plan de zonage** si un règlement joint un plan PDF (flux j) : déléguée à geo.
docs/spec/data-division-immo-geo.md:163:2. **Rôle d'évaluation MAMH + adresses Québec** : `geo` accepte-t-il d'**absorber l'acquisition**
docs/spec/data-division-immo-geo.md:164:   (open-data CKAN/MAMH/terrAPI, géoréférencé) et de les exposer en couches normalisées ? La
docs/spec/data-division-immo-geo.md:199:sens. Tu owne déjà lots+zones+cadastre (API OGC api.geo.sent-tech.ca, on consomme via ogc-pull,
docs/spec/data-division-immo-geo.md:205:  2. Acquisition du rôle d'évaluation MAMH + des adresses Québec (open-data CKAN/MAMH/terrAPI,
docs/spec/data-division-immo-geo.md:210:  5. L'OCR / géoréférencement de plans de zonage PDF — tu le fais déjà (vision/RANSAC/ICP) mieux
docs/spec/data-division-immo-geo.md:215:  - La détection sémantique avis-motion → n° règlement → changement de zonage (notre cœur produit).
docs/spec/data-division-immo-geo.md:229:  - GeoJSON normalisé + provenance via API OGC (déjà en place). Clé NO_LOT verbatim + no_lot_norm.
docs/spec/data-division-immo-geo.md:236:  Q2. Tu absorbes l'acquisition rôle MAMH + adresses Québec ? (jointure reste chez nous)
docs/spec/cadrage-geo-integration-mapper.md:61:  zonage est disponible (ArcGIS + CKAN, ~15–250 villes selon l'avancement de l'acquisition géo).
docs/spec/cadrage-geo-integration-mapper.md:64:- **Pour les villes sans couche zonage vectorielle** (~850 villes) : résolution zone = 0 % par
docs/spec/cadrage-geo-integration-mapper.md:269:- `data?: FeatureCollection` — GeoJSON WGS84.
docs/spec/cadrage-geo-integration-mapper.md:358:  { id: "rezonage",              labelFr: "Rezonage",                  color: "#6366f1" }, // indigo-500
docs/spec/cadrage-geo-integration-mapper.md:367:  { id: "modification_zonage",   labelFr: "Modification de zonage",    color: "#3b82f6" }, // blue-500
docs/spec/cadrage-geo-integration-mapper.md:386:- **Rezonage** (indigo-500) : couleur principale, la plus fréquente, non ambigu.
docs/spec/cadrage-geo-integration-mapper.md:412:    { id: "zonage",       labelFr: "Zonage" },
docs/spec/cadrage-geo-integration-mapper.md:428:    // ── Niveau zonage ─────────────────────────────────────────────────────
docs/spec/cadrage-geo-integration-mapper.md:429:    { key: "bylaw",           labelFr: "Règlement constitutif", kind: "text",     level: "zonage" },
docs/spec/cadrage-geo-integration-mapper.md:430:    { key: "url_grille",      labelFr: "Grille d'usage (PDF)",  kind: "pdf",      level: "zonage" },
docs/spec/cadrage-geo-integration-mapper.md:431:    { key: "source_ref",      labelFr: "Source PV",             kind: "citation", level: "zonage" },
docs/spec/cadrage-geo-integration-mapper.md:432:    { key: "source_url",      labelFr: "Lien document source",  kind: "url",      level: "zonage" },
docs/spec/cadrage-geo-integration-mapper.md:433:    { key: "geom_source",     labelFr: "Source géométrie",      kind: "text",     level: "zonage" },
docs/spec/cadrage-geo-integration-mapper.md:434:    { key: "geom_fetched_at", labelFr: "Géométrie mise à jour", kind: "date",     level: "zonage" },
docs/spec/cadrage-geo-integration-mapper.md:443:    { id: "zonage", labelFr: "Zonage" },
docs/spec/cadrage-geo-integration-mapper.md:450:    { key: "zone_code",       labelFr: "Zone affectée",         kind: "text",  level: "zonage" },
docs/spec/cadrage-geo-integration-mapper.md:451:    { key: "signal_count",    labelFr: "Signaux attachés",      kind: "number",level: "zonage" },
docs/spec/cadrage-geo-integration-mapper.md:452:    { key: "geom_source",     labelFr: "Source géométrie",      kind: "text",  level: "zonage" },
docs/spec/cadrage-geo-integration-mapper.md:453:    { key: "geom_fetched_at", labelFr: "Géométrie mise à jour", kind: "date",  level: "zonage" },
docs/spec/cadrage-geo-integration-mapper.md:465:| **G2** — Peuplement PostGIS | Pipeline import `zones.geom` depuis arcgis-zonage/ckan-zonage → PostGIS. Import `lots.geom` depuis cadastre-allege. | G1 + adapters P0/P1 livrés (déjà faits) | **2–4 j-h** | Commandes import + index GiST |
docs/spec/cadrage-geo-integration-mapper.md:498:  - `packages/radar-sources/src/geo/arcgis-zonage.ts` (P0-B — crawler ArcGIS REST générique)
docs/spec/cadrage-geo-integration-mapper.md:499:  - `packages/radar-sources/src/geo/ckan-zonage.ts` (P1-A — Données Québec CKAN)
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:43:| **Signaux** | `ui/src/lib/components/maps/SignauxMapView.svelte` | `GET /api/signals/by-city`, `GET /api/signals/:city/detail` | Québec / villes | nb d'opportunités (changements de zonage) / ville sur 6 mois ; clic ville → liste des `DesignationEvent` |
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:68:#### S-1. Carte lots + zonage + TOD avec scoring visuel (« priorité = 4+ ∩ TOD »)
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:86:    un dossier **naît d'un signal** (un changement de zonage capté dans un PV), et **la plupart
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:110:  titre ville + règlement de zonage, et **4 compteurs** — *Lots total*, *Zones 4+ logements*,
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:131:  zonage PDF, lien Google Maps/Street View, **notes libres**. Champs masqués si vides (comme Steve).
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:144:  `Valuation{valeurTotale, valeurTerrain, valeurBatiment, rolYear}` (A5 rôle MAMH),
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:155:- **Gain** : alimenté par le **rôle MAMH standardisé** (universel QC via code MAMH) au lieu d'un
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:201:#### S-6. Pastilles / annotations réglementaires par catégorie (PPCMOI, dérogation, changement de zonage…)
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:204:  (modal catégorie ⚡ PPCMOI / 📋 Dérogation / 🗺️ Changement de zonage / ⭐ Opportunité / 🔍 À
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:209:    🗺️ Changement de zonage → `residential-rezoning` (ou `grid-cos-modification`) ;
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:229:  agricole sans dézonage = bas risque).
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:289:  **Adresses Québec / IGO** (A7 `adresses-quebec-igo-geocoder`) déjà prévu, avec geocoder.ca en
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:294:#### S-14. Éditeur de zonage manuel (Leaflet.draw) — bootstrap quand pas de zonage numérique
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:295:- **Écran : Sources** (outil de bootstrap d'une source zonage manquante).
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:297:  export GeoJSON `[{id, code, type, geojson}]` → déposé en `data/<slug>-zones.json`) devient un
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:300:  comme manque majeur dans `SPEC_PLAN_SCRAPING.md` B2). Export **GeoJSON versionné** (S3, pas
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:321:  enrichie du statut par couche (lots / zonage / TOD) attendu par Steve.
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:330:| S-1 | Carte lots+zonage+TOD, scoring visuel | P0 | **Opportunités** (+Évaluation) | Lot/ZoneVersion, TOD (A13), **score de potentiel par lot** (pas `scoreGlobal`) |
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:344:| S-14 | Éditeur de zonage manuel | P2 | **Sources** (bootstrap) | ZoneVersion.geom, geomSource |
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:358:| Cadastre (polygones) | `NO_LOT`, geom | `Lot.noLot`, `LotVersion.geom` | A6 cadastre-allégé / A4 Données Québec |
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:365:| Limite municipale | `boundary` (CSDUID) | `CityProfile.bbox` / boundary GeoJSON | A11 StatCan / A4 |
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:366:| Grille de zonage PDF | `meta.grilles` | artefact source rattaché à `ZoneVersion` | A2 / B2 |
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:493:complet (rôle MAMH + zonage extrait). On utilise le JSON par ville **scrappable** du Netlify
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:499:- Données par ville (6–24 Mo, GeoJSON WGS84) :
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:524:| `val_totale` / `val_terrain` / `val_batiment` | `Valuation{valeurTotale, valeurTerrain, valeurBatiment, kind:"role-evaluation", rolYear:2022, source:"carte-steve-fixture"}` | `verification:"simulé"`, `mode:"simulation"` |
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:528:| `boundary[]` (CSDUID) | boundary GeoJSON de la ville | — |
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:535:> cadastre/rôle/zonage** (JSON Netlify public par ville, sans PII) **et** (b) ses **marques
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:548:>    scrape EN PROFONDEUR de ces 4 villes** (toutes sources : PV/zonage, rôle, cadastre, zones, TOD)
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:560:> items track). Le **substrat cadastre/rôle/zonage** de la maquette (§6.2 table de mapping
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:598:  réel arrive** (rôle MAMH + cadastre A6), sans réinventer le geste :
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:602:    **+ `citySlug`**. Le `NO_LOT` cadastral est **invariant** entre la fixture et le rôle MAMH
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:621:- **Couverture data variable** : Delson = complet (zonage + TOD + descriptions) ; Candiac = lots +
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:622:  rôle seuls (ni zonage ni TOD) — bon cas-test du `partial`/`non-disponible` du scoring.
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:624:  branché le rôle MAMH, puis **basculer la même UI** sur les sources réelles (le contrat de
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:676:  PMTiles** (étape de scaling ci-dessous) : MapLibre consomme un `source` GeoJSON **puis** des
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:681:  (`/api/geo/:city/lots?limit&bbox`, déjà en place), MapLibre rend un *source* GeoJSON directement.
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:715:afficher. Le **socle est la donnée**, et la donnée réelle (rôle MAMH + zonage extrait) n'est pas
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:722:2. **CS-L6 (maquette substrat) EN PREMIER** : sans rôle MAMH ni zonage extrait, **aucune** des
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:739:- **CS-L2 ← CS-L6** (la fiche lot lit le rôle/zonage du substrat).
docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md:774:| **CS-P2** | S-12→S-17 (annonces, code postal, éditeur zonage, mobile, dashboard) | P2 | Opportunités/Évaluation/Sources | **L** (à éclater ; S-14 éditeur zonage = gros) | `01KTW1PPBEW81X8HTZZ4NS7VKZ` |
docs/spec/poc/cadrage-zones-pdf/artefacts/poc_zone_voronoi.py:10: 5. On garde les lots dont la zone == H-53. ogr2ogr dissout -> polygone GeoJSON.
docs/spec/poc/cadrage-zones-pdf/artefacts/poc_zone_voronoi.py:44:    """Classe une couleur d'aplat en categorie de zonage (heuristique HSV simple)."""
docs/spec/poc/cadrage-zones-pdf/artefacts/poc_labels.py:2:"""POC: GeoPDF de zonage -> points-labels de zone georeferences (lon/lat WGS84).
docs/spec/poc/cadrage-zones-pdf/artefacts/poc_labels.py:14:PDF = sys.argv[1] if len(sys.argv) > 1 else "sta-plan-zonage.pdf"
docs/spec/SPEC_ONTOLOGY_DATA_MODEL.md:1:# SPEC_ONTOLOGY - Ontologie graphify-ready + modele de donnees multi-villes (zonage, lots, designation, contraintes, valuation)
docs/spec/SPEC_ONTOLOGY_DATA_MODEL.md:127:Municipalites referencees (`ui/src/lib/onboarding/onboarding-data.ts`, MRC
docs/spec/SPEC_ONTOLOGY_DATA_MODEL.md:131:villes aux **regimes de zonage, processus decisionnels et canaux differents** (section 5).
docs/spec/SPEC_ONTOLOGY_DATA_MODEL.md:153:| `Municipality` | registre (`municipalities`) | une ville (slug + code MAMH 70052) | non (autoritaire) | **V1** |
