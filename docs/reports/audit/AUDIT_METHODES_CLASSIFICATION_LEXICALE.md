# Audit — méthodes de classification lexicale du vivier immobilier

**Date** : 2026-07-26 · **Branche** : `docs/audit-nlp-lexique-classification` · **Statut** : audit, aucun
code de classification modifié.

**Question du propriétaire** (verbatim) : *« cette évol me fait peur sur les fondations. c'est quoi la
méthode ? on pourrait faire du NLP à l'état de l'art (normalisation, stemming...) »*

**Réponse en une phrase** : la méthode actuelle est un **appariement de sous-chaînes sur du texte
minusculisé et désaccentué** — ni normalisation complète, ni lemmatisation, ni radicalisation ; elle
tranche **24,8 % des nœuds** du vivier et **3 bugs mesurés** (pluriels, apostrophes, adjacence)
expliquent la totalité des deux corrections en discussion. Le NLP d'état de l'art (stemming,
lemmatisation, embeddings) **n'est PAS la bonne réponse ici** — mesuré, le stemming Snowball français
fait *perdre* 10 preuves existantes tout en en gagnant 118 — alors que la correction des 3 bugs est
déterministe, sans dépendance, et hors du contrat gelé du filtre A.

---

## 1. Méthode de mesure

| Élément | Valeur |
|---|---|
| Corpus | `graph_nodes` prod, `type ∈ {Signal, DesignationEvent}` |
| Volume | **7 221 nœuds** (3 294 `Signal` + 3 927 `DesignationEvent`), **724 villes** |
| Accès | `kubectl exec … psql` **SELECT uniquement**, aucune écriture, aucune action k8s |
| Piège confirmé | les champs métier sont sous `props->'properties'` ; `props->>'category'` renvoie NULL |
| Fidélité | les littéraux de regex sont **extraits des sources TS par parsing**, pas retranscrits |
| Réplication | le pipeline B′ a été reproduit hors-ligne ; il **retrouve exactement 170 villes** en vue B par défaut et **173 sous C2** — soit les chiffres annoncés. La réplication est donc validée par recoupement. |

Scripts de mesure jetables sous `/tmp/nlp-audit/` (non versionnés, conformes à la consigne).

### Remplissage des champs structurés (la racine du problème)

| Champ (`props.properties`) | Renseigné |
|---|---|
| `etape` | **99,3 %** (7 173 / 7 221) |
| `description` | 86,0 % |
| **`category`** | **22,2 %** (1 603 / 7 221) |
| `intensite` | 3,9 % |
| `nb_unites_max` | 1,7 % (120 nœuds, **0 valeur non numérique**) |
| `instrument` | **0,3 %** (20 nœuds) |

**Les regex existent pour compenser un champ structuré manquant.** `etape` est renseignée à 99,3 %
parce qu'on a demandé à graphify de la produire (annotation v2.1). `category` est absente à 77,8 % —
et c'est précisément ce vide que `RESIDENTIEL_MARKERS_RE` et `instrumentFromSignal` colmatent au
mot-clé.

---

## 2. Inventaire exhaustif des décisions par appariement lexical

