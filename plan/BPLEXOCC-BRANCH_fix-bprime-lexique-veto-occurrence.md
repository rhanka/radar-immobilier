# BRANCH — fix(lexique): « refonte » lue par occurrence, bornée à l'urbanisme

**Type** : fix · **Base** : `origin/main` · **Workspace** : radar-immobilier
**ENV** : aucun (vitest direct, aucun stack Docker — la machine héberge
plusieurs stacks + la démo, un stack de trop l'a déjà fait tomber par OOM)

## Problème

`instrument` est la porte de l'axe résidentiel du vivier B′
(`packages/radar-domain/src/vivier/counts.ts`, `isResidentialEligible` :
sans objet résidentiel explicite, seuls `rezonage` et `refonte` restent
éligibles). Toute bascule d'`instrument` fait donc entrer ou sortir un signal
du vivier livré au propriétaire.

Sur `origin/main`, la reconnaissance était :

```ts
if (candidate === "refonte" || text.includes("refonte")) return "refonte";
```

`includes("refonte")` fait entrer n'importe quelle refonte, urbanistique ou non.

## Ce que le premier jet du lot a corrigé — et cassé

Le premier jet (`a15ce4e`) a introduit `isRegulatoryReform`, liste positive
bornée évaluée PAR OCCURRENCE. Deux revues adverses successives l'ont rendu
BLOQUANT. **Les déclarations ci-dessous corrigent celles du jet précédent, qui
décrivaient l'inverse de ce que le code faisait sur données réelles.**

### D1 — l'effet réel de sortie n'était pas celui annoncé

Le jet précédent présentait l'effet comme le retrait de « refonte du site Web
municipal / organisationnelle / des infrastructures / de la grille tarifaire ».
**Aucune de ces formes n'existe dans les 7 221 nœuds de production** (724
villes) mesurés par la revue. L'effet réel mesuré était **12 bascules
d'`instrument` : +8 entrants** (tous légitimes, dont Sutton `ppcmoi → refonte`)
et **−4 sortants**, dont **3 vraies refontes d'urbanisme** :

