# bench-v11 — harnais autonome du benchmark d'extraction PV (v101b / v11alpha / v11)

Ce dossier versionne le harnais complet des bancs v11alpha, complément Muse
Wonder low et v11 (Argon low + Muse Wonder low), de façon **autonome** :
toutes les commandes ci-dessous réussissent depuis un checkout propre, sans
le clone d'exécution `tmp/bench-wonder`. Les scripts résolvent leur racine
depuis leur propre emplacement (ou la variable `BENCH_DIR`, voir plus bas) ;
aucun chemin absolu d'une machine n'est requis.

## Prérequis

- Node.js (moteur du dépôt : `>=24` ; vérifié aussi sous Node 22).
- `pdftotext` (paquet `poppler-utils`) pour l'extraction du corpus.
- CLI `agy` (Antigravity, siège Gemini) connectée au siège, pour le bras Argon.
- CLI `muse` (siège Meta) connectée au siège, pour le bras Wonder et son burn.
- Chromium headless pour le PDF du dossier (étape 7, optionnelle).
- Aucune clé API : les deux bras sont des sièges (abonnements) uniquement.
- Accès réseau aux URL sources du manifeste (étape 1) et au registre npm
  (étape 0).

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `BENCH_DIR` | racine de ce harnais (`tools/bench-v11/`, résolue depuis l'emplacement du script) | Racine de lecture/écriture : entrées versionnées (`harness/`, `t1/`, `oracle-676/`) et artefacts générés (`full/corpus/`, `full/prompts/`, `full/arms/`, scores). Pointer vers un ancien clone (`tmp/bench-wonder`) reproduit l'exécution d'origine. |
| `BENCH_REPO` | `$BENCH_DIR/../..` | Répertoire de travail (`cwd`) des processus `agy` des runners Argon. |
| `BENCH_CACHE_DIR` | (absent) | Cache PDF optionnel de repli pour `dl-corpus.mjs`, disposition `workers/<ville>/grounding-work/pdfs/<sha256>.pdf`. |
| `BENCH_KEEP_PDF` | (absent) | `=1` conserve les PDF du corpus ; sinon chaque PDF est supprimé dès son texte vérifié écrit (seuls les textes sont gardés). |

## Contenu

- `harness/manifest-v101b.json` — manifeste gelé v101b (100 documents,
  `promptFreeze` ; prompt système sha256
  `bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461`).
- `harness/score-oracle-v2.mjs`, `score-oracle-v3.mjs`, `oracle-v3-lib.mjs`,
  `oracle-v3-soft.mjs`, `o3l.mjs`, `precision-cascade.mjs` — scoreur oracle
  v3 (strict, R4 aliases) et cascades.
- `harness/cost-calculator.mjs`, `v101-arms.mjs`, `report-data-v101b.json`,
  `manual-oracle-v2.json` — coûts v10 et référence humaine v2.
- `t1/` — profil d'ontologie gelé v9 et modules gelés
  (`frozen-ontology-profile.yaml`, `frozen-refresh-corpus.ts`,
  `frozen-refresh-profile.ts` ; sha256 dans le manifeste).
- `oracle-676/` — oracle 676 unités (#725) : `consensus.json`,
  `unresolved.json` (43 non résolus neutres en stricte).
- `prompts-verify.json` — revérification des prompts gelés reconstruits
  (`count=100, fail=0`).
- `sandbox/package.json` + `package-lock.json` — dépendance unique du
  harnais : `@sentropic/graphify@0.18.0` (prompts et validation).
  `sandbox/node_modules/` n'est pas versionné (voir étape 0).
- `full/` — scripts de la chaîne complète (ci-dessous).
- `build-v11-report.mjs` — générateur des dossiers v11 et v12 (`BENCH_REPORT=v12` pour le v12 ; tableaux, graphiques
  SVG, HTML ; PDF via Chromium headless). Les graphiques v10 venaient de
  Matplotlib ; ils sont régénérés en Node dans le même style (règle zéro
  Python du dépôt). `charts-v12.mjs` : graphiques v12 au style v10
  (couleur = fournisseur, forme = modèle, pointillé = effort, étoile = cascade).

## Chaîne complète depuis le manifeste seul

Toutes les commandes depuis la racine du dépôt. Les artefacts générés
vont sous `tools/bench-v11/full/` (ignorés par git, voir `.gitignore`).

### 0. Dépendance graphify

```bash
cd tools/bench-v11/sandbox && npm ci && cd ../../..
```

### 1. Corpus : télécharger les PDF du manifeste, ne garder que les textes

```bash
node tools/bench-v11/full/dl-corpus.mjs
# -> full/corpus/text/<id>.txt (sha256 du texte vérifié contre le manifeste)
#    + full/corpus/verify.json ; PDF supprimés sauf BENCH_KEEP_PDF=1.
```

Reprise : un texte déjà vérifié sur disque est sauté (aucun re-téléchargement).
État des sources au 2026-11-09 : 89/100 URL du manifeste répondent encore
avec le sha gelé ; 11 renvoient 404/403 ou un contenu dérivé. Pour celles-ci,
fournir un cache via `BENCH_CACHE_DIR` (voir tableau) ou déposer les textes
déjà vérifiés sous `full/corpus/text/` — l'étape 2 revérifie chaque prompt
octet par octet contre le manifeste, donc un texte faux y échoue.

### 2. Prompts gelés (revérification octet par octet)

```bash
node tools/bench-v11/full/prepare-prompts.mjs
# -> full/prompts/*.muse.txt + full/prompts/verify.json
# Attendu : DONE ok=100 fail=0 (identique au prompts-verify.json versionné).
```

### 3. Exécuter un bras (siège uniquement ; reprise quota 300 s, max 12, jamais compté refus)

```bash
node tools/bench-v11/full/run-arm-argon.mjs          # Argon low, passage concurrence 10
node tools/bench-v11/full/run-arm-argon-retry.mjs    # reprises séquentielles des échecs d'infrastructure
bash tools/bench-v11/full/run-arm-wonder-c10.sh      # Muse Wonder low, concurrence 10
```

Bras Muse Ember (mise à jour du 2026-11-12) : `muse-ember-1.0`, efforts
`xhigh` puis `max`, concurrence 4, `--contributor-mode off` et `--json` sur le
bras complet (jetons réels par document ; texte terminal extrait vers `raw/`).
`MUSE_CWD` fixe le répertoire de travail de la CLI (défaut : dossier vide
`${TMPDIR:-/tmp}/muse-ember-run`, hors de tout dépôt). Garde hebdomadaire :
le runner lit `muse usage --json` avant chaque document et s'arrête à
`STOP_WEEKLY_PCT` (défaut 85) ; le chien de garde relit toutes les 10 minutes
et coupe les processus du runner au même seuil : il ne tue que l'arbre de
processus du groupe du runner (y compris les enfants `timeout`, qui ont leur
propre groupe), jamais d'autre session `muse`. Depuis le 2026-11-13, après les
passages publiés, le runner refuse aussi un `MUSE_CWD` non vide. Surface
d'accès : aucun outil n'est restreint (voir dossier v12 §2) ; un outil `bash`
de la CLI écrit dans `/tmp` de l'hôte, d'où un risque de collision entre
documents concurrents.

```bash
bash tools/bench-v11/full/run-arm-ember.sh xhigh 4     # -> full/arms/muse-ember-xhigh/{raw,jsonl,usage}/
bash tools/bench-v11/full/run-arm-ember.sh max 4       # -> full/arms/muse-ember-max/...
bash tools/bench-v11/full/watch-muse-weekly.sh <pgid-du-runner> 600 85   # -> full/muse-weekly-log.jsonl
```

Chaque ligne `meta.jsonl` enregistre `promptSha256` (sha256 du prompt
réellement envoyé) et `startedAt`. Surface d'accès AGY : voir le dossier
v11 §2 (cwd, 60 outils actifs, aucun appel d'outil observé).

### 4. Validation profil v9 gelé + provenance

```bash
node tools/bench-v11/full/validate-outputs.mjs tools/bench-v11/full/arms/gemini-argon-low
node tools/bench-v11/full/validate-outputs.mjs tools/bench-v11/full/arms/muse-wonder-low
node tools/bench-v11/full/validate-outputs.mjs tools/bench-v11/full/arms/muse-ember-xhigh
node tools/bench-v11/full/validate-outputs.mjs tools/bench-v11/full/arms/muse-ember-max
# -> <armDir>/validated/*.output.json + *.receipt.json
```

### 5. Notation oracle 676

```bash
node tools/bench-v11/full/score-argon.mjs    # -> full/scores-argon.json
node tools/bench-v11/full/score-wonder.mjs   # -> full/scores-wonder.json
node tools/bench-v11/full/score-ember.mjs xhigh   # -> full/scores-ember-xhigh.json (jetons réels inclus)
node tools/bench-v11/full/score-ember.mjs max     # -> full/scores-ember-max.json
# Surface d'accès de la CLI Muse (appels d'outil, tours, skills), sans appel modèle :
node tools/bench-v11/full/audit-muse-surface.mjs tools/bench-v11/full/arms/muse-ember-xhigh   # -> <armDir>/surface.json
node tools/bench-v11/full/audit-muse-surface.mjs tools/bench-v11/full/arms/muse-ember-max
# Sensibilité (score publié inchangé) : documents avec appel d'outil comptés refusés
node tools/bench-v11/full/score-ember-sensitivity.mjs xhigh sacre-coeur-2026-05-11   # -> full/scores-ember-xhigh-sensitivity.json
```

### Cascade CP+ réelle (complément v12)

CP+ rejoue GPT-6 Astra medium, puis fait relire chaque sortie acceptée par
Muse Spark 1.3 xhigh. Le filtre CP reste inchangé. Le scoreur refuse un
passage incomplet, les doublons et une concurrence observée supérieure à 4.
Un verrou global interdit deux runners sur le même bras. Ne pas effacer ce
verrou pendant une exécution. Après une interruption, vérifier l'arrêt du
conteneur avant de retirer un verrou résiduel.

Le point d'entrée autonome ne charge ni le Makefile racine ni un fichier
d'environnement. Node tourne en conteneur. Les processus modèle partent
d'un dossier vide hors dépôt. Fournir `BENCH_MESH_DIR` (llm-mesh 0.19.3) et
`BENCHMARK_OWNER_SCOPE` (portée publique du compte Codex). Le trousseau
chiffré est copié hors dépôt par `setup`. Aucun secret n'est affiché.

```bash
make -f tools/bench-v11/cp-plus.mk setup ENV=test-benchmark-b
make -f tools/bench-v11/cp-plus.mk freeze ENV=test-benchmark-b
make -f tools/bench-v11/cp-plus.mk replay BENCH_MESH_DIR=<sandbox> BENCHMARK_OWNER_SCOPE=<scope> ENV=test-benchmark-b
make -f tools/bench-v11/cp-plus.mk validate ENV=test-benchmark-b
make -f tools/bench-v11/cp-plus.mk filter CONCURRENCY=4 ENV=test-benchmark-b
make -f tools/bench-v11/cp-plus.mk audit ENV=test-benchmark-b
make -f tools/bench-v11/cp-plus.mk score ENV=test-benchmark-b
make -f tools/bench-v11/cp-plus.mk report BENCH_REFERENCE=<preuves-v11> BENCH_REPORT=v12 ENV=test-benchmark-b
make -f tools/bench-v11/cp-plus.mk pdf ENV=test-benchmark-b
make -f tools/bench-v11/cp-plus.mk checksums ENV=test-benchmark-b
```

CP+ low reuses the existing Astra replay. Its separate arm is
`full/arms/cp-plus-muse13-low`; xhigh remains the default arm, with a quota
stop threshold of 85% and concurrency four. To reproduce low (this runs
the reviewer for any missing decisions):

```bash
make -f tools/bench-v11/cp-plus.mk filter audit score MUSE_EFFORT=low STOP_WEEKLY_PCT=100 CONCURRENCY=8 ENV=test-benchmark-b-low
```

`STOP_WEEKLY_PCT=100` disables the quota guard, even if the counter is
unavailable. To recalculate from captured data without a model call, run
only `audit score`, with `MUSE_EFFORT=low` or `MUSE_EFFORT=xhigh`.
The score summary fields `firstReceiptWeekly` and `lastReceiptWeekly`
record the weekly quota percentage from the first and last valid review
receipts in log order. An unavailable value is `null`. These fields are
metadata and do not affect precision, recall, or F1.

Muse est lu avant chaque document et toutes les 10 minutes. À 85 %, le
runner coupe aussi ses appels en cours. Un quota illisible arrête le bras.
Le quota ne devient jamais un refus. Pour la mesure CP+ du 13 novembre,
l'arrêt initial intervient après 64 documents. L'owner demande ensuite une
reprise sans seuil. Une interruption à 78 documents impose une dernière
reprise. Chaque reprise saute les décisions présentes. `meta.jsonl` atteste
100 réponses valides distinctes, sans doublon, et trois tentatives coupées
au premier arrêt. Muse hebdomadaire passe de 84 % à 85 %. La finalisation
ne lance aucun nouvel appel de modèle.

Résultats stricts, oracle 676 : rejeu Astra P 0,391 / R 0,497 / F1 0,438 ;
CP+ P 0,467 / R 0,494 / F1 0,480. Les deux acceptent 100 documents.
CP+ juge 852 actes et en retire 143. Équivalents API : 0,44027 et
0,49055 USD/doc. Siège : `missing source`. Le coût Muse couvre les
100 invocations abouties. L'usage des trois tentatives coupées est
`missing source`. L'audit des 103 flux n'observe aucun outil ni tour
supplémentaire. La CLI déclare 47 skills chargées. Les outils restent
disponibles. Voir la section « CP+ mesurée » du dossier v12.

Les jetons réels, décisions, reçus et
surface d'accès sont conservés sous `full/arms/`. Le coût siège reste
`missing source` si le compteur partagé ne permet pas une attribution.
Le target `pdf` utilise le navigateur local dédié au port 9333. Il ouvre
son propre onglet, incorpore les SVG, produit le PDF, puis ferme cet onglet.
Le dossier v12 ne pose aucune décision. Les 42 lignes historiques restent
inchangées. Le dossier Focus n'est pas modifié. Les deux fichiers de score
CP+ et rejeu sont versionnés. Les sorties brutes restent locales.

### 6. Burns (échantillon fixe de 10 documents, capture d'usage)

```bash
bash tools/bench-v11/full/run-burn-wonder-usage10.sh   # muse exec --json, séquentiel
node tools/bench-v11/full/run-burn-argon.mjs           # agy stream-json (même mode que le bras noté)
```

### 7. Dossier v11 (Markdown + SVG + HTML, puis PDF)

```bash
node tools/bench-v11/build-v11-report.mjs tmp/bench-wonder docs/reports/benchmark-v11-2026-11-09
chromium --headless --disable-gpu --no-sandbox \
  --print-to-pdf=docs/reports/benchmark-v11-2026-11-09.pdf \
  docs/reports/benchmark-v11-2026-11-09.html
```

Le premier argument du générateur est le dossier de preuves contenant
`full/scores-{argon,wonder}.json`, `full/arms/gemini-argon-low/meta.jsonl`
et `full/burn-{argon,wonder}-usage10/` (le clone d'exécution pour le
passage publié ; un `BENCH_DIR` de travail pour une ré-exécution).

### 7 bis. Dossier v12 (v11 + Muse Ember xhigh/max, graphiques style v10)

```bash
BENCH_REPORT=v12 node tools/bench-v11/build-v11-report.mjs tmp/bench-wonder
# -> docs/reports/benchmark-v12-2026-11-13.{md,html}
#    + docs/reports/assets/2026-11/benchmark-v12-{precision-rappel,f1-cost,acceptation,rappel}.svg
```

Le mode v12 lit en plus `full/scores-ember-{xhigh,max}.json` sous
`BENCH_EMBER_DIR` (défaut `tools/bench-v11`) et échoue s'ils manquent. Sans
`BENCH_REPORT=v12`, le générateur produit le dossier v11 du 2026-11-09 à
l'octet près (vérifié) : le v11 publié reste intact. Le v12 reprend le texte
v11 avec des insertions ancrées (aucune valeur v11 modifiée ; seuls les rangs
positionnels sont recalculés sur 42 lignes), les noms complets des modèles
avec version dans les tableaux et les graphiques, et un tableau « Meilleurs
bras » calculé depuis les données.

Graphiques v12 : `charts-v12.mjs`, style du v10 (v101b) régénéré en Node :
couleur = fournisseur, forme = modèle, pointillé = progression d'effort
(off → minimal → low → medium → high → xhigh → max), étoile = cascade,
libellé posé à côté de chaque point avec traits de rappel courts (placement
glouton qui évite libellés, points et lignes), courbes de même F1 en gris
clair. Le générateur affiche le nombre de chevauchements de libellés
(`chartCheck`, attendu 0) ; vérifier aussi le rendu à l'œil.

Chromium en snap n'écrit pas dans un dossier caché (`.claude/`,
`.cache-tmp/`) : copier le HTML et `assets/2026-11/` sous
`~/snap/chromium/common/` pour l'impression PDF.

Scripts auxiliaires de reconstruction (hors chaîne principale) :
`full/build-oracle-676.mjs` (reconstruit `full/oracle-676/` depuis
`harness/`), `full/build-summary.mjs` (tableau v10, exige en plus
`harness/scores-100-674.json` du clone d'origine), `full/score-v11.mjs`
et `full/score-676.mjs` (rescore des bras v11alpha/v10),
`full/extract-usage.mjs` (usage Muse `--json`, appelé par le burn Wonder),
`full/run-arm-wonder.sh` (passage Wonder concurrence 1 d'origine).

## Vérification des empreintes

```bash
cd tools/bench-v11 && sha256sum -c SHA256SUMS
```

Note historique : les scripts ont d'abord été versionnés comme copies
octet-identiques du clone d'exécution (commits `5e8cd28b`/`9ab7bca9`).
Depuis le correctif B1 de la revue de PR #1052, ils diffèrent du clone
par la paramétrisation de la racine (`BENCH_DIR`), la traçabilité
`promptSha256`/`startedAt` et le mode `stream-json` du burn Argon ;
`SHA256SUMS` correspond aux copies versionnées courantes.