Légende **Nature** : `S` = champ structuré (lookup d'ensemble / numérique) · `T` = texte libre.
Légende **Axe** : `A` = filtre legacy gelé `z|m|p` · `r` = 4e axe optionnel · `B′` = vivier v2.

| # | Décision | Fichier:ligne | Nat. | Axe | Décide | Fragilité mesurée |
|---|---|---|---|---|---|---|
| 1 | `isZonageSignal` / `ZONAGE_CATEGORIES` (15 valeurs) | `api/src/services/graph/graph-store.ts:968,1004` | S | **A** (`z`), B′ | zonage oui/non | aucune sur le texte ; sensible au vocabulaire de `category`/`etape` |
| 2 | `isMulti4Plus` | `graph-store.ts:1172` | S | **A** (`m`) | multi 4+ | `parseInt` sur `nb_unites_max` ; 120 valeurs, **0 NaN** → sain |
| 3 | `deriveEtape` — **24 `includes()`** ordonnés, premier gagne | `graph-store.ts:1083` | **T** | **A** (`p`), B′ | étape réglementaire | **précision 73,6 %, rappel 31,3 %** (§3.4) ; FP sous-chaîne (`raccordement`→`accordé`) |
| 4 | `isPrecoceSignal` — égalité de chaîne **brute** sur l'annotation, sinon repli `deriveEtape` | `graph-store.ts:1368` | S+T | **A** (`p`) | précoce | aucune normalisation de l'annotation (contrairement à `token()` côté B′) ; delta mesuré **0** aujourd'hui, mais rupture silencieuse au moindre changement de casse/format |
| 5 | `RESIDENTIEL_CATEGORIES` (5) / `RESIDENTIEL_FORT_CATEGORIES` (4) / `COMMERCIAL_OR_INDUSTRIAL_CATEGORIES` (5) | `graph-store.ts:1210`, `b-prime.ts:33,36` | S | `r`, B′ | résidentiel | ne couvre que 22,2 % des nœuds (category NULL ailleurs) |
| 6 | **`RESIDENTIEL_MARKERS_RE`** — 19 alternatives (= `RESIDENTIAL` de b-prime, **octet pour octet**, + miroir UI identique) | `graph-store.ts:1225` · `b-prime.ts:38` · `ui/.../graph-signal-filter.ts:69` | **T** | `r`, B′ | résidentiel oui | **`s?` sur 6 alternatives / 19** → 120 faux négatifs (§3.1) |
| 7 | **`NON_RESIDENTIEL_MARKERS_RE`** — 25 marqueurs | `graph-store.ts:1241` (+ miroir UI) | **T** | `r` | non-résidentiel | rate `commerciaux` (20 nœuds), `environnementaux/-ales` (3) que B′ attrape (§3.2) |
| 8 | `FRANC_NON_RESIDENTIEL_SOURCE` (R3) + `REGIONAL_COMMERCIAL_POLE_RE` (R4) | `b-prime.ts:52,55` | **T** | B′ | exclusion franche | R4 exige `pôle commercial régional` littéral → le vrai PV Rosemère dit « pôle **régional** » (documenté dans la recette) |
| 9 | `RESIDENTIEL_FORT_SOURCE` (preuve forte, R3) | `b-prime.ts:67` | **T** | B′ | contre-preuve | contient `changement d usage` (espace) : **ne se déclenche jamais**, le corpus écrit `changement d'usage` (15 nœuds) |
| 10 | **`completeReform`** — `/\b(?:refonte\|revision) complete\b/` (mots **adjacents**) | `b-prime.ts:107` | **T** | B′ | refonte complète | **rate Sutton** ; 33 nœuds / 21 villes vs 36 / 22 avec une fenêtre de proximité (§4) |
| 11 | **`instrumentFromSignal`** — 6 instruments, sous-chaînes ordonnées, premier gagne | `api/src/services/graph/vivier-v2.ts:299` | **T** | B′ (**porte de l'axe `r`**) | instrument | `plan_urbanisme` **jamais atteint** (0/97) ; 1,1 % des nœuds portent ≥2 mots-clés arbitrés silencieusement ; **c'est cette règle qui décide de l'éligibilité de Sutton** (§4) |
| 12 | `derivedEtapes` / `toVivierEtape` — normalise via `token()`, union annotation ∪ historique ∪ texte | `vivier-v2.ts:275` | S+T | B′ | étapes | `accorde`/`refuse` silencieusement jetés (absents de `etapeFromRaw`) |
| 13 | `MULTI_USAGE_RE` | `api/src/services/scoring/zone-allows-4plus.ts:99` | **T** | geo/grille | zone permet 4+ | flag `i` sans désaccentuation ; gère l'abréviation `4 log.` — le seul lexique du dépôt qui le fasse |
| 14 | `RESIDENTIAL_MIXED_ZONE_RE` = `/^(H\|RM\|MXTV\|R)-/i` | `api/src/services/opportunity/scoring.ts:148` | S | scoring | zone résidentielle | préfixe de code de zone, pas du texte libre |
| 15 | `ODJ_LABEL_RE` / `PV_LABEL_RE` / `SESSION_MONTH_LABEL_RE` | `packages/radar-sources/.../proces-verbaux-parser.ts:305` | **T** | ingestion | type de document | **filtre en amont** : un PV mal étiqueté n'entre jamais dans le corpus (non mesurable depuis le graphe) |

Les autres regex trouvées (`ZONE_CODE_RE`, `BYLAW_REF_RE`, `REGLEMENT_*_RE`, `ELLIPSIS_MARKERS`) sont
de l'**extraction d'identifiants**, pas de la classification — hors périmètre.

### Duplications vérifiées (dérive potentielle)

| Lexique | Copies | Identiques aujourd'hui ? |
|---|---|---|
| `deriveEtape` (24 mots-clés) | `graph-store.ts` **et** `b-prime.ts:118` | **oui** (listes byte-identiques) |
| `RESIDENTIEL_MARKERS_RE` | API `graph-store.ts` **et** miroir UI | **oui** |
| `NON_RESIDENTIEL_MARKERS_RE` | API **et** miroir UI | **oui** |
| `ZONAGE_CATEGORIES` (15) | API **et** `ZONAGE_CATEGORIES_CLIENT` | oui |
| Vocabulaire non-résidentiel | A : `NON_RESIDENTIEL_MARKERS_RE` · B′ : `FRANC_NON_RESIDENTIEL_SOURCE` | **NON — divergence assumée et mesurée** (§3.2) |

4 copies synchronisées **à la main**, sans test qui compare les octets. C'est une dette de structure,
pas encore un bug.

---

## 3. Fragilité mesurée sur données réelles

### 3.0 Combien de décisions reposent sur une regex ?

Axe `r` (`classifyResidentielPertinence`), 7 221 nœuds :

| Source de la décision | Nœuds |
|---|---|
| Champ structuré `category` | **27 (0,4 %)** |
| `RESIDENTIEL_MARKERS_RE` (texte) | 1 021 (14,1 %) |
| `NON_RESIDENTIEL_MARKERS_RE` (texte) | 776 (10,7 %) |
| Aucun marqueur → `indéterminé` | 5 397 (74,7 %) |

**24,8 % des nœuds sont tranchés par une regex, 0,4 % par un champ structuré.** Sur le chemin B′
complet (R3/R4 inclus) : **26,5 % par regex** contre 0,4 % par catégorie.

### 3.1 Flexion — le pluriel (le bug « C2 »)

`RESIDENTIEL_MARKERS_RE` porte `s?` sur **6 alternatives sur 19** (`residentiel`, `multifamilial`,
`bi/tri/uni/plurifamilial`). Les 13 autres sont au singulier strict — dont 9 réellement fléchissables
(`habitation`, `logement`, `multilogement`, `multi-logement`, `densification`, `condominium`,
`maison de chambres`, `immeuble …`, `usage mixte`) — et le `\b` de fin d'alternance fait **échouer**
le pluriel.

| Terme | Présent au pluriel | **Manqué** | Villes touchées |
|---|---|---|---|
| `logements` | 282 | **95** | 68 |
| `habitations` | 69 | **14** | 11 |
| `multilogements` | 16 | **11** | 7 |
| `condominiums` | 0 | 0 | — |

Faux négatifs réels, tirés du corpus :

- `[sainte-therese]` « PPCMOI 2026-002 — Deux immeubles 6 étages au 156, rue Turgeon » (desc. au pluriel)
- `[lachute]` « PPCMOI zone Hc-415 – **multilogements** > 12 unités – lots 3 037 402/403 »
- `[labelle]` « Signal : lotissement majeur 20 **habitations** — lot 5 224 067, chemin du Sommet »
- `[lassomption]` « PPCMOI 15-2026 — 6 **logements** multifamiliaux, 31 rue Pierrot Est »
- `[abercorn]` « PIIA 26-008 — Construction **multilogements** — 107, rue Thibault Sud »

**Impact du patch C2** (ajouter `s?`) : **+106 nœuds** passent en `résidentiel`, sur **75 villes**.
En vue B par défaut : **170 → 173 villes** (`+beloeil`, `+beaupre`, `+acton-vale`), **308 → 321 nœuds**,
rappel Steve ≥6/10 **conservé 10/10**. Chiffres identiques à ceux annoncés dans le brief.

### 3.2 Divergence A / B′ sur le **même mot**

| Mot | Occurrences | A (`NON_RESIDENTIEL_MARKERS_RE`) rate | B′ (`FRANC_NON_RESIDENTIEL_RE`) attrape |
|---|---|---|---|
| `commerciaux` | 30 | **20** | 30 |
| `commerciales` | 26 | 0 | 26 |
| `environnementaux` | 1 | **1** | 0 |
| `environnementales` | 2 | **2** | 0 |

Cas réel : `[saint-urbain-premier]` « Adoption règlement 510-26 : ajout H2 zone R-4 et **usages
commerciaux** zone I-1 ». B′ l'exclut (R3), l'axe `r` de A ne le voit pas. La divergence est
**documentée et volontaire** (commentaire `graph-store.ts:1235-1240` : durcissement R3 réservé à B′
pour préserver l'invariant golden). Elle est donc un choix, mais elle signifie que **le même mot
français produit deux vérités selon le rail**.

### 3.3 Élision / apostrophe — des règles qui ne se déclenchent jamais

La normalisation `fold()` (minuscule + NFD + suppression des diacritiques) **ne touche pas
l'apostrophe**. Or trois motifs sont écrits avec un **espace** là où le corpus écrit `'` :

| Motif dans le code | Forme réelle dans le corpus | Déclenchements aujourd'hui | Après normalisation de l'apostrophe |
|---|---|---|---|
| `plan d urbanisme` (`instrumentFromSignal`) | `plan d'urbanisme` (**97 nœuds**) | **0** | **97** |
| `changement d usage` (`RESIDENTIEL_FORT_SOURCE`) | `changement d'usage` (**15 nœuds**) | **0** | **15** |
| `avis d motion` (`deriveEtape`) | — (aucune occurrence) | 0 | 0 |

**28,7 % des nœuds contiennent une apostrophe** (4 nœuds portent l'apostrophe typographique U+2019,
que `fold()` ne normalise pas non plus). L'instrument `plan_urbanisme` est **du code mort en
production** : 0 nœud sur 7 221 le reçoit. Cas réels invisibles : `[lac-sainte-marie]` « adoption
nouveau plan d'urbanisme et règlements », `[laverlochere-angliers]` « **Changement d'usage**
industriel→résidentiel/commercial, Ferme Clarital ».

### 3.4 `deriveEtape` — mesure contre l'annotation

Sur les **4 003 nœuds** dont l'annotation `etape` est une valeur d'`Etape` comparable :

| | |
|---|---|
| La règle texte est **muette** (`inconnu`) | **68,7 %** |
| Elle **concorde** avec l'annotation | 23,0 % |
| Elle **diverge** | 8,2 % |
| **Précision quand elle parle** | **73,6 %** |
| **Rappel (elle parle)** | **31,3 %** |

Confusions dominantes, avec cas réels :

| Confusion | n | Cas réel | Qui a raison |
|---|---|---|---|
| `inconnu → accorde` | 48 | `[hinchinbrooke]` « Demande **raccordement** eau/égout Huntingdon » | **la règle a tort** — `"raccordement".includes("accorde")` |
| `avis_motion → projet_reglement` | 29 | `[hudson]` « Adoption projet règlement 787-2026 » | ambigu |
| `avis_motion → adoption` | 27 | `[saint-pie-de-guire]` « adoption règlement 25-737 » | ambigu |
| `adoption → accorde` | 24 | `[laurierville]` « Dérogation **accordée** pour agrandissement de garage » | plausible des deux côtés |
| `adoption → consultation` | 16 | `[lac-sainte-marie]` « adoption nouveau plan d'urbanisme » (desc. mentionne une consultation) | **la règle a tort** — `consultation` est testé **avant** `adoption` |
| `adoption → avis_motion` | 16 | `[lyster]` « **Avis de motion** - Agrandissement zone 37 Ra/C » | **l'annotation a tort**, la règle a raison |

Deux enseignements : (a) le désaccord **coupe dans les deux sens** — ce n'est pas « la regex est
mauvaise », c'est « deux méthodes indépendantes divergent sur 8 % » ; (b) l'ordre des tests est un
**arbitre caché** : `consultation` bat `adoption`, `en vigueur` bat `adoption`.

Faux positifs de sous-chaîne confirmés : `raccordement` → `accordé` (**9 nœuds**), `dérogation
refusée` → instrument `derogation` (5 nœuds), toute mention de `refonte` → instrument `refonte`
(17 nœuds sur 56 textes contenant le mot).

### 3.5 Hypothèses de fragilité **infirmées** par la mesure

| Hypothèse | Mesure | Verdict |
|---|---|---|
| Coupures de ligne / césures de PDF | **0 nœud** contient `\n`, une césure ou un double espace | **infirmée** — le texte est déjà normalisé en amont par l'extraction graphify |
| `nb_unites_max` non parsable | 120 valeurs, **0 NaN**, 0 valeur non purement entière | **infirmée** — l'axe `m` est sain |
| Casse / accents | `fold()` les traite déjà partout | **infirmée** — c'est le seul étage de normalisation déjà en place, et il fonctionne |
| Annotation d'étape non normalisée côté A | delta raw vs `token()` = **0 nœud** | **infirmée aujourd'hui**, mais non protégée par un test |

### 3.6 Concentration du risque

**110 des 170 villes de la vue B (65 %) n'y sont que par UN SEUL nœud.** Parmi les 10 villes notées
≥6/10 par Steve, **3 tiennent à un seul nœud** : `saint-stanislas-de-kostka`, **`sutton`**,
`saint-boniface`. Un faux négatif lexical unique suffit à faire disparaître une ville 10/10.

---

## 4. Le cas Sutton, disséqué

Les deux nœuds Sutton portant la refonte, verbatim du corpus prod :

```
signal-sutton-refonte-zonage-2026        cat=rezonage  etape=projet_reglement  instrument=NULL
  label : « Signal : refonte réglementaire complète Sutton — nouveau zonage et lotissement (2026) »
  desc  : « Refonte totale du zonage (règlement 358), … Consultation publique 25 juin 2026. »

event-sutton-refonte-reglementaire-2026-05-27   cat=NULL  etape=projet_reglement  instrument=NULL
  label : « Refonte réglementaire complète — Sutton (séance extraordinaire 27 mai 2026) »
  desc  : « Adoption 1ers projets règlements 358 (zonage), … 362 (PPCMOI), 363 (permis). …
            Consultation publique 25 juin 2026. »
```

**Quatre échecs lexicaux distincts sur la même ville :**

1. **Adjacence** — `/\b(?:refonte|revision) complete\b/` exige les deux mots collés. Sutton écrit
   « refonte **réglementaire** complète » : un mot s'intercale → `completeReform = false`.
2. **Synonymie** — la description dit « Refonte **totale** du zonage ». `totale` n'est pas au lexique.
3. **Flexion** — `deriveEtape` cherche `1er projet` ; le texte écrit « **1ers projets** ». La règle
   tombe donc sur `consultation` (mot présent dans les deux descriptions), testé **avant** `adoption`
   et `projet_reglement` : c'est la « dérive d'étape » que la recette attribue à Sutton, reproduite ici.
   R1 (l'annotation fait autorité) la neutralise déjà. 10 nœuds / 8 villes portent une forme fléchie de
   « premier projet » manquée par le motif littéral.
4. **Ordre des règles** — `instrumentFromSignal` teste `ppcmoi` **avant** `refonte`. La description de
   `event-sutton-refonte-reglementaire-2026-05-27` énumère « 362 (**PPCMOI**) » parmi les règlements
   adoptés → l'événement de refonte est classé **`instrument = ppcmoi`**.

**Conséquence mesurée sur la vue B par défaut (`z + r + p`) :**

```
inB=false  instr=rezonage? non   signal-sutton-cptaq-terres-agricoles-2026   (étape inconnu)
inB=TRUE   res=indeterminé  eligible=true   instr=rezonage  etape=projet_reglement
                                            ← signal-sutton-refonte-zonage-2026
inB=false  res=indeterminé  eligible=FALSE  instr=ppcmoi    etape=projet_reglement
                                            ← event-sutton-refonte-reglementaire-2026-05-27
```

**Sutton n'est dans B que par un seul nœud, et son éligibilité vient de `category="rezonage"` — pas
d'une détection de refonte.** Aucune des deux mentions « refonte … complète » n'est vue par le code.

### Impact chiffré des variantes du critère d'éligibilité (vue B par défaut)

| Variante | Nœuds | Villes | Rappel Steve ≥6 |
|---|---|---|---|
| **Statu quo** — éligible si `instrument ∈ {rezonage, refonte}` | 308 | **170** | **10/10** |
| **C1** — éligible si drapeau `completeReform` (regex actuelle, adjacente) | 146 | 91 | **9/10 — SUTTON PERDU** |
| **C1′** — même critère, regex à **fenêtre de proximité ≤ 30 car. + synonymes** | 148 | 92 | **10/10** |
| Réordonner `instrumentFromSignal` (refonte avant ppcmoi), regex adjacente | 314 | 171 | 10/10 |
| Réordonner **+** proximité ≤ 30 | 315 | **171** | **10/10** |

Le piège du brief est **confirmé au nœud près** : brancher C1 sur le drapeau tel quel coûte Sutton et
divise le vivier par ~1,9 (170 → 91 villes). Et il est **réparable par un seul changement de regex** :
passer de l'adjacence à une fenêtre de proximité rend C1 compatible avec 10/10.

### La fenêtre de proximité est chirurgicale, pas laxiste

| Variante de détection « refonte complète » | Nœuds | Villes | Sutton |
|---|---|---|---|
| Statu quo `(refonte\|revision) complete` adjacent | 33 | 21 | ✗ |
| **`(refonte\|revision)` + ≤30 car. + `(complete\|totale\|globale\|generale\|integrale)`** | **36** | **22** | **✓** |
| Élargie (`refonte réglementaire`, `majeure`, `refondu`) | 50 | 33 | ✓ |

La variante « proximité ≤ 30 » ajoute **exactement 3 nœuds** : les 2 de Sutton, plus
`[saint-gabriel-lalemant]`. La variante élargie ajoute 14 nœuds de plus dont **`[rosemere]`** — ville
que la recette veut explicitement **hors** de B′ (✗0) — et `[la-pocatiere]` « fusion municipale ».
**La proximité est la bonne dose ; l'élargissement lexical ne l'est pas.**

---

## 5. État de l'art évalué contre NOS contraintes

Contraintes appliquées : **budget 0 $** (crédit de session CLI uniquement, **crédit Codex épuisé
jusqu'au 1er août — seul le crédit Claude est disponible**) · stack **Node/TypeScript Docker-first** ·
**déterminisme et goldens stables** (contrat de non-régression du dépôt) · corpus 7 221 nœuds.

| Option | Gain attendu | Coût d'intégration Node/TS | Déterminisme | Dépendances | Coût d'exécution | Verdict |
|---|---|---|---|---|---|---|
| **(a) Statu quo regex** | — | 0 | **parfait** | 0 | négligeable | insuffisant : 3 bugs mesurés |
| **(b) Normalisation simple** (casse + accents + **apostrophes** + espaces) | **+112 déclenchements** aujourd'hui morts ; ressuscite `plan_urbanisme` (0→97) et `changement d'usage` (0→15) | ~30 lignes, une fonction `fold()` partagée | **parfait** | **0** | négligeable | **RETENU (P0)** |
| **(c) Stemming Snowball FR** | 96,6 % inchangé ; **+118** → résidentiel, **+117** → non-résidentiel | `snowball-stemmers` (MIT, ~40 kB, pur JS, npm accessible, gratuit) — vérifié installable | **parfait** (byte-reproductible, vérifié sur 2 exécutions) | 1 paquet | négligeable | **NON RETENU maintenant** (voir ci-dessous) |
| **(d) Lemmatisation** (spaCy fr, Lefff) | meilleure précision que le stemming | **runtime Python + modèle 15–50 Mo** hors stack Node ; nouveau conteneur | bon si version figée | lourdes | non nul | **DISQUALIFIÉ sur le coût d'intégration** (pas sur le prix) |
| **(e) Appariement flou** (Levenshtein, trigrammes) | rattrape les fautes de frappe | modéré | **parfait** si seuil figé | légères | O(n·m) acceptable | **NON RETENU** — le corpus est propre (0 artefact PDF, §3.5) ; le flou attaquerait un problème qui n'existe pas et créerait des faux positifs sur les codes de zone |
| **(f) Embeddings / classifieur** | généralisation sémantique | modèle ONNX ~90 Mo + runtime ; **et surtout : pas de corpus étiqueté** (16 labels notés sur 15 villes) | **fragile** — sorties flottantes sensibles au BLAS/CPU → goldens instables | lourdes | non nul | **DISQUALIFIÉ** — déterminisme + absence de données d'entraînement |
| **(g) LLM en aval de l'extraction** | qualité maximale | API payante | **non déterministe** | API | **> 0 $** | **DISQUALIFIÉ — budget 0 $.** Une solution exigeant une API payante est hors jeu, je le dis explicitement. |

### Pourquoi le stemming, malgré un déterminisme parfait et un coût nul, n'est pas la réponse

Mesuré pour de vrai (Snowball FR, même vocabulaire, appariement sur radicaux, 7 221 nœuds) :

- 96,6 % des nœuds inchangés ; **147 villes touchées** ;
- **+118** nœuds gagnent une preuve résidentielle, **+117** une preuve non-résidentielle ;
- **mais 10 nœuds PERDENT une preuve existante** (`non_residentiel → indéterminé`), ex.
  `[laurierville]` « Intervention concernant les **milieux humides** … », `[boileau]` « Risque
  d'**exploitation minière** … ».

Le stemming **n'est pas monotone** : il n'ajoute pas du rappel à précision constante, il redistribue.
Et il **sur-radicalise** dangereusement en français :

| Terme | Radical | Danger |
|---|---|---|
| `habitation` | **`habit`** | 4 nœuds appariés sans le mot (« étage **habitable** », « **habit**uelle ») |
| `logement` | **`log`** | 10 nœuds sans le mot (« Accès-**Logis** ») — mais rattrape l'abréviation « 12 **log.** » |
| `stationnement` | **`station`** | apparierait « **station**-service », « **station** de pompage » |
| `densification` | `densif` | sûr |
| `commercial` | `commercial` | sûr — **et résout `commerciaux` gratuitement** |

Un déploiement global du stemming demanderait de re-valider **147 villes** et de re-geler les
goldens. Un patch de pluriel ciblé demande d'en valider **75**, dans une seule direction (gain), sans
dépendance. **Le rapport bénéfice/risque penche nettement vers le patch ciblé.**

**Le stemming reste pertinent plus tard**, et seulement sur des termes dont le radical est long et non
ambigu (`commercial`, `industriel`, `multifamilial`, `densification`) — pas sur `habitation` ni
`logement`.

### Le vrai levier d'état de l'art est déjà dans la stack, en amont

Le pipeline **utilise déjà un LLM** : c'est graphify qui produit `label`, `description`, `etape`,
`category`. C'est pourquoi le corpus ne contient **aucun artefact de PDF** (§3.5) et pourquoi `etape`
est renseignée à **99,3 %** — parce qu'on l'a explicitement demandé (annotation v2.1). `category`,
elle, est absente à **77,8 %**, et les regex ne font que combler ce trou au mot-clé.

**Ajouter du NLP en aval, c'est déduire au mot-clé ce qu'on a déjà payé un LLM pour comprendre en
amont.** Faire produire `category` (et `instrument`) par graphify, comme on l'a fait pour `etape`,
supprimerait la cause plutôt que le symptôme — au même coût de crédit de session que les campagnes
v2.1/v2.2 déjà menées, donc **0 $**.

---

## 6. Risque de régression — ce qui peut bouger sans toucher A

Le contrat gelé (`docs/reports/consensus/graphify-3.4-legacy-filter-a-addendum.md`, golden
`api/src/services/graph/legacy-filter-a-golden.test.ts`) porte sur le **filtre A legacy `z|m|p`
uniquement** : appartenance par signal, 8 clés de compteurs, ordre, états d'URL. Le golden ne gèle
**que les 8 clés `z|m|p`**.

| Lexique / règle | Lu par A (`z\|m\|p`) ? | Modifiable sans toucher A ? |
|---|---|---|
| `RESIDENTIEL_MARKERS_RE` | **NON** — l'axe `r` est le 4e axe optionnel, hors des 8 clés gelées | ✅ **OUI** |
| `NON_RESIDENTIEL_MARKERS_RE` | **NON** | ✅ **OUI** |
| `RESIDENTIEL_CATEGORIES` | **NON** | ✅ **OUI** |
| `FRANC_NON_RESIDENTIEL_SOURCE`, `REGIONAL_COMMERCIAL_POLE_RE`, `RESIDENTIEL_FORT_SOURCE` | **NON** (B′ pur) | ✅ **OUI** |
| `completeReform` (b-prime) | **NON** | ✅ **OUI** |
| `instrumentFromSignal` | **NON** | ✅ **OUI** |
| `ZONAGE_CATEGORIES` | **OUI** (axe `z`) | ❌ **INTERDIT** |
| `isMulti4Plus` | **OUI** (axe `m`) | ❌ **INTERDIT** |
| **`deriveEtape`** | **OUI** (axe `p` via `isPrecoceSignal`) **et B′** | ❌ **INTERDIT en l'état** |
| `isPrecoceSignal` | **OUI** | ❌ **INTERDIT** |

**Surface d'exposition de `deriveEtape` sur A, mesurée : 2 nœuds sur 7 221.** Seuls 48 nœuds n'ont pas
d'annotation `etape`, et parmi eux 2 seulement sont `précoce` par dérivation texte — les deux de
`blue-sea` (`sig-patrimoine-2026-120`, `sig-pu-2026-123`). Sous l'addendum, 2 nœuds ≠ 0 nœud : **toute
modification de `deriveEtape` est un NO-GO tant qu'elle n'est pas versionnée**.

**Sortie propre** : `deriveEtape` est déjà **dupliquée** dans `b-prime.ts` (listes identiques,
vérifié). Il suffit de **figer la copie A** (`graph-store.deriveEtape`, gelée, plus jamais touchée) et
de faire évoluer **la copie B′** — la duplication qui est aujourd'hui une dette devient le mécanisme
de découplage. Aucun changement d'octet côté A.

**Conclusion §6 : toutes les corrections proposées (C2 pluriels, apostrophes, proximité refonte, ordre
des instruments) vivent dans la zone ✅ et ne touchent pas A.** Vérifié par mesure : sous C2 et sous
la normalisation d'apostrophe, les 8 clés `z|m|p` sont inchangées (les axes `z` et `m` ne lisent aucun
de ces lexiques, et `p` ne dépend que de `deriveEtape`, non modifiée).

---

## 7. Recommandation ordonnée

**Réponse directe à la question posée : rustiner les regex, oui — mais pas comme C1/C2 sont écrites,
et en fermant en même temps la porte de sortie structurelle.** Changer de méthode NLP maintenant
serait payer un coût de re-validation sur 147 villes pour un gain non monotone, alors que la cause
racine (77,8 % de `category` NULL) n'est pas un problème de NLP.

| Rang | Action | Impact mesuré | Risque A | Effort |
|---|---|---|---|---|
| **P0-a** | **C2 tel quel** : `s?` sur les 9 termes fléchissables restants de `RESIDENTIEL_MARKERS_RE` (+ miroir UI, octet pour octet) | +106 nœuds `résidentiel` / 75 villes · vue B **170 → 173** · Steve **10/10** | **nul** | 1 h |
| **P0-b** | **Normaliser l'apostrophe** (`'` et `’` → espace) dans `foldText`/`fold` — **côté `r` et B′ seulement, PAS dans la normalisation interne de `deriveEtape`** (qui est une fonction séparée et lue par A) | ressuscite `plan d'urbanisme` (0→97) et `changement d'usage` (0→15) · vue B **inchangée à 170**, aucune ville perdue | **nul** | 1 h |
| **P0-c** | **Remplacer l'adjacence par une fenêtre de proximité** dans `completeReform` : `(refonte\|revision)` + ≤30 car. + `(complete\|totale\|globale\|generale\|integrale)` | +3 nœuds (2× Sutton + 1) · **rend C1 compatible 10/10** (91→92 villes si C1 branché, ou 170→171 en réordonnant) | **nul** | 1 h |
| **P0-d** | **Réordonner `instrumentFromSignal`** : tester `refonte` **avant** `ppcmoi` | 170 → **171 villes**, Steve **10/10** · corrige l'événement Sutton classé `ppcmoi` | **nul** | 30 min |
| **P1** | **Figer `graph-store.deriveEtape`** (copie A, gelée, normalisation interne incluse) et faire évoluer la copie `b-prime` | découple A de toute évolution d'étape | nul par construction | ½ j |
| **P1** | **Un seul `fold()`** exporté et partagé (API + UI + domain) **pour les axes non gelés**, avec un test qui compare les **octets** des 4 lexiques dupliqués. À faire **après** le gel ci-dessus : sans lui, unifier `fold` avec la normalisation interne de `deriveEtape` ferait rentrer P0-b dans le périmètre A | supprime la dérive silencieuse A/UI/B′ | nul **si l'ordre est respecté** | ½ j |
| **P2** | **Sortir les lexiques du code** : listes de termes déclaratives + goldens par terme (« ce terme, ce texte, cette décision ») | rend chaque ajout de mot testable et auditable | nul | 1–2 j |
| **P2** | **Demander `category` à graphify** (campagne comme v2.1 pour `etape`) | attaque la cause : 22,2 % → cible >95 % ; réduit mécaniquement la part des décisions par regex (24,8 % → marginal) | nul (annotation, pas classification) | campagne, 0 $ |
| **P3** | Stemming Snowball **ciblé** sur les termes à radical long et non ambigu (`commercial`, `industriel`, `multifamilial`, `densification`) | résout `commerciaux` sans le risque `habit`/`log`/`station` | nul | 1 j, **après** P2 |
| **✗** | Lemmatisation, appariement flou, embeddings, LLM en aval | — | — | **rejetés** (§5) |

### Chemin de migration qui ne perd pas Sutton

1. **Ne jamais brancher l'éligibilité de l'axe `r` sur le drapeau `completeReform`.** C'est la seule
   variante mesurée qui casse le rappel (9/10, Sutton perdu, 170→91 villes). Garder la porte actuelle
   `instrument ∈ {rezonage, refonte}` — c'est elle qui tient Sutton aujourd'hui, via
   `category="rezonage"`.
2. Appliquer **P0-c puis P0-d** : la refonte devient détectable *et* atteignable dans l'ordre des
   instruments. Sutton passe alors de **1 nœud** à **2 nœuds** dans B — il cesse d'être un cas limite.
   Mesuré : 171 villes, Steve 10/10.
3. Appliquer **P0-a et P0-b** : 173 villes, Steve 10/10, aucune ville perdue.
4. **Geler chaque étape par un golden Sutton** avant la suivante. `sutton-legacy.fixture.ts` et
   `bprime-recette.test.ts` existent déjà ; y ajouter les deux nœuds de refonte avec leur `instrument`
   et leur `completeReform` attendus.
5. Ce n'est qu'**après** P2 (`category` renseignée) qu'on peut envisager P3 — à ce moment-là le
   stemming ne portera plus que sur une minorité résiduelle de nœuds, et son risque sera borné.

**Ordre de grandeur cumulé P0 : 170 → 173–174 villes, rappel Steve ≥6/10 maintenu à 10/10, zéro
dépendance ajoutée, zéro octet changé sur le filtre A, ~4 h de travail.**

---

## 8. Ce que je n'ai PAS pu établir

1. **Aucune vérité-terrain sur l'axe résidentiel.** La mesure précision 73,6 % / rappel 31,3 % ne
   vaut **que pour l'étape** (comparaison à l'annotation `etape`). Pour `residentiel`, aucun champ de
   référence n'existe dans le corpus : les 24,8 % de décisions par regex ne sont **pas** évaluées en
   justesse, seulement en volume et en cas d'espèce.
2. **L'annotation `etape` n'est pas un étalon.** Elle est produite par graphify (LLM). Le désaccord de
   8,2 % mesure une **divergence entre deux méthodes**, pas l'erreur de l'une — et §3.4 montre des cas
   où l'annotation a tort et la regex raison (`[lyster]`).
3. **Aucun test n'a été exécuté.** Pas de `make test ENV=test-nlp`, pas de `make lint` : cet audit est
   en lecture seule et ne modifie aucun code, donc rien à faire passer au gate. La réplication du
   pipeline est hors-ligne, en JS jetable ; elle est **recoupée** par la reproduction exacte du 170 →
   173, mais elle n'est pas le code de production.
4. **Le filtre d'ingestion n'est pas mesurable depuis le graphe.** `ODJ_LABEL_RE` / `PV_LABEL_RE`
   (`proces-verbaux-parser.ts`) écartent des documents **avant** qu'ils deviennent des nœuds. Les
   faux négatifs de cette étape sont, par construction, invisibles dans les 7 221 nœuds. C'est un angle
   mort réel et non chiffré.
5. **Impact UI / URL non rejoué.** Les `subsetCounts` persistés, les états d'URL et le rail n'ont pas
   été exercés ; §6 raisonne sur la lecture du code et du golden, pas sur une exécution.
6. **La recette Steve-30 reste une CIBLE.** `RECETTE_VIVIER_BPRIME_STEVE30.md` est explicite : « QA
   prod requise ville par ville ». Le 10/10 mesuré ici est un rappel de **présence dans la vue B**, pas
   une validation ville par ville sur les données servies.
7. **Rosemère / Saint-Charles-Borromée** (cibles ✗0) restent hors d'atteinte du lexique — le vrai PV
   Rosemère dit « pôle **régional** », sans marqueur franc-commercial. Confirmé : la variante élargie
   de détection de refonte **réintroduit Rosemère**, ce qui est une régression. Ces deux cas relèvent
   du marquage sémantique geo, pas du NLP.

---

### Note sur la vérité-terrain de notation

`packages/radar-scoring/src/steve30/dataset.ts` encode la revue verbatim de 30 villes par Steve
(16 labels notés sur 15 villes ; 10 lignes notées ≥6/10). C'est une **grille de critères
déterministe**, pas un modèle entraîné : aucune notion d'apprentissage ni de surapprentissage ne s'y
applique. Elle est utilisée ici uniquement comme **liste de villes à ne pas perdre**.