| id | ville | texte | cause de la perte |
|---|---|---|---|
| `event-chibougamau-520-05` | chibougamau | « Refonte des plans **et** règlement d'urbanisme » | la coordination casse `plans?\s+d['’]` |
| `event-hatley-refonte-urbanisme-sadd-2026` | hatley | « Refonte complète **outils** planification/réglementation d'urbanisme » | l'adjectif d'ampleur n'admettait qu'un objet réglementaire immédiat |
| `event-saint-jean-de-matha-zonage-604-adoption-2026-01-14` | saint-jean-de-matha | « Adoption règlement de zonage 604 — refonte plan et règlements d'urbanisme » | coordination, idem |
| `signal-lac-frontiere-services-souterrains-route-204` | lac-frontière | voirie | **seul vrai faux positif retiré — légitime, conservé en sortie** |

Bilan de précision du jet précédent : **+1 faux positif retiré, −3 vrais
positifs perdus**. Un signal qui sort est plus grave qu'un signal qui n'entre
pas : le propriétaire l'avait sous les yeux, il disparaît de son panneau.

### D2 — la borne « urbanisme » n'existait pas

Le commentaire affirmait « seules les formes réglementaires **d'urbanisme**
sont retenues ». C'était faux : `REFORM_SCOPE` acceptait `reglements?` et
`reglementations?` **nus**. Entraient donc en `refonte` huit familles de
règlements municipaux sans rapport avec l'urbanisme — taxation, animaux, régie
interne, gestion contractuelle, sécurité incendie, règlements municipaux,
bibliothèque, règlement d'emprunt. Le lot avait été ouvert pour **borner** ;
il ne bornait pas.

### D3 — la ponctuation tenait lieu de borne

Le lookahead `(?=\s*(?:[.,;:!?)\]]|$)…)` admettait l'adjectif d'ampleur devant
**n'importe quelle** ponctuation. Le contre-exemple vedette du lot tombait sur
une virgule : « Refonte totale du site Web municipal » → `autre`, mais
« Refonte complète, en trois phases, du site Web municipal » → `refonte`.

### D4 — le déplacement d'ordre avait une régression symétrique

Le jet précédent testait `isRegulatoryReform(text)` **avant** `candidate ===
"ppcmoi"`, `"piia"` **et** `"derogation"` / `"plan_urbanisme"` (ces deux
dernières bascules n'étaient **pas déclarées**). Conséquence : la catégorie
STRUCTURÉE perdait contre une heuristique de texte libre. Un PPCMOI ponctuel
dont le PV se contente de MENTIONNER une refonte en cours (« en concordance
avec la refonte du règlement de zonage ») entrait dans le vivier sous une
étiquette fausse. Le lot confondait **deux réordonnancements distincts**.

### D5 — trois déclarations fausses, corrigées ici

- **NBSP** : le jet précédent déclarait qu'un « refonte<NBSP>du règlement »
  resterait non reconnu. **Faux, mesuré** : `\s` matche U+00A0 en JS, la forme
  était déjà reconnue. Le test `NBSP U+00A0` ajouté ici **passe avant comme
  après** le correctif — il est déclaré comme garde-fou, pas comme preuve.
- **Cas mixte fondateur** : « PIIA — refonte architecturale » + « Refonte
  complète du règlement de zonage » était présenté comme le défaut fondateur.
  Il est **synthétique** : aucun nœud de ce type dans les 7 221. Il est
  conservé comme sonde de la lecture par occurrence, **déclaré synthétique**,
  et sa `category="piia"` a été retirée — désormais la catégorie structurée
  fait autorité et l'emporterait.
- **Garde-fou octet** : le jet précédent attribuait la protection contre une
  classe `['']` (apostrophe ASCII doublée) aux assertions `codePointAt(0)`.
  **Faux** : ces assertions ne portent que sur les littéraux du test, pas sur
  la regex. Ce qui tue le mutant, ce sont les assertions COMPORTEMENTALES
  `isRegulatoryReform("refonte du plan d’urbanisme") === true` jouées sur les
  deux codepoints. Le garde-fou fonctionne ; sa description était fausse.
- **Assertion vacue** (ex-`vivier-v2.test.ts:265-267`) : le commentaire
  affirmait que le signal sortirait « via `piia_non_pertinent` ». **Faux** :
  cette exclusion exige `residentiel.valeur === "non"`, et le cas donne
  `exclusion_reason = null` sur `main` **comme** sur la branche. La thèse
  centrale du lot n'était donc démontrée par **aucun** test. La vraie porte est
  `isResidentialEligible` — le test l'appelle maintenant explicitement.

## Ce que la recette sur les 7 221 nœuds a mesuré — et les 2 dernières pertes

Mesure faite sur les **7 221 nœuds de production**. Contrôles de validité du
pipeline : `classifyBPrime` sur `main` = **6 777 / 720 villes** (repère exact),
et le rejeu `main → a15ce4e` retrouve les 12 bascules attendues.

**Delta mesuré du lot** (après la correction de la borne d'urbanisme et de
l'ordre) :

| grandeur | valeur mesurée |
|---|---|
| entrants | **+7**, tous légitimes (godbout, ham-sud, la-minerve, saint-polycarpe, sutton, très-saint-rédempteur, havelock) |
| sortants | **−3** |
| axe résidentiel | **1 365 → 1 369** |
| réordonnancement | **10 nœuds relabellisés, 0 mouvement de périmètre** — permuter entre `ppcmoi`/`piia`/`derogation` ne peut pas déplacer l'axe `r`, aucun des trois n'y étant éligible |
| villes 10/10 | **conservées** ; Sutton passe de 1 à 2 signaux |
| villes vidées | **0** |

Les 3 régressions de la revue précédente (chibougamau, hatley,
saint-jean-de-matha) sont **récupérées**, et Lac-Frontière **reste dehors** —
seul vrai faux positif retiré, légitime.

Restaient **2 vraies refontes d'urbanisme sorties**, corrigées ici.

### P1 — `event-chute-saint-philippe-refonte-reglementation-2026-04-13`

« Adoption groupée règlements 331 à 336-2026 — refonte **réglementation
urbanisme** » / « Adoption groupée de 6 règlements d'urbanisme (331 à 336-2026)
modifiant permis (137, 138), zonage (139), lotissement (140), construction
(141)… ». Six règlements d'urbanisme : refonte incontestable.

**Cause** : `REFORM_URBAN_QUALIFIER` exigeait `de ` ou `d'`. L'**apposition
nue** « réglementation urbanisme » n'était pas reconnue.

**Correction** : le déterminant devient optionnel dans le qualifiant. Le TERME
D'URBANISME, lui, reste obligatoire — c'est lui qui qualifie, **jamais**
l'absence de préposition. La borne des huit familles municipales tient donc à
l'identique en apposition : « refonte réglementation animaux », « refonte
règlement taxation », « refonte règlements municipaux » restent dehors, et
« refonte services souterrains » (forme apposée de Lac-Frontière) aussi.

### P2 — `signal-saint-sixte-refonte-urbanisme-fo2fo3`

« Signal : refonte **réglementation zones** Fo-2/Fo-3 et milieu villageois
(règlements 260-26 et 261-26) », `category = refonte_reglementation_urbanisme`.

**Double cause, chacune suffisante :**

1. **Défaut de la correction précédente elle-même.** Le test de catégorie
   structurée était une **égalité stricte** `candidate === "refonte"`. La base
   porte **trois** tokens `refonte_*` — `refonte_reglementation_urbanisme`
   (×2) et `refonte_reglementation` (×1). La règle « la catégorie structurée
   fait autorité », introduite au commit précédent, ne se déclenchait donc pas
   pour eux : l'autorité était donnée, mais la catégorie n'était pas reconnue
   quand elle est préfixée.
2. « réglementation **zones** » n'avait aucun qualifiant reconnu (même cause
   que P1, et `zone` n'était pas un terme d'urbanisme).

**Correction** : `REFORM_CATEGORY_RE = /^refontes?(?:_|$)/` — un préfixe
**borné**, jamais un `includes`. `piia_refonte_architecturale` n'est pas une
refonte ; `derogation_mineure`, `ppcmoi`, `modification_zonage` gardent leur
reconnaissance intacte. Et `zone(s)` est ajouté comme **qualifiant seulement**,
pas comme objet porteur : « réglementation zones Fo-2 » qualifie, « refonte de
la zone de collecte » ne porte pas.

## Décision

**Liste POSITIVE bornée à l'urbanisme, lue PAR OCCURRENCE**, et **séparation
des deux ordres**.

### Lexique

- `isRegulatoryReform(text)` itère sur chaque occurrence de `refonte(s)` et
  teste la queue de texte qui la suit. Aucune liste noire : une occurrence non
  réglementaire ne matche simplement pas, elle n'invalide rien.
- **Deux classes d'objets.** `REFORM_URBAN_OBJECT` (zonage, lotissement,
  construction, PIIA, urbanisme, plan d'urbanisme) porte la refonte seul.
  `REFORM_GENERIC_OBJECT` (règlement, réglementation, plan) ne la porte que
  **qualifié** d'urbanisme (`REFORM_URBAN_QUALIFIER` : « d'urbanisme »,
  « de zonage », « de lotissement », « de construction »). C'est la borne
  absente du jet précédent (D2).
- **Apposition.** Le qualifiant d'urbanisme est admis **avec ou sans**
  préposition : « réglementation urbanisme », « règlement zonage »,
  « réglementation zones » valent « du règlement de zonage ». `zone(s)` est
  qualifiant sans être porteur.
- **Catégorie structurée préfixée.** `REFORM_CATEGORY_RE = /^refontes?(?:_|$)/`
  reconnaît les trois tokens `refonte_*` de la base, et rien d'autre.
- **Coordination.** `REFORM_ENUMERATION` admet jusqu'à trois objets coordonnés
  par « et / ou / , / / » avant celui qui décide. C'est ce qui récupère
  chibougamau (« des plans **et** règlement d'urbanisme ») et
  saint-jean-de-matha (« plan **et** règlements d'urbanisme »).
- **Remplissage borné.** Après un adjectif d'ampleur, jusqu'à quatre mots
  quelconques sont tolérés avant l'objet d'urbanisme. C'est ce qui récupère
  hatley (« complète [des] outils [de] planification/réglementation
  d'urbanisme »).
- **Idiome d'ensemble.** `refonte réglementaire` et `refonte du cadre
  réglementaire` sont admis sans qualifiant : ils désignent une refonte
  d'ENSEMBLE, pas un règlement municipal nommé. C'est ce qui traite le **rappel
  latent** — `refonte du cadre réglementaire d'urbanisme` (hudson,
  saint-étienne-de-bolton) et `refonte cadre réglementaire complet`
  (val-des-bois), 3 nœuds de production qui ne matchaient **aucune** branche et
  ne survivaient que parce que `rezonage` gagnait avant dans leur texte.
- **La borne est l'objet, pas la ponctuation** (D3). `REFORM_SEGMENT_END` est
  réduit à la fin de chaîne et à la ponctuation FORTE (`.!?`) ; la virgule et
  le deux-points n'y sont plus. Et « refonte complète, en trois phases, du site
  Web municipal » reste dehors parce qu'il n'y a **aucun objet d'urbanisme**,
  pas parce qu'il y a une virgule.
- **Séparateurs.** `REFORM_SEPARATOR` couvre espaces (dont U+00A0), tirets
  U+2010..U+2015 et ASCII, deux-points, points-virgules, virgules — les PV
  écrivent « Refonte — complète — du règlement de zonage »,
  « Refonte : le règlement de zonage est remplacé », « Refonte–complète… ».
- **Le regard reste sur la QUEUE de chaque occurrence.** Saint-Jean-de-Matha
  écrit « règlement de zonage » AVANT « refonte » — mais la queue de son
  occurrence porte « plan et règlements d'urbanisme », que la coordination
  récupère. Lire aussi la TÊTE aurait recouplé les occurrences entre elles, ce
  que le lot existe précisément pour empêcher : choix délibéré de ne pas le
  faire.

### Ordre — deux réordonnancements distincts (D4)

1. **Tous** les `candidate === …` explicites passent AVANT toute heuristique de
   texte libre. La catégorie structurée fait autorité.
2. **À l'intérieur** du bloc heuristique, `refonte` passe avant
   `ppcmoi`/`piia`/`derogation`/`plan_urbanisme`.

**Apostrophes** : classe écrite `['’]` en échappements explicites.
Le piège déjà payé une fois (classe annoncée `['’]` contenant en réalité
l'apostrophe ASCII doublée, `5b 27 27 5d`, `d'urbanisme` ne matchant jamais)
est tenu par les assertions **comportementales** du test apostrophe, jouées sur
les deux codepoints — pas par les `codePointAt`, qui ne portent que sur les
littéraux (D5).

## Lots

- [x] **LOT 1 — lexique** : `isRegulatoryReform` bornée à l'urbanisme
      (coordination, remplissage borné, idiome d'ensemble, séparateurs de PV).
- [x] **LOT 2 — ordre** : séparation catégorie structurée / heuristiques dans
      `instrumentFromSignal`.
- [x] **LOT 3 — tests** : 53 cas, dont les 3 pertes de production, les 3
      « cadre réglementaire », les 8 règlements municipaux hors urbanisme, les
      3 pièges de ponctuation, les 6 séparateurs, les 3 catégories structurées,
      et l'appel réel à `isResidentialEligible`.
- [x] **LOT 4 — recette round 2** : apposition nue + catégories `refonte_*`
      préfixées, sur les 2 dernières sorties mesurées (chute-saint-philippe,
      saint-sixte). 21 cas ajoutés → **74 au total**.

## Portée

**Allowed** : `api/src/services/graph/vivier-v2.ts`, `api/src/services/graph/vivier-v2.test.ts`,
`plan/BPLEXOCC-BRANCH_*`.
**Forbidden** : `api/src/services/graph/graph-store.ts`,
`api/src/services/graph/graphify-34-*.ts`, `api/src/storage/s3-object-store.ts`
(autre agent), `packages/**`, `ui/**`, `Makefile`, `docker-compose*.yml`,
`rules/**`, `.track/**`, `.github/**`.

## Vérification

- `vitest run src/services/graph/vivier-v2.test.ts` → **74 passed** (27 de la
  branche + 26 au round 1 + 21 au round 2).
- **Rouge avant / vert après, mesuré, aux deux rounds** :
  - round 1 — les 26 tests ajoutés rejoués contre le code de la branche AVANT
    correctif → **24 échouent**. Les 2 qui passaient déjà sont déclarés comme
    garde-fous, pas comme preuves : `NBSP U+00A0` (la forme était déjà
    reconnue, D5) et `keeps refonte ahead of ppcmoi/piia inside the free-text
    block` (non-régression de l'ordre interne).
  - round 2 — les 21 tests ajoutés rejoués contre le code d'`ab2b49b` →
    **10 échouent** : les 2 nœuds de production, les 4 tokens `refonte_*`
    préfixés, les 4 appositions d'urbanisme. Les 11 qui passaient déjà sont les
    **garde-fous de non-régression** : les 6 familles municipales en apposition
    nue, les 3 formes Lac-Frontière, `refonte` non préfixé et la borne du
    préfixe. Ils prouvent que l'apposition ne rouvre RIEN.
- `vitest run src/services/graph/` → 259 passed ; les 9 échecs restants sont
  les suites `DB-bound: … (integration)` (`getaddrinfo EAI_AGAIN postgres`),
  sans stack Docker par consigne.
- `vitest run` (suite API complète) → **21 failed | 1477 passed**, contre
  **21 failed | 1430 passed** sur la branche avant correctif : **exactement les
  mêmes 21 échecs DB/integration**, +47 tests, aucune régression.
- **Sonde jetable (non commitée)** : 38 phrasés hors tests, dont la forme
  APPOSÉE de chaque famille exclue — « refonte règlement taxation », « refonte
  services souterrains », « refonte site Web municipal », « refonte plans et
  devis », « refonte plan communication », « refonte grille tarifaire ». Les
  38 conformes. C'est la vérification que le discriminant est bien le mot
  d'urbanisme, et non la présence d'une préposition.
- `tsc --noEmit -p api/tsconfig.json` → exit 0.
- `eslint api/src/services/graph/vivier-v2.ts api/src/services/graph/vivier-v2.test.ts` → exit 0.

## Reste ouvert (déclaré, non maquillé)

- **Le delta post-round-2 n'est pas re-mesuré par moi.** Le delta du tableau
  ci-dessus (**+7 / −3**, résidentiel 1 365 → 1 369) a été mesuré par le
  coordinateur sur les 7 221 nœuds à l'état `ab2b49b`. Je n'ai **aucun accès**
  à cette base depuis ce worktree : ni `rclone` ni credentials S3, `mcp immo
  search_signals` renvoie 0 signal, aucun stack Docker (consigne OOM). Ce que
  j'établis pour le round 2 est **local** : les 2 textes réels des nœuds perdus
  sont joués comme tests et passent, et 11 garde-fous + 38 sondes montrent
  qu'aucune famille exclue ne rentre. **L'attendu, non vérifié par moi** :
  −3 → **−1 sortant** (Lac-Frontière seul) et résidentiel 1 369 → **1 371**.
  La re-mesure de recette sur les 7 221 nœuds est **requise avant merge**.
- **Le texte exact de hatley n'a pas pu être relu à la source.** Le libellé
  cité par la revue est abrégé ; le lexique accepte les deux formulations
  plausibles (« complète outils planification/… » et « complète des outils de
  planification/… »), mais le test porte la forme citée, pas une forme vérifiée
  au nœud.
- **`zone(s)` est qualifiant, pas porteur** — choix délibéré et borné. Une
  forme « refonte des zones … » sans autre marqueur d'urbanisme resterait
  `autre`. Aucun nœud de cette forme n'est connu ; le cas n'est pas instruit.
- **Second lexique refonte, hors périmètre, NON corrigé** :
  `packages/radar-domain/src/signals/b-prime.ts:142-144` maintient
  `/\b(?:refonte|revision) complete\b/`, alors que le commentaire de
  `instrumentFromSignal` affirme qu'il « must not maintain a second instrument
  lexicon ». **Le commentaire est faux** — signalé, pas touché.
- **Branche morte, hors périmètre, NON corrigée** :
  `text.includes("plan d urbanisme")` (avec espace) est inatteignable —
  `fold()` ne remplace pas l'apostrophe, « plan d'urbanisme » ne devient jamais
  « plan d urbanisme ». 0 nœud classé `plan_urbanisme` sur les 7 221.
- **Alternatives mortes, NON corrigées** : `REFORM_EXTENT` contient
  `totaux|globaux|integraux`, masculins pluriels qui ne peuvent jamais
  s'accorder avec « refonte », féminin.
- Le chiffre de recette « 174/327 » et sa reproductibilité : non instruits ici.
- Le titre trompeur du test « byte-identical across API, domain, UI » : non
  corrigé, hors périmètre.
